import { describe, expect, it } from "vitest";
import {
  parseAgentProviderSignInResult,
  validateAgentProviderSignInRequest,
  type AgentProviderSignInRequest,
} from "./agentProviderSignIn";

const REQUEST: AgentProviderSignInRequest = {
  provider: "claudeCode",
  providerGeneration: 7,
  size: { cols: 100, rows: 30 },
};

describe("agent provider sign-in contract", () => {
  it("accepts the minimal semantic PTY request and returns a fresh closed value", () => {
    const parsed = validateAgentProviderSignInRequest(REQUEST);

    expect(parsed).toEqual(REQUEST);
    expect(parsed).not.toBe(REQUEST);
    expect(parsed.size).not.toBe(REQUEST.size);
    expect(Object.keys(parsed)).toEqual(["provider", "providerGeneration", "size"]);
  });

  it.each([
    { ...REQUEST, provider: "cursor" },
    { ...REQUEST, providerGeneration: 0 },
    { ...REQUEST, providerGeneration: -1 },
    { ...REQUEST, providerGeneration: 1.5 },
    { ...REQUEST, size: { cols: 0, rows: 30 } },
    { ...REQUEST, size: { cols: 100, rows: 65_536 } },
    { ...REQUEST, size: { cols: 100 } },
    { ...REQUEST, size: { cols: 100, rows: 30, pixels: 1 } },
    { ...REQUEST, cliPath: "/usr/local/bin/claude" },
    { ...REQUEST, argv: ["auth", "login"] },
    { ...REQUEST, env: { TOKEN: "secret" } },
    { ...REQUEST, credential: "secret" },
  ])("rejects malformed or authority-expanding outbound data %#", (request) => {
    expect(() => validateAgentProviderSignInRequest(request)).toThrow(TypeError);
  });

  it("rejects symbol, non-enumerable, and inherited request fields", () => {
    const symbolField = { ...REQUEST } as AgentProviderSignInRequest & Record<symbol, string>;
    symbolField[Symbol("credential")] = "secret";

    const nonEnumerableExtra = { ...REQUEST };
    Object.defineProperty(nonEnumerableExtra, "credential", {
      enumerable: false,
      value: "secret",
    });

    const nonEnumerableRequired = { ...REQUEST };
    Object.defineProperty(nonEnumerableRequired, "provider", {
      enumerable: false,
      value: "claudeCode",
    });

    const inheritedRequired = Object.assign(Object.create({ provider: "claudeCode" }), {
      providerGeneration: 7,
      size: { cols: 100, rows: 30 },
    });

    for (const request of [
      symbolField,
      nonEnumerableExtra,
      nonEnumerableRequired,
      inheritedRequired,
    ]) {
      expect(() => validateAgentProviderSignInRequest(request)).toThrow(TypeError);
    }
  });

  it("parses started and refused responses with exact authority", () => {
    expect(
      parseAgentProviderSignInResult({
        kind: "started",
        provider: "claudeCode",
        providerGeneration: 7,
        sessionId: 11,
      }),
    ).toEqual({
      kind: "started",
      provider: "claudeCode",
      providerGeneration: 7,
      sessionId: 11,
    });
    expect(
      parseAgentProviderSignInResult({
        kind: "refused",
        provider: "codex",
        providerGeneration: 9,
        reason: "turnActive",
      }),
    ).toEqual({
      kind: "refused",
      provider: "codex",
      providerGeneration: 9,
      reason: "turnActive",
    });
  });

  it.each([
    { kind: "started", provider: "codex", providerGeneration: 1, sessionId: 0 },
    {
      kind: "started",
      provider: "codex",
      providerGeneration: 1,
      sessionId: 2,
      token: "secret",
    },
    { kind: "refused", provider: "codex", providerGeneration: 1, reason: "network" },
    {
      kind: "refused",
      provider: "codex",
      providerGeneration: 1,
      reason: "spawnFailed",
      output: "raw output",
    },
    { kind: "completed", provider: "codex", providerGeneration: 1, sessionId: 2 },
  ])("rejects malformed or secret-bearing inbound data %#", (result) => {
    expect(() => parseAgentProviderSignInResult(result)).toThrow(TypeError);
  });

  it("rejects symbol, non-enumerable, and inherited response fields", () => {
    const started = {
      kind: "started",
      provider: "codex",
      providerGeneration: 1,
      sessionId: 2,
    };
    const symbolField = { ...started } as typeof started & Record<symbol, string>;
    symbolField[Symbol("token")] = "secret";

    const nonEnumerableExtra = { ...started };
    Object.defineProperty(nonEnumerableExtra, "token", {
      enumerable: false,
      value: "secret",
    });

    const nonEnumerableRequired = { ...started };
    Object.defineProperty(nonEnumerableRequired, "sessionId", {
      enumerable: false,
      value: 2,
    });

    const inheritedRequired = Object.assign(Object.create({ sessionId: 2 }), {
      kind: "started",
      provider: "codex",
      providerGeneration: 1,
    });

    for (const result of [
      symbolField,
      nonEnumerableExtra,
      nonEnumerableRequired,
      inheritedRequired,
    ]) {
      expect(() => parseAgentProviderSignInResult(result)).toThrow(TypeError);
    }
  });
});
