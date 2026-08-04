import {
  PERF_AUTORUN_CONTENT_TYPE,
  PERF_AUTORUN_RESULT_PATH,
  PERF_AUTORUN_RUNNER_PATH,
  PERF_AUTORUN_TOKEN_HEADER,
  autorunRelayEndpoint,
  autorunRelaySmoke,
  autorunRelayToken,
  buildAutorunRunnerModule,
  isJsonRequest,
  perfAutorunRelayEnabled,
  readBoundedBody,
  runTokenMatches,
} from "./perfAutorunRelay.mjs";
import { buildRunnerOptions } from "./runPerfScenariosCli.mjs";

const PLUGIN_NAME = "codevo-perf-autorun-relay";
const OVERSIZED_MESSAGE =
  "the app posted a result larger than the dev-server relay size cap, so it was never forwarded";

export function createPerfAutorunVitePlugin({ env }) {
  if (!perfAutorunRelayEnabled(env)) {
    return null;
  }

  const relay = {
    endpoint: autorunRelayEndpoint(env),
    token: autorunRelayToken(env),
    smoke: autorunRelaySmoke(env),
  };

  return {
    name: PLUGIN_NAME,
    apply: "serve",
    configureServer(server) {
      const options = buildRunnerOptions({ smoke: relay.smoke, repoRoot: server.config.root });

      server.middlewares.use((request, response, next) => {
        const route = requestPath(request);

        if (route === PERF_AUTORUN_RUNNER_PATH) {
          serveRunnerModule(options, relay.token, response);
          return;
        }

        if (route === PERF_AUTORUN_RESULT_PATH) {
          void relayResult(relay, request, response);
          return;
        }

        next();
      });
    },
  };
}

function requestPath(request) {
  try {
    return new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    return "";
  }
}

function serveRunnerModule(options, runToken, response) {
  response.statusCode = 200;
  response.setHeader("content-type", "application/javascript; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(buildAutorunRunnerModule(options, runToken));
}

async function relayResult(relay, request, response) {
  if (request.method !== "POST") {
    respond(response, 405, "Perf autorun relay accepts POST only.");
    return;
  }

  if (!isJsonRequest(request)) {
    respond(response, 415, `Perf autorun relay accepts ${PERF_AUTORUN_CONTENT_TYPE} only.`);
    return;
  }

  const postedToken = request.headers[PERF_AUTORUN_TOKEN_HEADER];

  if (!runTokenMatches(postedToken, relay.token)) {
    respond(response, 403, "Perf autorun relay rejected a post without this run's token.");
    return;
  }

  const body = await readBoundedBody(request);

  if (body === null) {
    respond(response, 413, "Perf autorun payload exceeded the dev-server relay size cap.");
    await forward(
      relay,
      postedToken,
      JSON.stringify({ status: "error", message: OVERSIZED_MESSAGE }),
    );
    return;
  }

  const forwarded = await forward(relay, postedToken, body);

  respond(response, forwarded.ok ? 204 : 502, forwarded.message);
}

async function forward(relay, runToken, body) {
  try {
    const response = await fetch(new URL("/result", relay.endpoint), {
      method: "POST",
      headers: {
        "content-type": PERF_AUTORUN_CONTENT_TYPE,
        [PERF_AUTORUN_TOKEN_HEADER]: runToken,
      },
      body,
    });

    if (response.ok) {
      return { ok: true, message: "" };
    }

    return {
      ok: false,
      message: `Perf autorun driver rejected the result with HTTP ${response.status}.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    return { ok: false, message: `Perf autorun relay could not reach the driver: ${detail}` };
  }
}

function respond(response, statusCode, message) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(message);
}
