import { describe, expect, it } from "vitest";
import {
  agentProviderSessionAfterReport,
  agentResumePlan,
  agentSessionDirectiveAfterLoss,
  agentSessionDirectiveAfterReport,
  isAgentSessionNotFoundText,
} from "./agentSessionIdentity";

const OLD = "sess-0001-abcd";
const NEW = "sess-0002-beef";

describe("agentResumePlan", () => {
  it("resumes the persisted session or starts fresh when none exists", () => {
    expect(agentResumePlan(OLD, null)).toEqual({ kind: "resume", sessionId: OLD });
    expect(agentResumePlan(null, null)).toEqual({ kind: "fresh", reason: "noSession" });
  });

  it("applies a directive only while its basis is still the persisted session", () => {
    const adopted = { kind: "adopted", basisSessionId: OLD, sessionId: NEW } as const;
    expect(agentResumePlan(OLD, adopted)).toEqual({ kind: "resume", sessionId: NEW });
    expect(agentResumePlan(NEW, adopted)).toEqual({ kind: "resume", sessionId: NEW });
    expect(agentResumePlan("sess-0009-ffff", adopted)).toEqual({
      kind: "resume",
      sessionId: "sess-0009-ffff",
    });
    expect(agentResumePlan(OLD, { kind: "fresh", basisSessionId: OLD })).toEqual({
      kind: "fresh",
      reason: "sessionLost",
    });
  });
});

describe("agentSessionDirectiveAfterReport", () => {
  it("adopts a different id reported by a resumed Claude turn", () => {
    expect(
      agentSessionDirectiveAfterReport(OLD, null, {
        provider: "claudeCode",
        resumedSessionId: OLD,
        reportedSessionId: NEW,
      }),
    ).toEqual({ kind: "set", directive: { kind: "adopted", basisSessionId: OLD, sessionId: NEW } });
  });

  it("keeps the Codex session and ignores stale or invalid reports", () => {
    const report = { provider: "codex", resumedSessionId: OLD, reportedSessionId: NEW } as const;
    expect(agentSessionDirectiveAfterReport(OLD, null, report)).toEqual({ kind: "keep" });
    expect(
      agentSessionDirectiveAfterReport(OLD, null, {
        provider: "claudeCode",
        resumedSessionId: "sess-0007-aaaa",
        reportedSessionId: NEW,
      }),
    ).toEqual({ kind: "keep" });
    expect(
      agentSessionDirectiveAfterReport(OLD, null, {
        provider: "claudeCode",
        resumedSessionId: OLD,
        reportedSessionId: "not a session id!",
      }),
    ).toEqual({ kind: "keep" });
  });

  it("replaces a lost session with the one reported by the fresh turn", () => {
    const lost = { kind: "fresh", basisSessionId: OLD } as const;
    expect(
      agentSessionDirectiveAfterReport(OLD, lost, {
        provider: "codex",
        resumedSessionId: null,
        reportedSessionId: NEW,
      }),
    ).toEqual({ kind: "set", directive: { kind: "adopted", basisSessionId: OLD, sessionId: NEW } });
    expect(
      agentSessionDirectiveAfterReport(OLD, null, {
        provider: "codex",
        resumedSessionId: null,
        reportedSessionId: NEW,
      }),
    ).toEqual({ kind: "keep" });
  });
});

describe("agentSessionDirectiveAfterLoss", () => {
  it("marks only the session that was actually resumed as lost", () => {
    expect(agentSessionDirectiveAfterLoss(OLD, null, OLD)).toEqual({
      kind: "set",
      directive: { kind: "fresh", basisSessionId: OLD },
    });
    expect(agentSessionDirectiveAfterLoss(OLD, null, NEW)).toEqual({ kind: "keep" });
    expect(agentSessionDirectiveAfterLoss(null, null, OLD)).toEqual({ kind: "keep" });
  });
});

describe("agentProviderSessionAfterReport", () => {
  it("adopts Claude replacements but keeps an established Codex session", () => {
    expect(agentProviderSessionAfterReport({ kind: "claudeCode", sessionId: OLD }, NEW)).toEqual({
      kind: "claudeCode",
      sessionId: NEW,
    });
    expect(agentProviderSessionAfterReport({ kind: "codex", sessionId: OLD }, NEW)).toEqual({
      kind: "codex",
      sessionId: OLD,
    });
    expect(agentProviderSessionAfterReport({ kind: "codex", sessionId: null }, NEW)).toEqual({
      kind: "codex",
      sessionId: NEW,
    });
  });
});

describe("isAgentSessionNotFoundText", () => {
  it.each([
    ["claudeCode", `No conversation found with session ID: ${OLD}`],
    ["codex", "Error: no rollout found for thread id 0199"],
    ["codex", "Thread not found: 0199"],
  ] as const)("classifies %s resume failure wording: %s", (provider, text) => {
    expect(isAgentSessionNotFoundText(provider, text)).toBe(true);
  });

  it("ignores generic not-found wording and the other provider's wording", () => {
    expect(isAgentSessionNotFoundText("claudeCode", "MCP error: session not found")).toBe(false);
    expect(isAgentSessionNotFoundText("claudeCode", "Thread not found: 0199")).toBe(false);
    expect(
      isAgentSessionNotFoundText("codex", `No conversation found with session ID: ${OLD}`),
    ).toBe(false);
    expect(isAgentSessionNotFoundText("codex", "Rate limit reached")).toBe(false);
  });

  it("does not scan past the text bound", () => {
    expect(
      isAgentSessionNotFoundText(
        "claudeCode",
        `${"x".repeat(5_000)} no conversation found with session id`,
      ),
    ).toBe(false);
  });
});
