import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  buildPaperclipEnv,
  ensureAbsoluteDirectory,
  parseObject,
  renderTemplate,
  stringifyPaperclipWakePayload,
} from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_OPENAI_API_MODEL } from "../index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageRole = "system" | "user" | "assistant" | "tool";

interface ContentPart {
  type: "text";
  text: string;
}

interface ToolCallFunction {
  name: string;
  arguments: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: ToolCallFunction;
}

interface ChatMessage {
  role: MessageRole;
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIChatResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface BashResult {
  output: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PROMPT_TEMPLATE =
  "You are agent {{agent.name}} (id: {{agent.id}}, company: {{agent.companyId}}). " +
  "Your working directory is {{cwd}}. " +
  "Continue your Paperclip work. Current run: {{runId}}.";

const SYSTEM_PROMPT_BASE = `You are an AI coding agent running inside Paperclip, an agent orchestration platform.
You have access to a bash tool to execute shell commands in your working directory.
Use it to read files, write code, run tests, and complete the assigned task.

Guidelines:
- Think step by step before acting.
- When a task is complete, provide a clear summary of what was done.
- If you encounter errors, try to diagnose and fix them.
- Do not ask for confirmation — act autonomously.
`;

const BASH_TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "bash",
    description:
      "Execute a shell command in the working directory. Use this to read files, write code, run tests, or explore the codebase.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute. Single or multi-line.",
        },
        timeout_sec: {
          type: "number",
          description: "Timeout for this specific command in seconds (default: 60).",
        },
      },
      required: ["command"],
    },
  },
};

const MAX_TOOL_OUTPUT_CHARS = 32_000;
const TOOL_EXEC_TIMEOUT_SEC = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContextEnv(ctx: AdapterExecutionContext): Record<string, string> {
  const env: Record<string, string> = {};
  const { context, runId } = ctx;

  env.PAPERCLIP_RUN_ID = runId;

  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim()) ||
    null;
  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;

  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim()
      ? context.wakeReason.trim()
      : null;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;

  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim()) ||
    null;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;

  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim()
      ? context.approvalId.trim()
      : null;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;

  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim()
      ? context.approvalStatus.trim()
      : null;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;

  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");

  const wakePayloadJson = stringifyPaperclipWakePayload(context.paperclipWake);
  if (wakePayloadJson) env.PAPERCLIP_WAKE_PAYLOAD_JSON = wakePayloadJson;

  return env;
}

function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.4);
  const tail = maxChars - head - 80;
  return `${text.slice(0, head)}\n... [truncated ${text.length - head - tail} chars] ...\n${text.slice(text.length - tail)}`;
}

async function runBashCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
  timeoutSec: number,
): Promise<BashResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn("bash", ["-c", command], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => chunks.push(d));

    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGKILL");
    }, timeoutSec * 1000);

    child.on("close", (code) => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const output = truncateOutput(raw, MAX_TOOL_OUTPUT_CHARS);
      resolve({
        output: didTimeout ? `[timed out after ${timeoutSec}s]\n${output}` : output,
        exitCode: didTimeout ? 124 : (code ?? 0),
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ output: `Error spawning bash: ${err.message}`, exitCode: 1 });
    });
  });
}

function logJson(
  onLog: AdapterExecutionContext["onLog"],
  event: Record<string, unknown>,
): Promise<void> {
  return onLog("stdout", JSON.stringify(event) + "\n");
}

// ---------------------------------------------------------------------------
// Session codec helpers
// ---------------------------------------------------------------------------

export function serializeHistory(messages: ChatMessage[]): Record<string, unknown> {
  return { messages };
}

export function deserializeHistory(raw: unknown): ChatMessage[] {
  if (!raw || typeof raw !== "object") return [];
  const parsed = raw as Record<string, unknown>;
  if (!Array.isArray(parsed.messages)) return [];
  return parsed.messages as ChatMessage[];
}

