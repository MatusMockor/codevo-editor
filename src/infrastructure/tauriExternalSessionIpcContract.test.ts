import { describe, expect, it, vi } from "vitest";
import {
  LIST_EXTERNAL_AGENT_SESSIONS_IPC_COMMAND,
  PREVIEW_EXTERNAL_AGENT_SESSION_IPC_COMMAND,
  invokeListExternalAgentSessionsIpc,
  invokePreviewExternalAgentSessionIpc,
  validateExternalSessionListRequest,
  validateExternalSessionPreviewRequest,
  validateExternalSessionHistoryRequest,
  invokeReadExternalAgentSessionHistoryIpc,
} from "./tauriExternalSessionIpcContract";

const SESSION_ID = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";

describe("external session history IPC", () => {
  const request = {
    provider: "codex" as const,
    sessionId: SESSION_ID,
    projectRoot: "/repo",
    repositoryRoot: "/repo",
    beforeEpochMs: 1_000,
  };
  it("forwards the immutable snapshot cutoff and rejects mismatched identity", async () => {
    const invokeCommand = vi.fn(async () => ({
      provider: "codex",
      sessionId: SESSION_ID,
      exchanges: [{ role: "assistant", text: "old answer" }],
      exchangesTruncated: false,
      totalPreviewBytes: 10,
    }));
    await expect(
      invokeReadExternalAgentSessionHistoryIpc(invokeCommand, request),
    ).resolves.toMatchObject({ exchanges: [{ text: "old answer" }] });
    expect(invokeCommand).toHaveBeenCalledWith("read_external_agent_session_history", { request });
    await expect(
      invokeReadExternalAgentSessionHistoryIpc(invokeCommand, {
        ...request,
        provider: "claudeCode",
      }),
    ).rejects.toThrow(/identity/);
  });
  it("refuses unknown fields and invalid cutoffs before invoking IPC", () => {
    for (const beforeEpochMs of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => validateExternalSessionHistoryRequest({ ...request, beforeEpochMs })).toThrow();
    }
    expect(() =>
      validateExternalSessionHistoryRequest({ ...request, extra: true } as never),
    ).toThrow();
    expect(
      validateExternalSessionHistoryRequest({ ...request, beforeEpochMs: 0 }).beforeEpochMs,
    ).toBe(0);
  });
});

function summary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: "claudeCode",
    sessionId: SESSION_ID,
    cwd: "/repo",
    title: "Terminal session",
    firstPrompt: "do the thing",
    startedAtEpochMs: 1_000,
    lastActivityEpochMs: 2_000,
    turnCount: 6,
    turnCountExact: false,
    fileBytes: 4_096,
    ...overrides,
  };
}

describe("tauriExternalSessionIpcContract requests", () => {
  it("validates the list and preview request shapes", () => {
    expect(
      validateExternalSessionListRequest({ projectRoot: "/repo", repositoryRoot: "/repo" }),
    ).toEqual({
      projectRoot: "/repo",
      repositoryRoot: "/repo",
    });
    expect(
      validateExternalSessionPreviewRequest({
        provider: "codex",
        sessionId: SESSION_ID,
        projectRoot: "/repo",
        repositoryRoot: "/repo",
      }),
    ).toEqual({
      provider: "codex",
      sessionId: SESSION_ID,
      projectRoot: "/repo",
      repositoryRoot: "/repo",
    });
  });

  it("refuses a relative root, an unknown provider and a malformed session id", () => {
    expect(() =>
      validateExternalSessionListRequest({ projectRoot: "/repo", repositoryRoot: "repo" }),
    ).toThrow(TypeError);
    expect(() =>
      validateExternalSessionPreviewRequest({
        provider: "vscode" as never,
        sessionId: SESSION_ID,
        projectRoot: "/repo",
        repositoryRoot: "/repo",
      }),
    ).toThrow(TypeError);
    expect(() =>
      validateExternalSessionPreviewRequest({
        provider: "codex",
        sessionId: "../etc/passwd",
        projectRoot: "/repo",
        repositoryRoot: "/repo",
      }),
    ).toThrow(TypeError);
  });
});

