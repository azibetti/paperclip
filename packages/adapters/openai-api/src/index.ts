export const type = "openai_api";
export const label = "OpenAI API";
export const DEFAULT_OPENAI_API_MODEL = "gpt-5-mini";

export const models = [
  { id: "gpt-5-mini", label: "GPT-5 Mini" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
  { id: "o3", label: "o3" },
  { id: "o3-mini", label: "o3 Mini" },
  { id: "o4-mini", label: "o4-mini" },
  { id: "o1", label: "o1" },
  { id: "o1-mini", label: "o1 Mini" },
];

export const agentConfigurationDoc = `# openai_api agent configuration

Adapter: openai_api

Use when:
- You want to run an OpenAI model (GPT-4o, o3, o1, etc.) directly via the OpenAI API without any CLI installed
- You want a self-contained agent that uses a bash tool to execute shell commands on the host
- You need stateful conversation across runs (history stored in session)
- OPENAI_API_KEY is available in the environment

Don't use when:
- The Codex CLI is installed and you want full Codex agent capabilities (use codex_local instead)
- You need CLI-native features like Codex's built-in file editing tools
- You want a simple one-shot script (use the process adapter instead)

Core fields:
- cwd (string, optional): absolute working directory for tool execution (created if missing)
- model (string, optional): OpenAI model id (default: gpt-4o)
- systemPrompt (string, optional): custom system prompt prepended to every run
- promptTemplate (string, optional): run prompt template (supports {{agent.id}}, {{runId}}, etc.)
- maxIterations (number, optional): maximum tool-call rounds per run (default: 30)
- maxHistoryMessages (number, optional): maximum messages kept in session history (default: 100)
- apiBaseUrl (string, optional): custom OpenAI-compatible API base URL (default: https://api.openai.com/v1)
- env (object, optional): KEY=VALUE environment variables injected into tool execution

Operational fields:
- timeoutSec (number, optional): run timeout in seconds (default: 600)

Security notes:
- OPENAI_API_KEY must be set in the server environment or in the env config field
- The bash tool executes commands in the configured cwd with the server's OS permissions
- Use timeoutSec and maxIterations to prevent runaway executions
`;
