import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { connect } from "node:net";
import {
  PERF_AUTORUN_ENDPOINT_ENV,
  PERF_AUTORUN_FLAG_ENV,
  PERF_AUTORUN_SMOKE_ENV,
  PERF_AUTORUN_TOKEN_ENV,
  PERF_AUTORUN_TOKEN_HEADER,
  isJsonRequest,
  parseAutorunPayload,
  readBoundedBody,
  runTokenMatches,
} from "./perfAutorunRelay.mjs";

export const DEFAULT_AUTORUN_TIMEOUT_MS = 20 * 60 * 1000;
export const MAX_AUTORUN_TIMEOUT_MS = 30 * 60 * 1000;
export const DEV_SERVER_PORT = 1420;
export const FOCUS_ONLY_WINDOW_MODE = "focus-only";
export const DIAGNOSTIC_ELEVATION_WINDOW_MODE = "always-on-top-diagnostic";
const LOOPBACK_PROBE_HOSTS = ["127.0.0.1", "::1"];
const RESULT_ROUTE = "/result";
const PORT_PROBE_TIMEOUT_MS = 500;
const STOP_GRACE_MS = 10000;

export function parseAutorunTimeoutMs(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--autorun-timeout-ms requires a positive integer timeout, got "${value}".`);
  }

  if (parsed > MAX_AUTORUN_TIMEOUT_MS) {
    throw new Error(
      `--autorun-timeout-ms must stay at or below ${MAX_AUTORUN_TIMEOUT_MS} ms (30 minutes).`,
    );
  }

  return parsed;
}

export async function assertPortFree(port, hosts = LOOPBACK_PROBE_HOSTS) {
  for (const host of hosts) {
    await assertHostPortFree(port, host);
  }
}

function assertHostPortFree(port, host) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let settled = false;

    const settle = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    socket.setTimeout(PORT_PROBE_TIMEOUT_MS, () => {
      settle(null);
    });
    socket.on("connect", () => {
      settle(
        new Error(
          `Port ${port} on ${host} is already in use. The autorun lane owns the app lifecycle: stop the running Codevo dev session (or any other listener on ${port}) and run it again.`,
        ),
      );
    });
    socket.on("error", () => {
      settle(null);
    });
  });
}

export async function startAutorunResultServer({ host = "127.0.0.1", port = 0, token } = {}) {
  let deliver = () => {};
  const received = new Promise((resolve) => {
    deliver = resolve;
  });
  const server = createServer((request, response) => {
    void handleRequest(request, response, { deliver, token });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    endpoint: `http://${host}:${server.address().port}`,
    received,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => {
          resolve();
        });
      }),
  };
}

export async function runAutorunLane({
  smoke,
  diagnosticElevation = false,
  timeoutMs = DEFAULT_AUTORUN_TIMEOUT_MS,
  repoRoot,
  launchApp = spawnDebugTauri,
}) {
  const token = randomUUID();
  const server = await startAutorunResultServer({ token });
  const env = {
    [PERF_AUTORUN_FLAG_ENV]: "1",
    VITE_CODEVO_PERF_BRIDGE: "1",
    VITE_CODEVO_QA_BRIDGE: "1",
    VITE_CODEVO_PERF_WINDOW_MODE: diagnosticElevation
      ? DIAGNOSTIC_ELEVATION_WINDOW_MODE
      : FOCUS_ONLY_WINDOW_MODE,
    [PERF_AUTORUN_SMOKE_ENV]: smoke ? "1" : "0",
    [PERF_AUTORUN_ENDPOINT_ENV]: server.endpoint,
    [PERF_AUTORUN_TOKEN_ENV]: token,
  };

  try {
    const app = launchApp({ endpoint: server.endpoint, env, repoRoot });

    return await awaitAutorunResult({ app, server, timeoutMs });
  } finally {
    await server.close();
  }
}

async function awaitAutorunResult({ app, server, timeoutMs }) {
  let timer = null;

  try {
    const timedOut = Symbol("autorun-timeout");
    const exitedEarly = Symbol("autorun-app-exit");
    const outcome = await Promise.race([
      server.received,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(timedOut), timeoutMs);
      }),
      app.exited.then((status) => ({ exitedEarly, status })),
    ]);

    if (outcome === timedOut) {
      return failed(
        `Perf autorun timed out: the app never posted a result within ${timeoutMs} ms.`,
      );
    }

    if (outcome.exitedEarly === exitedEarly) {
      return failed(
        `Perf autorun failed: the app exited before posting a result (${describeExit(outcome.status)}).`,
      );
    }

    if (outcome.kind === "error") {
      return failed(`Perf autorun failed inside the app: ${outcome.message}`);
    }

    if (outcome.kind === "invalid") {
      return failed(`Perf autorun rejected the posted payload: ${outcome.message}`);
    }

    return { status: "ok", result: outcome.result };
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }

    await app.stop();
  }
}

export function spawnDebugTauri({ env, repoRoot, spawnProcess = spawn }) {
  const child = spawnProcess("npm", ["run", "debug:tauri"], {
    cwd: repoRoot,
    detached: true,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  let settle = () => {};
  const exited = new Promise((resolve) => {
    settle = resolve;
  });
  let running = true;
  const finish = (status) => {
    if (!running) {
      return;
    }

    running = false;
    settle(status);
  };

  child.once("exit", (code, signal) => {
    finish({ code, signal, error: null });
  });
  child.on("error", (error) => {
    finish({
      code: null,
      signal: null,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return {
    exited,
    async stop() {
      if (!running) {
        return;
      }

      killGroup(child, "SIGTERM");
      const stopped = await Promise.race([exited.then(() => true), delay(STOP_GRACE_MS)]);

      if (stopped === true) {
        return;
      }

      killGroup(child, "SIGKILL");
      await Promise.race([exited, delay(STOP_GRACE_MS)]);
      finish({ code: null, signal: "SIGKILL", error: "the app process group did not report exit" });
    },
  };
}

function describeExit(status) {
  if (status.error) {
    return `launch failed: ${status.error}`;
  }

  return `code ${status.code}, signal ${status.signal}`;
}

function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      return;
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleRequest(request, response, { deliver, token }) {
  if (request.method !== "POST" || requestPath(request) !== RESULT_ROUTE) {
    reply(response, 404, "Perf autorun result server accepts POST /result only.");
    return;
  }

  if (!isJsonRequest(request)) {
    reply(response, 415, "Perf autorun result server accepts application/json only.");
    return;
  }

  if (!runTokenMatches(request.headers[PERF_AUTORUN_TOKEN_HEADER], token)) {
    reply(response, 403, "Perf autorun result server rejected a post without this run's token.");
    return;
  }

  const body = await readBoundedBody(request);

  if (body === null) {
    reply(response, 413, "Perf autorun payload exceeded the result server size cap.");
    deliver({
      kind: "invalid",
      message: "the posted payload exceeded the result server size cap",
    });
    return;
  }

  const payload = parseAutorunPayload(body);

  if (payload.kind === "invalid") {
    reply(response, 400, payload.message);
    deliver(payload);
    return;
  }

  reply(response, 204, "");
  deliver(payload);
}

function requestPath(request) {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

function reply(response, statusCode, message) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(message);
}

function failed(message) {
  return { status: "failed", message };
}
