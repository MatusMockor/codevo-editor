import { createServer } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PERF_AUTORUN_ENDPOINT_ENV,
  PERF_AUTORUN_RESULT_PATH,
  PERF_AUTORUN_RUNNER_PATH,
  PERF_AUTORUN_SMOKE_ENV,
  PERF_AUTORUN_TOKEN_ENV,
  PERF_AUTORUN_TOKEN_HEADER,
} from "./perfAutorunRelay.mjs";
import { createPerfAutorunVitePlugin } from "./perfAutorunVitePlugin.mjs";

const openServers = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => closeServer(server)));
});

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

async function startCollectorServer() {
  const received = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.statusCode = 204;
      response.end();
    });
  });
  openServers.push(server);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return { endpoint: `http://127.0.0.1:${server.address().port}`, received };
}

function fakeViteServer(root) {
  const handlers = [];

  return {
    handlers,
    config: { root },
    middlewares: {
      use(handler) {
        handlers.push(handler);
      },
    },
  };
}

function fakeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    ended: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      this.body += chunk ?? "";
      this.ended = true;
    },
  };
}

function authenticatedHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    [PERF_AUTORUN_TOKEN_HEADER]: "run-token",
    ...extra,
  };
}

function requestWithBody(
  method,
  body,
  headers = authenticatedHeaders(),
  url = PERF_AUTORUN_RESULT_PATH,
) {
  const listeners = new Map();
  const request = {
    method,
    headers,
    url,
    destroy() {},
    on(event, listener) {
      listeners.set(event, listener);

      return request;
    },
  };

  queueMicrotask(() => {
    if (body.length > 0) {
      listeners.get("data")?.(Buffer.from(body, "utf8"));
    }

    listeners.get("end")?.();
  });

  return request;
}

async function installedRelay(env, root = "/repo") {
  const plugin = createPerfAutorunVitePlugin({ env });
  const server = fakeViteServer(root);
  await plugin.configureServer(server);

  expect(server.handlers).toHaveLength(1);

  return server.handlers[0];
}

function getRequest(url) {
  return { method: "GET", url, headers: {}, on: () => {} };
}

function enabledEnv(endpoint, extra = {}) {
  return {
    VITE_CODEVO_PERF_AUTORUN: "1",
    [PERF_AUTORUN_ENDPOINT_ENV]: endpoint,
    [PERF_AUTORUN_TOKEN_ENV]: "run-token",
    ...extra,
  };
}

