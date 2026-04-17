import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNum(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parseOpenAIStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const event = safeJsonParse(trimmed);
  const rec = asRecord(event);
  if (!rec) {
    return [{ kind: "stdout", ts, text: trimmed }];
  }

  const type = asStr(rec.type);

  // Session init
  if (type === "session.init") {
    const model = asStr(rec.model);
    const sessionId = asStr(rec.session_id);
    return [{ kind: "init", ts, model, sessionId }];
  }

  // Assistant message
  if (type === "message.assistant") {
    const text = asStr(rec.text).trim();
    if (!text) return [];
    return [{ kind: "assistant", ts, text }];
  }

  // Tool call
  if (type === "tool_call") {
    const name = asStr(rec.name);
    const callId = asStr(rec.call_id);
    const rawInput = rec.input;
    let parsedInput: unknown = rawInput;
    if (typeof rawInput === "string") {
      try {
        parsedInput = JSON.parse(rawInput);
      } catch {
        parsedInput = { command: rawInput };
      }
    }
    return [
      {
        kind: "tool_call",
        ts,
        name,
        toolUseId: callId || name,
        input: parsedInput as Record<string, unknown>,
      },
    ];
  }

  // Tool result
  if (type === "tool_result") {
    const callId = asStr(rec.call_id);
    const output = asStr(rec.output);
    const isError = rec.is_error === true;
    return [
      {
        kind: "tool_result",
        ts,
        toolUseId: callId,
        content: output,
        isError,
      },
    ];
  }

  // Final result
  if (type === "response.done") {
    const text = asStr(rec.summary);
    const inputTokens = asNum(rec.input_tokens);
    const outputTokens = asNum(rec.output_tokens);
    const cachedTokens = asNum(rec.cached_tokens);
    const entries: TranscriptEntry[] = [];
    if (inputTokens > 0 || outputTokens > 0 || text) {
      entries.push({
        kind: "result",
        ts,
        text,
        inputTokens,
        outputTokens,
        cachedTokens,
        costUsd: 0,
        subtype: "success",
        isError: false,
        errors: [],
      });
    }
    return entries;
  }

  // Error
  if (type === "error") {
    const message = asStr(rec.message);
    return [
      {
        kind: "result",
        ts,
        text: message,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
        subtype: "error",
        isError: true,
        errors: [message],
      },
    ];
  }

  // Fallback
  return [{ kind: "stdout", ts, text: trimmed }];
}