// ---------------------------------------------------------------------------
// Main execute
// ---------------------------------------------------------------------------

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { agent, runtime, runId, onLog, onMeta, authToken } = ctx;
  const config = parseObject(ctx.config);

  const model = asString(config.model, DEFAULT_OPENAI_API_MODEL);

  // Resolve CWD — priority: explicit config > instructionsRootPath > agent workspace fallback
  const configuredCwd = asString(config.cwd, "").trim();
  const instructionsRootPath = asString(config.instructionsRootPath, "").trim();
  let rawCwd: string;
  if (configuredCwd) {
    rawCwd = configuredCwd;
  } else if (instructionsRootPath) {
    rawCwd = instructionsRootPath;
  } else {
    // Mirror server's resolveDefaultAgentWorkspaceDir logic
    const paperclipHome =
      (process.env.PAPERCLIP_HOME?.trim()) ||
      path.join(os.homedir(), ".paperclip");
    const instanceId = (process.env.PAPERCLIP_INSTANCE_ID?.trim()) || "default";
    rawCwd = path.join(paperclipHome, "instances", instanceId, "workspaces", agent.id);
    try { mkdirSync(rawCwd, { recursive: true }); } catch { /* ignore */ }
  }
  const promptTemplate = asString(config.promptTemplate, DEFAULT_PROMPT_TEMPLATE);

  // Load system prompt: prefer config.systemPrompt (inline text), then read
  // config.instructionsFilePath if provided, then fall back to empty string.
  const rawSystemPrompt = asString(config.systemPrompt, "");
  const instructionsFilePath = asString(config.instructionsFilePath, "");
  let customSystemPrompt = rawSystemPrompt;
  if (!customSystemPrompt && instructionsFilePath) {
    try {
      customSystemPrompt = readFileSync(instructionsFilePath, "utf8");
    } catch {
      // file missing or unreadable — proceed without it
    }
  }

  const rawMaxIterations = asNumber(config.maxIterations, 0);
  const maxIterations = rawMaxIterations > 0 ? rawMaxIterations : 30;
  const maxHistoryMessages = asNumber(config.maxHistoryMessages, 100);
  const rawTimeoutSec = asNumber(config.timeoutSec, 0);
  const timeoutSec = rawTimeoutSec > 0 ? rawTimeoutSec : 600;
  const apiBaseUrl = asString(config.apiBaseUrl, "https://api.openai.com/v1").replace(/\/$/, "");
  const configEnvObj = parseObject(config.env) as Record<string, string>;

  // Resolve cwd
  let cwd = rawCwd;
  try {
    await ensureAbsoluteDirectory(rawCwd, { createIfMissing: true });
    cwd = rawCwd;
  } catch {
    // fall back to rawCwd if resolution fails
  }

  // Build env
  const paperclipEnv = buildPaperclipEnv(agent);
  const contextEnv = buildContextEnv(ctx);
  const toolEnv: Record<string, string> = { ...paperclipEnv, ...contextEnv };

  for (const [k, v] of Object.entries(configEnvObj)) {
    if (typeof v === "string") toolEnv[k] = v;
  }

  const hasExplicitApiKey =
    typeof configEnvObj.PAPERCLIP_API_KEY === "string" && configEnvObj.PAPERCLIP_API_KEY.trim().length > 0;
  if (!hasExplicitApiKey && authToken) {
    toolEnv.PAPERCLIP_API_KEY = authToken;
  }

  // Resolve OpenAI API key: config.env.OPENAI_API_KEY > process.env.OPENAI_API_KEY
  const apiKey =
    (typeof configEnvObj.OPENAI_API_KEY === "string" && configEnvObj.OPENAI_API_KEY.trim()) ||
    (typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.trim()) ||
    "";

  if (!apiKey) {
    await logJson(onLog, { type: "error", message: "OPENAI_API_KEY is not set" });
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "OPENAI_API_KEY is not configured. Set it in the server environment or in the agent env config.",
    };
  }

  // Render prompt
  const renderedPrompt = renderTemplate(promptTemplate, {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    cwd,
    agent,
    context: ctx.context,
    run: { id: runId },
  });

  // Load session history
  const history = deserializeHistory(runtime.sessionParams);
  // Trim history if too long
  const trimmedHistory =
    history.length > maxHistoryMessages
      ? history.slice(history.length - maxHistoryMessages)
      : history;

  // Build runtime env info section so the model knows the concrete values to use in curl
  const paperclipApiUrl = toolEnv.PAPERCLIP_API_URL ?? "";
  const paperclipAgentId = toolEnv.PAPERCLIP_AGENT_ID ?? agent.id;
  const runtimeEnvSection =
    paperclipApiUrl
      ? [
          `## Runtime Environment`,
          `The following variables are available in your bash environment — use them directly in curl commands:`,
          `- PAPERCLIP_API_URL=${paperclipApiUrl}`,
          `- PAPERCLIP_API_KEY is set (use \$PAPERCLIP_API_KEY in curl)`,
          `- PAPERCLIP_RUN_ID is set (required X-Paperclip-Run-Id header for POST/PATCH)`,
          `- PAPERCLIP_AGENT_ID=${paperclipAgentId}`,
          ``,
          `Example: curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" "${paperclipApiUrl}/api/agents/me/inbox-lite"`,
        ].join("\n")
      : "";

  // Build system prompt
  const systemContent = [SYSTEM_PROMPT_BASE, runtimeEnvSection, customSystemPrompt].filter(Boolean).join("\n\n");

  // Build messages for this run
  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...trimmedHistory,
    { role: "user", content: renderedPrompt },
  ];

  const sessionId = runtime.sessionDisplayId ?? `openai_${Date.now()}`;

  // Emit init event
  await logJson(onLog, { type: "session.init", session_id: sessionId, model, cwd });

  if (onMeta) {
    await onMeta({
      adapterType: "openai_api",
      cwd,
      command: `${apiBaseUrl}/chat/completions`,
      commandArgs: [],
      context: { model },
      env: { OPENAI_API_KEY: "[redacted]" },
    });
  }

  // Usage accumulators
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedInputTokens = 0;
  let finalAssistantText = "";
  let errorMessage: string | null = null;
  let didTimeout = false;
  let lastResponseModel: string | null = null;

  const deadline = Date.now() + timeoutSec * 1000;

  // Helper to call OpenAI chat completions
  async function callOpenAI(msgs: ChatMessage[]): Promise<OpenAIChatResponse> {
    const response = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: msgs.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.name ? { name: m.name } : {}),
        })),
        tools: [BASH_TOOL_DEFINITION],
        tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(Math.min(120_000, (deadline - Date.now()))),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 500)}`);
    }

    return response.json() as Promise<OpenAIChatResponse>;
  }

  // Agentic loop
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (Date.now() >= deadline) {
      didTimeout = true;
      await logJson(onLog, { type: "error", message: `Run timed out after ${timeoutSec}s` });
      break;
    }

    let resp: OpenAIChatResponse;
    try {
      resp = await callOpenAI(messages);
    } catch (err) {
      if ((err as Error).name === "TimeoutError" || (err as Error).name === "AbortError") {
        didTimeout = true;
        await logJson(onLog, { type: "error", message: `OpenAI API request timed out` });
      } else {
        errorMessage = (err as Error).message;
        await logJson(onLog, { type: "error", message: errorMessage });
      }
      break;
    }

    // Accumulate usage
    if (resp.usage) {
      totalInputTokens += resp.usage.prompt_tokens;
      totalOutputTokens += resp.usage.completion_tokens;
      totalCachedInputTokens += resp.usage.prompt_tokens_details?.cached_tokens ?? 0;
    }
    lastResponseModel = resp.model ?? lastResponseModel;

    const choice = resp.choices[0];
    if (!choice) {
      errorMessage = "OpenAI returned no choices";
      await logJson(onLog, { type: "error", message: errorMessage });
      break;
    }

    const assistantMsg = choice.message;
    const assistantChatMsg: ChatMessage = {
      role: "assistant",
      content: assistantMsg.content ?? null,
      tool_calls: assistantMsg.tool_calls,
    };
    messages.push(assistantChatMsg);

    // Emit assistant text if present
    if (assistantMsg.content) {
      const text = typeof assistantMsg.content === "string" ? assistantMsg.content : "";
      if (text) {
        finalAssistantText = text;
        await logJson(onLog, { type: "message.assistant", text });
      }
    }

    // Check finish reason
    const finishReason = choice.finish_reason;

    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      // No tool calls — done
      break;
    }

    if (finishReason === "stop" && !assistantMsg.tool_calls?.length) {
      break;
    }

    // Execute tool calls
    for (const toolCall of assistantMsg.tool_calls) {
      const fn = toolCall.function;
      await logJson(onLog, {
        type: "tool_call",
        name: fn.name,
        call_id: toolCall.id,
        input: fn.arguments,
      });

      let toolResult: string;

      if (fn.name === "bash") {
        let parsedArgs: { command?: string; timeout_sec?: number } = {};
        try {
          parsedArgs = JSON.parse(fn.arguments) as typeof parsedArgs;
        } catch {
          parsedArgs = { command: fn.arguments };
        }

        const command = asString(parsedArgs.command, "").trim();
        if (!command) {
          toolResult = "Error: no command provided";
        } else {
          const toolTimeout = asNumber(parsedArgs.timeout_sec, TOOL_EXEC_TIMEOUT_SEC);
          const bashResult = await runBashCommand(command, cwd, toolEnv, toolTimeout);
          toolResult = bashResult.output || "(no output)";

          await logJson(onLog, {
            type: "tool_result",
            call_id: toolCall.id,
            output: toolResult,
            exit_code: bashResult.exitCode,
            is_error: bashResult.exitCode !== 0,
          });
        }
      } else {
        toolResult = `Unknown tool: ${fn.name}`;
        await logJson(onLog, {
          type: "tool_result",
          call_id: toolCall.id,
          output: toolResult,
          is_error: true,
        });
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult,
      });
    }
  }

  // Build session history for persistence (exclude the system message)
  const historyToSave = messages.filter((m) => m.role !== "system");

  const costUsd =
    totalInputTokens > 0 || totalOutputTokens > 0
      ? null // real cost would require model pricing table
      : null;

  // Emit final result event
  await logJson(onLog, {
    type: "response.done",
    summary: finalAssistantText.slice(0, 500),
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
    cached_tokens: totalCachedInputTokens,
    session_id: sessionId,
  });

  return {
    exitCode: errorMessage || didTimeout ? 1 : 0,
    signal: null,
    timedOut: didTimeout,
    errorMessage: errorMessage ?? undefined,
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cachedInputTokens: totalCachedInputTokens,
    },
    provider: "openai",
    model: lastResponseModel ?? model,
    costUsd,
    summary: finalAssistantText.slice(0, 2000) || undefined,
    sessionParams: serializeHistory(historyToSave),
    sessionDisplayId: sessionId,
    resultJson: {
      model: lastResponseModel ?? model,
      iterations: messages.filter((m) => m.role === "assistant").length,
    },
  };
}


