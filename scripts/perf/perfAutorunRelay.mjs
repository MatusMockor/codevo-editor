import { timingSafeEqual } from "node:crypto";
import { inPagePerfRunnerSource } from "./perfScenarios.mjs";
import { normalizeRunnerResult } from "./runPerfScenariosCli.mjs";

export const PERF_AUTORUN_RUNNER_PATH = "/__codevo-perf/runner.js";
export const PERF_AUTORUN_RESULT_PATH = "/__codevo-perf/result";
export const PERF_AUTORUN_FLAG_ENV = "VITE_CODEVO_PERF_AUTORUN";
export const PERF_AUTORUN_ENDPOINT_ENV = "CODEVO_PERF_AUTORUN_ENDPOINT";
export const PERF_AUTORUN_SMOKE_ENV = "CODEVO_PERF_AUTORUN_SMOKE";
export const PERF_AUTORUN_TOKEN_ENV = "CODEVO_PERF_AUTORUN_TOKEN";
export const PERF_AUTORUN_TOKEN_HEADER = "x-codevo-perf-run-token";
export const PERF_AUTORUN_CONTENT_TYPE = "application/json";
export const MAX_AUTORUN_PAYLOAD_BYTES = 8 * 1024 * 1024;
const PAYLOAD_LABEL = "autorun payload";

export function perfAutorunRelayEnabled(env) {
  if (env[PERF_AUTORUN_FLAG_ENV] !== "1") {
    return false;
  }

  return autorunRelayEndpoint(env).length > 0 && autorunRelayToken(env).length > 0;
}

export function autorunRelayToken(env) {
  const token = env[PERF_AUTORUN_TOKEN_ENV];

  if (typeof token !== "string") {
    return "";
  }

  return token;
}

export function runTokenMatches(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string" || expected.length === 0) {
    return false;
  }

  const candidateBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  if (candidateBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(candidateBytes, expectedBytes);
}

export function isJsonRequest(request) {
  const contentType = request.headers?.["content-type"];

  if (typeof contentType !== "string") {
    return false;
  }

  return contentType.split(";")[0].trim().toLowerCase() === PERF_AUTORUN_CONTENT_TYPE;
}

export function readBoundedBody(request, maxBytes = MAX_AUTORUN_PAYLOAD_BYTES) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let overLimit = false;
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    };

    request.on("data", (chunk) => {
      size += chunk.length;

      if (size > maxBytes) {
        overLimit = true;
        chunks.length = 0;
        return;
      }

      chunks.push(chunk);
    });
    request.on("end", () => {
      finish(overLimit ? null : Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", () => {
      finish(null);
    });
    request.on("aborted", () => {
      finish(null);
    });
  });
}

export function autorunRelayEndpoint(env) {
  const endpoint = env[PERF_AUTORUN_ENDPOINT_ENV];

  if (typeof endpoint !== "string") {
    return "";
  }

  return endpoint;
}

export function autorunRelaySmoke(env) {
  return env[PERF_AUTORUN_SMOKE_ENV] === "1";
}

export function buildAutorunRunnerModule(options, runToken) {
  return [
    inPagePerfRunnerSource(),
    "",
    `export const perfAutorunOptions = ${JSON.stringify(options)};`,
    `export const perfAutorunRunToken = ${JSON.stringify(runToken)};`,
    "export default runCodevoPerfScenarios;",
    "",
  ].join("\n");
}

export function parseAutorunPayload(raw) {
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return invalid(`${PAYLOAD_LABEL} is not valid JSON: ${messageOf(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalid(`${PAYLOAD_LABEL} must be a JSON object.`);
  }

  if (parsed.status === "error") {
    if (typeof parsed.message !== "string" || parsed.message.length === 0) {
      return invalid(`${PAYLOAD_LABEL} with status "error" must carry a non-empty message.`);
    }

    return { kind: "error", message: parsed.message };
  }

  if (parsed.status !== "ok") {
    return invalid(
      `${PAYLOAD_LABEL} carries an unsupported status ${JSON.stringify(parsed.status)}.`,
    );
  }

  try {
    return { kind: "result", result: normalizeRunnerResult(parsed.result, PAYLOAD_LABEL) };
  } catch (error) {
    return invalid(messageOf(error));
  }
}

function invalid(message) {
  return { kind: "invalid", message };
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
