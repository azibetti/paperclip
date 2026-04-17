import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
  DraftNumberInput,
  help,
} from "../../components/agent-config-primitives";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

export function OpenAIApiConfigFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
}: AdapterConfigFieldsProps) {
  return (
    <>
      <Field label="Working directory" hint={help.cwd}>
        <DraftInput
          value={
            isCreate
              ? values!.cwd ?? ""
              : eff("adapterConfig", "cwd", String(config.cwd ?? ""))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ cwd: v })
              : mark("adapterConfig", "cwd", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="/absolute/path/to/project"
        />
      </Field>

      <Field
        label="System prompt"
        hint="Custom instructions injected as the system message on every run. Leave empty to use the built-in Paperclip agent system prompt."
      >
        <DraftInput
          value={
            isCreate
              ? values!.instructionsFilePath ?? ""
              : eff("adapterConfig", "systemPrompt", String(config.systemPrompt ?? ""))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ instructionsFilePath: v })
              : mark("adapterConfig", "systemPrompt", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="You are a senior software engineer working on..."
        />
      </Field>

      <Field label="Custom API base URL" hint="Leave empty to use https://api.openai.com/v1. Set this for OpenAI-compatible providers (Azure OpenAI, Groq, Ollama, etc.).">
        <DraftInput
          value={
            isCreate
              ? String((values!.adapterSchemaValues?.apiBaseUrl as string | undefined) ?? "")
              : eff("adapterConfig", "apiBaseUrl", String(config.apiBaseUrl ?? ""))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ adapterSchemaValues: { ...values!.adapterSchemaValues, apiBaseUrl: v } })
              : mark("adapterConfig", "apiBaseUrl", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="https://api.openai.com/v1"
        />
      </Field>

      <Field label="Run timeout (seconds)" hint={help.timeoutSec}>
        <DraftNumberInput
          value={
            isCreate
              ? Number((values!.adapterSchemaValues?.timeoutSec as number | undefined) ?? 600)
              : eff("adapterConfig", "timeoutSec", Number(config.timeoutSec ?? 600))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ adapterSchemaValues: { ...values!.adapterSchemaValues, timeoutSec: v } })
              : mark("adapterConfig", "timeoutSec", v)
          }
          min={30}
          max={7200}
          className={inputClass}
        />
      </Field>

      <Field
        label="Max iterations"
        hint="Maximum number of tool-call rounds per run. Prevents runaway agent loops. Default: 30."
      >
        <DraftNumberInput
          value={
            isCreate
              ? Number((values!.adapterSchemaValues?.maxIterations as number | undefined) ?? 30)
              : eff("adapterConfig", "maxIterations", Number(config.maxIterations ?? 30))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ adapterSchemaValues: { ...values!.adapterSchemaValues, maxIterations: v } })
              : mark("adapterConfig", "maxIterations", v)
          }
          min={1}
          max={100}
          className={inputClass}
        />
      </Field>
    </>
  );
}