async function waitForResponse(response) {
  for (let attempt = 0; attempt < 200 && !response.ended; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  return response;
}

describe("createPerfAutorunVitePlugin", () => {
  it("installs nothing when the autorun flag is unset", () => {
    expect(createPerfAutorunVitePlugin({ env: {} })).toBeNull();
  });

  it("installs nothing when no driver endpoint is present", () => {
    expect(createPerfAutorunVitePlugin({ env: { VITE_CODEVO_PERF_AUTORUN: "1" } })).toBeNull();
  });

  it("installs nothing when the driver run token is missing", () => {
    expect(
      createPerfAutorunVitePlugin({
        env: {
          VITE_CODEVO_PERF_AUTORUN: "1",
          [PERF_AUTORUN_ENDPOINT_ENV]: "http://127.0.0.1:1",
        },
      }),
    ).toBeNull();
  });

  it("only applies to the dev server", () => {
    const plugin = createPerfAutorunVitePlugin({ env: enabledEnv("http://127.0.0.1:1") });

    expect(plugin.apply).toBe("serve");
    expect(plugin.name).toContain("perf-autorun");
  });

  it("serves the shared in-page runner as a module carrying the run options and token", async () => {
    const relay = await installedRelay(enabledEnv("http://127.0.0.1:1"), "/repo");
    const response = fakeResponse();
    relay(getRequest(PERF_AUTORUN_RUNNER_PATH), response, () => {});

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.body).toContain("async function runCodevoPerfScenarios(options)");
    expect(response.body).toContain(path.join("/repo", "perf/fixtures/large-files"));
    expect(response.body).toContain('"smoke":false');
    expect(response.body).toContain('export const perfAutorunRunToken = "run-token"');
  });

  it("passes the smoke flag from the driver environment into the served options", async () => {
    const relay = await installedRelay(
      enabledEnv("http://127.0.0.1:1", { [PERF_AUTORUN_SMOKE_ENV]: "1" }),
    );
    const response = fakeResponse();
    relay(getRequest(PERF_AUTORUN_RUNNER_PATH), response, () => {});

    expect(response.body).toContain('"smoke":true');
  });

  it("forwards a posted result carrying this run's token to the driver result server", async () => {
    const collector = await startCollectorServer();
    const relay = await installedRelay(enabledEnv(collector.endpoint));
    const response = fakeResponse();
    const payload = JSON.stringify({ status: "ok", result: { bridgeResults: [] } });
    relay(requestWithBody("POST", payload), response, () => {});
    await waitForResponse(response);

    expect(response.statusCode).toBe(204);
    expect(collector.received).toHaveLength(1);
    expect(collector.received[0].method).toBe("POST");
    expect(collector.received[0].body).toBe(payload);
    expect(collector.received[0].headers[PERF_AUTORUN_TOKEN_HEADER]).toBe("run-token");
  });

  it("rejects an unauthenticated local post and never attaches the run token to it", async () => {
    const collector = await startCollectorServer();
    const relay = await installedRelay(enabledEnv(collector.endpoint));
    const response = fakeResponse();
    relay(
      requestWithBody("POST", '{"status":"error","message":"forged abort"}', {
        "content-type": "application/json",
      }),
      response,
      () => {},
    );
    await waitForResponse(response);

    expect(response.statusCode).toBe(403);
    expect(collector.received).toHaveLength(0);
  });

  it("rejects a post carrying a wrong run token", async () => {
    const collector = await startCollectorServer();
    const relay = await installedRelay(enabledEnv(collector.endpoint));
    const response = fakeResponse();
    relay(
      requestWithBody(
        "POST",
        '{"status":"ok","result":{"bridgeResults":[]}}',
        authenticatedHeaders({ [PERF_AUTORUN_TOKEN_HEADER]: "run-tokeN" }),
      ),
      response,
      () => {},
    );
    await waitForResponse(response);

    expect(response.statusCode).toBe(403);
    expect(collector.received).toHaveLength(0);
  });

  it("rejects a cross-origin simple post that cannot carry a JSON content type", async () => {
    const collector = await startCollectorServer();
    const relay = await installedRelay(enabledEnv(collector.endpoint));
    const response = fakeResponse();
    relay(
      requestWithBody(
        "POST",
        '{"status":"ok"}',
        authenticatedHeaders({ "content-type": "text/plain" }),
      ),
      response,
      () => {},
    );
    await waitForResponse(response);

    expect(response.statusCode).toBe(415);
    expect(collector.received).toHaveLength(0);
  });

  it("matches both perf routes exactly and passes every other request along", async () => {
    const collector = await startCollectorServer();
    const relay = await installedRelay(enabledEnv(collector.endpoint));
    const nested = fakeResponse();
    let nestedNext = 0;
    relay(
      requestWithBody("POST", "{}", authenticatedHeaders(), `${PERF_AUTORUN_RESULT_PATH}/extra`),
      nested,
      () => {
        nestedNext += 1;
      },
    );
    const runnerNested = fakeResponse();
    let runnerNext = 0;
    relay(getRequest(`${PERF_AUTORUN_RUNNER_PATH}.map`), runnerNested, () => {
      runnerNext += 1;
    });
    const unrelated = fakeResponse();
    let unrelatedNext = 0;
    relay(getRequest("/src/main.tsx"), unrelated, () => {
      unrelatedNext += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(nestedNext).toBe(1);
    expect(nested.ended).toBe(false);
    expect(runnerNext).toBe(1);
    expect(runnerNested.ended).toBe(false);
    expect(unrelatedNext).toBe(1);
    expect(unrelated.ended).toBe(false);
    expect(collector.received).toHaveLength(0);
  });

  it("serves the result route even when the request carries a query string", async () => {
    const collector = await startCollectorServer();
    const relay = await installedRelay(enabledEnv(collector.endpoint));
    const response = fakeResponse();
    relay(
      requestWithBody(
        "POST",
        '{"status":"ok","result":{"bridgeResults":[]}}',
        authenticatedHeaders(),
        `${PERF_AUTORUN_RESULT_PATH}?run=1`,
      ),
      response,
      () => {},
    );
    await waitForResponse(response);

    expect(response.statusCode).toBe(204);
    expect(collector.received).toHaveLength(1);
  });

  it("reports a failure to reach the driver result server instead of throwing", async () => {
    const relay = await installedRelay(enabledEnv("http://127.0.0.1:1"));
    const response = fakeResponse();
    relay(requestWithBody("POST", "{}"), response, () => {});
    await waitForResponse(response);

    expect(response.statusCode).toBe(502);
  });

  it("rejects a non-POST result request", async () => {
    const relay = await installedRelay(enabledEnv("http://127.0.0.1:1"));
    const response = fakeResponse();
    relay(getRequest(PERF_AUTORUN_RESULT_PATH), response, () => {});

    expect(response.statusCode).toBe(405);
  });

  it("rejects a result body over the relay size cap and tells the driver instead of stalling it", async () => {
    const collector = await startCollectorServer();
    const relay = await installedRelay(enabledEnv(collector.endpoint));
    const response = fakeResponse();
    const oversized = `{"padding":"${"x".repeat(9 * 1024 * 1024)}"}`;
    relay(requestWithBody("POST", oversized), response, () => {});
    await waitForResponse(response);

    for (let attempt = 0; attempt < 200 && collector.received.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(response.statusCode).toBe(413);
    expect(collector.received).toHaveLength(1);
    const forwarded = JSON.parse(collector.received[0].body);
    expect(forwarded.status).toBe("error");
    expect(forwarded.message).toMatch(/size cap/);
    expect(collector.received[0].headers[PERF_AUTORUN_TOKEN_HEADER]).toBe("run-token");
  });
});
