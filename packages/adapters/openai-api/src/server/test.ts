import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((c) => c.level === "error")) return "fail";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "pass";
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const configEnv = parseObject(config.env) as Record<string, string>;

  // Check API key
  const apiKey =
    (typeof configEnv.OPENAI_API_KEY === "string" && configEnv.OPENAI_API_KEY.trim()) ||
    (typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.trim()) ||
    "";

  if (!apiKey) {
    checks.push({
      code: "openai_api_key_missing",
      level: "error",
      message: "OPENAI_API_KEY is not set",
      hint: "Set OPENAI_API_KEY in the server environment or in the agent env config field.",
    });
  } else {
    const maskedKey = `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
    checks.push({
      code: "openai_api_key_present",
      level: "info",
      message: `OPENAI_API_KEY is configured (${maskedKey})`,
    });
  }

  // Check API base URL if overridden
  const apiBaseUrl = asString(config.apiBaseUrl, "").trim();
  if (apiBaseUrl) {
    try {
      new URL(apiBaseUrl);
      checks.push({
        code: "openai_api_base_url_valid",
        level: "info",
        message: `Custom API base URL: ${apiBaseUrl}`,
      });
    } catch {
      checks.push({
        code: "openai_api_base_url_invalid",
        level: "error",
        message: `Invalid apiBaseUrl: ${apiBaseUrl}`,
        hint: "Provide a valid HTTP/HTTPS URL (e.g. https://api.openai.com/v1).",
      });
    }
  } else {
    checks.push({
      code: "openai_api_base_url_default",
      level: "info",
      message: "Using default OpenAI API: https://api.openai.com/v1",
    });
  }

  // Check model
  const model = asString(config.model, "gpt-4o").trim();
  checks.push({
    code: "openai_model_configured",
    level: "info",
    message: `Model: ${model}`,
  });

  // Probe API connectivity if key is present
  if (apiKey) {
    const effectiveBaseUrl = (apiBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    try {
      const signal = AbortSignal.timeout(10_000);
      const response = await fetch(`${effectiveBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });

      if (response.ok) {
        checks.push({
          code: "openai_api_reachable",
          level: "info",
          message: "OpenAI API is reachable and the API key is valid",
        });
      } else if (response.status === 401) {
        checks.push({
          code: "openai_api_unauthorized",
          level: "error",
          message: "OpenAI API key is invalid or unauthorized (HTTP 401)",
          hint: "Verify OPENAI_API_KEY is correct and has the necessary permissions.",
        });
      } else {
        checks.push({
          code: "openai_api_error",
          level: "warn",
          message: `OpenAI API returned HTTP ${response.status}`,
          detail: `GET ${effectiveBaseUrl}/models`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({
        code: "openai_api_unreachable",
        level: "warn",
        message: `Could not reach OpenAI API: ${msg.slice(0, 200)}`,
        hint: "Check network connectivity. Runs may still succeed if the network is available at execution time.",
      });
    }
  }

  return {
    adapterType: "openai_api",
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
