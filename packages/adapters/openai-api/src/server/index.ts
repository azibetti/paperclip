import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";
import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";
import { parseOpenAIJsonl, isOpenAIUnknownSessionError } from "./parse.js";
import { serializeHistory, deserializeHistory } from "./execute.js";

export { execute, testEnvironment, parseOpenAIJsonl, isOpenAIUnknownSessionError };

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw) {
    const history = deserializeHistory(raw);
    if (history.length === 0) return null;
    return { messages: history };
  },
  serialize(params) {
    if (!params) return null;
    const history = deserializeHistory(params);
    if (history.length === 0) return null;
    return { messages: history };
  },
  getDisplayId(params) {
    if (!params) return null;
    const history = deserializeHistory(params);
    if (history.length === 0) return null;
    return `openai_session_${history.length}msgs`;
  },
};
