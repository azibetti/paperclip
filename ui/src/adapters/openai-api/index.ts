import type { UIAdapterModule } from "../types";
import { parseOpenAIStdoutLine } from "@paperclipai/adapter-openai-api/ui";
import { buildOpenAIApiConfig } from "@paperclipai/adapter-openai-api/ui";
import { OpenAIApiConfigFields } from "./config-fields";

export const openAIApiUIAdapter: UIAdapterModule = {
  type: "openai_api",
  label: "OpenAI API",
  parseStdoutLine: parseOpenAIStdoutLine,
  ConfigFields: OpenAIApiConfigFields,
  buildAdapterConfig: buildOpenAIApiConfig,
};
