import { parseJson, asString, asNumber } from "@paperclipai/adapter-utils/server-utils";

export interface ParsedOpenAIOutput {
  sessionId: string | null;
  summary: string;
  errorMessage: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  };
}

export function parseOpenAIJsonl(stdout: string): ParsedOpenAIOutput {
  let sessionId: string | null = null;
  let summary = "";
  let errorMessage: string | null = null;
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const event = parseJson(line);
    if (!event) continue;

    const type = asString(event.type, "");

    if (type === "session.init") {
      sessionId = asString(event.session_id, sessionId ?? "") || sessionId;
      continue;
    }

    if (type === "message.assistant") {
      const text = asString(event.text, "").trim();
      if (text) summary = text;
      continue;
    }

    if (type === "response.done") {
      const text = asString(event.summary, "").trim();
      if (text) summary = text;
      usage.inputTokens = asNumber(event.input_tokens, usage.inputTokens);
      usage.outputTokens = asNumber(event.output_tokens, usage.outputTokens);
      usage.cachedInputTokens = asNumber(event.cached_tokens, usage.cachedInputTokens);
      const sid = asString(event.session_id, "");
      if (sid) sessionId = sid;
      continue;
    }

    if (type === "error") {
      const msg = asString(event.message, "").trim();
      if (msg) errorMessage = msg;
      continue;
    }
  }

  return { sessionId, summary, errorMessage, usage };
}

export function isOpenAIUnknownSessionError(_stdout: string, _stderr: string): boolean {
  // API-based adapter stores history directly; session errors are structural
  return false;
}
