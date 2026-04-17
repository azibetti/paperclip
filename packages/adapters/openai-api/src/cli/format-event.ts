import pc from "picocolors";

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function printOpenAIApiStreamEvent(raw: string, debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  const event = safeJsonParse(line);
  if (!event) {
    if (debug) process.stdout.write(pc.gray(`[openai] ${line}\n`));
    return;
  }

  const type = typeof event.type === "string" ? event.type : "";

  if (type === "session.init") {
    const model = typeof event.model === "string" ? event.model : "unknown";
    const sessionId = typeof event.session_id === "string" ? event.session_id : "";
    process.stdout.write(pc.blue(`[openai] Session started — model: ${model}${sessionId ? ` | session: ${sessionId}` : ""}\n`));
    return;
  }

  if (type === "message.assistant") {
    const text = typeof event.text === "string" ? event.text : "";
    if (text) process.stdout.write(pc.green(`${text}\n`));
    return;
  }

  if (type === "tool_call") {
    const name = typeof event.name === "string" ? event.name : "tool";
    const input = typeof event.input === "string" ? event.input : JSON.stringify(event.input ?? "");
    process.stdout.write(pc.yellow(`[${name}] ${input.slice(0, 200)}\n`));
    return;
  }

  if (type === "tool_result") {
    const output = typeof event.output === "string" ? event.output : "";
    const isError = event.is_error === true;
    const exitCode = typeof event.exit_code === "number" ? ` (exit ${event.exit_code})` : "";
    const preview = output.slice(0, 300);
    if (isError) {
      process.stdout.write(pc.red(`[tool result${exitCode}] ${preview}\n`));
    } else if (debug) {
      process.stdout.write(pc.gray(`[tool result${exitCode}] ${preview}\n`));
    }
    return;
  }

  if (type === "response.done") {
    const inputTokens = typeof event.input_tokens === "number" ? event.input_tokens : 0;
    const outputTokens = typeof event.output_tokens === "number" ? event.output_tokens : 0;
    process.stdout.write(pc.blue(`[openai] Done — tokens: ${inputTokens} in / ${outputTokens} out\n`));
    return;
  }

  if (type === "error") {
    const message = typeof event.message === "string" ? event.message : String(event.message ?? "");
    process.stdout.write(pc.red(`[openai error] ${message}\n`));
    return;
  }

  if (debug) {
    process.stdout.write(pc.gray(`[openai] ${line}\n`));
  }
}
