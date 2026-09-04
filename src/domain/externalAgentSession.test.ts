import { describe, expect, it } from "vitest";
import { AGENT_SESSION_ID_PATTERN, isAgentSessionId } from "./agentTask";
import {
  EXTERNAL_AGENT_SESSION_ID_PATTERN,
  MAX_EXTERNAL_SESSION_ENTRIES,
  MAX_PREVIEW_EXCHANGES,
  MAX_HISTORY_EXCHANGES,
  HISTORY_TOTAL_BYTES,
  parseExternalAgentSessionHistory,
  parseExternalAgentSessionPreview,
  parseExternalAgentSessionSummary,
  parseExternalSessionListSnapshot,
  validateExternalSessionId,
  validateExternalSessionProvider,
  validateExternalSessionRepositoryRoot,
} from "./externalAgentSession";

const CLAUDE_SESSION_ID = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";
const CODEX_SESSION_ID = "01a038a1-c2ee-7642-98e4-c94d7a479e0c";

describe("parseExternalAgentSessionHistory", () => {
  it("accepts original history beyond the separate preview limit", () => {
    const value = storedPreview({
      exchanges: Array.from({ length: 60 }, () => ({ role: "user", text: "á" })),
      totalPreviewBytes: 120,
    });
    expect(parseExternalAgentSessionHistory(value).exchanges).toHaveLength(60);
    expect(() => parseExternalAgentSessionPreview(value)).toThrow();
  });

  it("enforces exchange and actual UTF-8 byte limits and exact metadata", () => {
    expect(() =>
      parseExternalAgentSessionHistory(
        storedPreview({
          exchanges: Array.from({ length: MAX_HISTORY_EXCHANGES + 1 }, () => ({
            role: "user",
            text: "x",
          })),
          totalPreviewBytes: MAX_HISTORY_EXCHANGES + 1,
        }),
      ),
    ).toThrow();
    expect(() =>
      parseExternalAgentSessionHistory(
        storedPreview({
          exchanges: Array.from({ length: 9 }, () => ({
            role: "user",
            text: "x".repeat(16 * 1024),
          })),
          totalPreviewBytes: HISTORY_TOTAL_BYTES,
        }),
      ),
    ).toThrow();
    expect(() =>
      parseExternalAgentSessionHistory(
        storedPreview({ exchanges: [{ role: "user", text: "á" }], totalPreviewBytes: 1 }),
      ),
    ).toThrow(/actual total UTF-8/);
    expect(() =>
      parseExternalAgentSessionHistory(
        storedPreview({ exchanges: [], totalPreviewBytes: 0, unknown: true }),
      ),
    ).toThrow();
  });
});

function storedSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: "claudeCode",
    sessionId: CLAUDE_SESSION_ID,
    cwd: "/repo",
    title: "Security review multi-module release",
    firstPrompt: "first line\nsecond line",
    startedAtEpochMs: 1_700_000_000_000,
    lastActivityEpochMs: 1_700_000_500_000,
    turnCount: 6,
    turnCountExact: true,
    fileBytes: 331_000,
    ...overrides,
  };
}

function storedSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { sessions: [storedSummary()], skipped: 12, truncated: false, ...overrides };
}

function storedPreview(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: "codex",
    sessionId: CODEX_SESSION_ID,
    exchanges: [
      { role: "user", text: "remember mango" },
      { role: "assistant", text: "mango" },
    ],
    exchangesTruncated: true,
    totalPreviewBytes: 42,
    ...overrides,
  };
}

describe("externalAgentSession session ids", () => {
  it("accepts the verified claude and codex uuids and rejects everything else", () => {
    expect(validateExternalSessionId(CLAUDE_SESSION_ID)).toBe(CLAUDE_SESSION_ID);
    expect(validateExternalSessionId(CODEX_SESSION_ID)).toBe(CODEX_SESSION_ID);

    for (const candidate of [
      "",
      "not-a-uuid",
      `${CLAUDE_SESSION_ID}x`,
      `../${CLAUDE_SESSION_ID}`,
      "987b95ad_c9bc_4d08_ae49_9b431efc8f87",
      42,
      null,
    ]) {
      expect(() => validateExternalSessionId(candidate)).toThrow(TypeError);
    }
  });

  it("stays a strict subset of the agent resume session id contract", () => {
    expect(EXTERNAL_AGENT_SESSION_ID_PATTERN.test(CLAUDE_SESSION_ID)).toBe(true);
    expect(AGENT_SESSION_ID_PATTERN.test(CLAUDE_SESSION_ID)).toBe(true);
    expect(isAgentSessionId(CODEX_SESSION_ID)).toBe(true);
    expect(EXTERNAL_AGENT_SESSION_ID_PATTERN.test("agt-thread-0001")).toBe(false);
  });
});