describe("invokeListExternalAgentSessionsIpc", () => {
  it("sends the validated request and parses the bounded snapshot", async () => {
    const invokeCommand = vi.fn(async () => ({
      sessions: [summary()],
      skipped: 3,
      truncated: true,
    }));

    const snapshot = await invokeListExternalAgentSessionsIpc(invokeCommand, {
      projectRoot: "/repo",
      repositoryRoot: "/repo",
    });

    expect(invokeCommand).toHaveBeenCalledWith(LIST_EXTERNAL_AGENT_SESSIONS_IPC_COMMAND, {
      request: { projectRoot: "/repo", repositoryRoot: "/repo" },
    });
    expect(snapshot.sessions[0].turnCount).toBe(6);
    expect(snapshot.skipped).toBe(3);
    expect(snapshot.truncated).toBe(true);
  });

  it("rejects a session echoed for a foreign repository root", async () => {
    const invokeCommand = vi.fn(async () => ({
      sessions: [summary({ cwd: "/other" })],
      skipped: 0,
      truncated: false,
    }));

    await expect(
      invokeListExternalAgentSessionsIpc(invokeCommand, {
        projectRoot: "/repo",
        repositoryRoot: "/repo",
      }),
    ).rejects.toThrow(TypeError);
  });

  it("accepts a session from a nested repository inside the requested scope", async () => {
    const invokeCommand = vi.fn(async () => ({
      sessions: [summary({ cwd: "/repo/packages/api" })],
      skipped: 0,
      truncated: false,
    }));

    await expect(
      invokeListExternalAgentSessionsIpc(invokeCommand, {
        projectRoot: "/repo",
        repositoryRoot: "/repo",
      }),
    ).resolves.toMatchObject({ sessions: [{ cwd: "/repo/packages/api" }] });
  });

  it("rejects a nested-looking session path that contains an alias segment", async () => {
    const invokeCommand = vi.fn(async () => ({
      sessions: [summary({ cwd: "/repo/../other" })],
      skipped: 0,
      truncated: false,
    }));

    await expect(
      invokeListExternalAgentSessionsIpc(invokeCommand, {
        projectRoot: "/repo",
        repositoryRoot: "/repo",
      }),
    ).rejects.toThrow(TypeError);
  });
});

describe("invokePreviewExternalAgentSessionIpc", () => {
  it("parses a preview for the requested identity", async () => {
    const invokeCommand = vi.fn(async () => ({
      provider: "claudeCode",
      sessionId: SESSION_ID,
      exchanges: [{ role: "user", text: "hi" }],
      exchangesTruncated: false,
      totalPreviewBytes: 2,
    }));

    const preview = await invokePreviewExternalAgentSessionIpc(invokeCommand, {
      provider: "claudeCode",
      sessionId: SESSION_ID,
      projectRoot: "/repo",
      repositoryRoot: "/repo",
    });

    expect(invokeCommand).toHaveBeenCalledWith(PREVIEW_EXTERNAL_AGENT_SESSION_IPC_COMMAND, {
      request: {
        provider: "claudeCode",
        sessionId: SESSION_ID,
        projectRoot: "/repo",
        repositoryRoot: "/repo",
      },
    });
    expect(preview.exchanges).toHaveLength(1);
  });

  it("rejects a preview answering with a different session identity", async () => {
    const invokeCommand = vi.fn(async () => ({
      provider: "codex",
      sessionId: SESSION_ID,
      exchanges: [],
      exchangesTruncated: false,
      totalPreviewBytes: 0,
    }));

    await expect(
      invokePreviewExternalAgentSessionIpc(invokeCommand, {
        provider: "claudeCode",
        sessionId: SESSION_ID,
        projectRoot: "/repo",
        repositoryRoot: "/repo",
      }),
    ).rejects.toThrow(TypeError);
  });
});
