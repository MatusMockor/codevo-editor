import { describe, expect, it } from "vitest";
import type {
  ExternalAgentSessionPreview,
  ExternalAgentSessionView,
} from "../../domain/externalAgentSession";
import {
  MAX_TERMINAL_SESSION_FILTER_CHARS,
  filterTerminalSessions,
  resolveTerminalSessionPreview,
  terminalSessionActionLabel,
  terminalSessionMetaSegments,
  terminalSessionRepositoryLabel,
  terminalSessionRoleChip,
  terminalSessionsEmptyNote,
} from "./agentTerminalSessionsPresentation";

const ROOT = "/workspace/app";

describe("agentTerminalSessionsPresentation", () => {
  it("labels a repository by its last path segment", () => {
    expect(terminalSessionRepositoryLabel(ROOT)).toBe("app");
    expect(terminalSessionRepositoryLabel(`${ROOT}/`)).toBe("app");
    expect(terminalSessionRepositoryLabel("/")).toBeNull();
    expect(terminalSessionRepositoryLabel(null)).toBeNull();
  });

  it("builds the meta line from provider, nested repository and turn count", () => {
    expect(terminalSessionMetaSegments(session({}), ROOT)).toEqual([
      { kind: "provider", text: "Claude Code" },
      { kind: "turns", text: "6 turns" },
    ]);
    expect(
      terminalSessionMetaSegments(
        session({ provider: "codex", cwd: `${ROOT}/packages/api`, turnCountExact: false }),
        ROOT,
      ),
    ).toEqual([
      { kind: "provider", text: "Codex" },
      { kind: "repository", text: "api" },
      { kind: "turns", text: "6+ turns" },
    ]);
    expect(terminalSessionMetaSegments(session({ turnCount: 1 }), null)).toEqual([
      { kind: "provider", text: "Claude Code" },
      { kind: "turns", text: "1 turn" },
    ]);
  });

  it("maps every exchange role to a chip label and class", () => {
    expect(terminalSessionRoleChip("user")).toEqual({
      label: "you",
      className: "agent-tsp__role agent-tsp__role--you",
    });
    expect(terminalSessionRoleChip("assistant")).toEqual({
      label: "agent",
      className: "agent-tsp__role",
    });
  });

  it("filters by title, session id and cwd with a bounded needle", () => {
    const sessions = [
      session({ sessionId: "a", title: "Fix the parser" }),
      session({ sessionId: "b", title: "", cwd: `${ROOT}/packages/crm` }),
    ];

    expect(filterTerminalSessions(sessions, "")).toBe(sessions);
    expect(filterTerminalSessions(sessions, "  PARSER ").map((item) => item.sessionId)).toEqual([
      "a",
    ]);
    expect(filterTerminalSessions(sessions, "packages/crm").map((item) => item.sessionId)).toEqual([
      "b",
    ]);
    expect(filterTerminalSessions(sessions, "b").map((item) => item.sessionId)).toEqual(["b"]);
    expect(
      filterTerminalSessions(sessions, `${"x".repeat(MAX_TERMINAL_SESSION_FILTER_CHARS)}parser`),
    ).toEqual([]);
  });

  it("names the primary action by import state", () => {
    expect(terminalSessionActionLabel(undefined, false)).toBe("Continue in Codevo");
    expect(terminalSessionActionLabel(session({}), true)).toBe("Importing…");
    expect(terminalSessionActionLabel(session({ alreadyImportedThreadId: "agt-1" }), false)).toBe(
      "Open imported thread",
    );
  });

  it("names the empty state after the repository when known", () => {
    expect(terminalSessionsEmptyNote("app")).toBe("No terminal sessions for app.");
    expect(terminalSessionsEmptyNote(null)).toBe("No terminal sessions for this project.");
  });

  it("resolves the preview state from the surface and the highlighted session", () => {
    const active = session({});
    const preview = previewFixture({});

    expect(
      resolveTerminalSessionPreview({ preview: null, previewPending: false }, null, null),
    ).toEqual({ kind: "idle" });
    expect(resolveTerminalSessionPreview({ preview, previewPending: false }, active, null)).toEqual(
      { kind: "ready", preview },
    );
    expect(
      resolveTerminalSessionPreview(
        { preview: null, previewPending: true },
        active,
        active.sessionId,
      ),
    ).toEqual({ kind: "loading" });
    expect(
      resolveTerminalSessionPreview(
        { preview: null, previewPending: false },
        active,
        active.sessionId,
      ),
    ).toEqual({ kind: "failed" });
    expect(
      resolveTerminalSessionPreview({ preview: null, previewPending: false }, active, "other"),
    ).toEqual({ kind: "loading" });
    expect(
      resolveTerminalSessionPreview(
        { preview: previewFixture({ sessionId: "other" }), previewPending: false },
        active,
        active.sessionId,
      ),
    ).toEqual({ kind: "failed" });
  });
});

function session(overrides: Partial<ExternalAgentSessionView>): ExternalAgentSessionView {
  return {
    provider: "claudeCode",
    sessionId: "34fbe185-0000-4000-8000-000000000001",
    cwd: ROOT,
    title: "Fix the parser",
    firstPrompt: "fix the parser crash",
    startedAtEpochMs: 0,
    lastActivityEpochMs: 0,
    turnCount: 6,
    turnCountExact: true,
    fileBytes: 4096,
    alreadyImportedThreadId: null,
    ...overrides,
  };
}

function previewFixture(
  overrides: Partial<ExternalAgentSessionPreview>,
): ExternalAgentSessionPreview {
  return {
    provider: "claudeCode",
    sessionId: "34fbe185-0000-4000-8000-000000000001",
    exchanges: [{ role: "user", text: "remember plum" }],
    exchangesTruncated: false,
    totalPreviewBytes: 128,
    ...overrides,
  };
}