describe("externalAgentSession scalars", () => {
  it("closes the provider enum over the agent CLI kinds", () => {
    expect(validateExternalSessionProvider("claudeCode")).toBe("claudeCode");
    expect(validateExternalSessionProvider("codex")).toBe("codex");

    for (const candidate of ["gemini", "", null, {}]) {
      expect(() => validateExternalSessionProvider(candidate)).toThrow(TypeError);
    }
  });

  it("requires an absolute bounded repository root", () => {
    expect(validateExternalSessionRepositoryRoot("/repo")).toBe("/repo");

    for (const candidate of ["", "repo", "/".padEnd(9_000, "a"), 7]) {
      expect(() => validateExternalSessionRepositoryRoot(candidate)).toThrow(TypeError);
    }
  });
});

describe("parseExternalSessionListSnapshot", () => {
  it("parses a valid bounded listing", () => {
    const parsed = parseExternalSessionListSnapshot(storedSnapshot());

    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].sessionId).toBe(CLAUDE_SESSION_ID);
    expect(parsed.sessions[0].turnCountExact).toBe(true);
    expect(parsed.skipped).toBe(12);
    expect(parsed.truncated).toBe(false);
  });

  it("accepts empty titles and prompts because a session may carry neither", () => {
    const parsed = parseExternalSessionListSnapshot(
      storedSnapshot({ sessions: [storedSummary({ title: "", firstPrompt: "" })] }),
    );

    expect(parsed.sessions[0].title).toBe("");
    expect(parsed.sessions[0].firstPrompt).toBe("");
  });

  it("rejects unknown keys at every depth", () => {
    expect(() => parseExternalSessionListSnapshot(storedSnapshot({ extra: 1 }))).toThrow(TypeError);
    expect(() =>
      parseExternalSessionListSnapshot(storedSnapshot({ sessions: [storedSummary({ extra: 1 })] })),
    ).toThrow(/sessions\[0\]/);
  });

  it("rejects an unknown provider, a malformed id and a duplicated session", () => {
    expect(() =>
      parseExternalSessionListSnapshot(
        storedSnapshot({ sessions: [storedSummary({ provider: "vscode" })] }),
      ),
    ).toThrow(/provider/);
    expect(() =>
      parseExternalSessionListSnapshot(
        storedSnapshot({ sessions: [storedSummary({ sessionId: "nope" })] }),
      ),
    ).toThrow(/sessionId/);
    expect(() =>
      parseExternalSessionListSnapshot(
        storedSnapshot({ sessions: [storedSummary(), storedSummary()] }),
      ),
    ).toThrow(/sessions\[1\]/);
  });

  it("rejects an oversized listing and malformed counters", () => {
    const oversized = Array.from({ length: MAX_EXTERNAL_SESSION_ENTRIES + 1 }, () =>
      storedSummary(),
    );
    expect(() => parseExternalSessionListSnapshot(storedSnapshot({ sessions: oversized }))).toThrow(
      /sessions/,
    );

    for (const skipped of [-1, 1.5, "3", null]) {
      expect(() => parseExternalSessionListSnapshot(storedSnapshot({ skipped }))).toThrow(
        /skipped/,
      );
    }
    expect(() => parseExternalSessionListSnapshot(storedSnapshot({ truncated: "yes" }))).toThrow(
      /truncated/,
    );
  });

  it("rejects malformed timestamps, counts and file sizes", () => {
    for (const field of ["startedAtEpochMs", "lastActivityEpochMs", "turnCount", "fileBytes"]) {
      expect(() => parseExternalAgentSessionSummary(storedSummary({ [field]: -1 }))).toThrow(
        new RegExp(field),
      );
    }
    expect(() => parseExternalAgentSessionSummary(storedSummary({ turnCountExact: 1 }))).toThrow(
      /turnCountExact/,
    );
  });
});

describe("parseExternalAgentSessionPreview", () => {
  it("parses bounded exchanges and the truncation flag", () => {
    const parsed = parseExternalAgentSessionPreview(storedPreview());

    expect(parsed.provider).toBe("codex");
    expect(parsed.exchanges.map((exchange) => exchange.role)).toEqual(["user", "assistant"]);
    expect(parsed.exchangesTruncated).toBe(true);
    expect(parsed.totalPreviewBytes).toBe(42);
  });

  it("rejects an unknown role, oversized exchanges and an over-cap byte total", () => {
    expect(() =>
      parseExternalAgentSessionPreview(
        storedPreview({ exchanges: [{ role: "system", text: "hi" }] }),
      ),
    ).toThrow(/role/);
    expect(() =>
      parseExternalAgentSessionPreview(
        storedPreview({
          exchanges: Array.from({ length: MAX_PREVIEW_EXCHANGES + 1 }, () => ({
            role: "user",
            text: "hi",
          })),
        }),
      ),
    ).toThrow(/exchanges/);
    expect(() =>
      parseExternalAgentSessionPreview(storedPreview({ totalPreviewBytes: 64 * 1_024 + 1 })),
    ).toThrow(/totalPreviewBytes/);
  });

  it("rejects a non-object payload and a missing key", () => {
    const { exchanges: _exchanges, ...missing } = storedPreview();

    expect(() => parseExternalAgentSessionPreview(null)).toThrow(TypeError);
    expect(() => parseExternalAgentSessionPreview([])).toThrow(TypeError);
    expect(() => parseExternalAgentSessionPreview(missing)).toThrow(TypeError);
  });
});
