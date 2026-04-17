import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { DEFAULT_OPENAI_API_MODEL } from "../index.js";

export function buildOpenAIApiConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};

  if (v.cwd) ac.cwd = v.cwd;
  if (v.model) ac.model = v.model;
  // instructionsFilePath is used as the system prompt for the openai_api adapter
  if (v.instructionsFilePath) ac.systemPrompt = v.instructionsFilePath;
  if (v.promptTemplate) ac.promptTemplate = v.promptTemplate;

  const schemaValues = v.adapterSchemaValues ?? {};
  if (schemaValues.apiBaseUrl) ac.apiBaseUrl = schemaValues.apiBaseUrl;
  if (schemaValues.timeoutSec) ac.timeoutSec = schemaValues.timeoutSec;
  if (schemaValues.maxIterations) ac.maxIterations = schemaValues.maxIterations;

  if (!ac.timeoutSec) ac.timeoutSec = 600;
  if (!ac.maxIterations) ac.maxIterations = 30;

  return ac;
}
