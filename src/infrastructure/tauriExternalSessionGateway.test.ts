import { describe, expect, it, vi } from "vitest";
import {
  MAX_EXTERNAL_SESSION_ERROR_CHARS,
  TauriExternalSessionGateway,
  type ExternalSessionRuntimeDetector,
} from "./tauriExternalSessionGateway";
import type { InvokeExternalSessionCommand } from "./tauriExternalSessionIpcContract";

const SESSION_ID = "987b95ad-c9bc-4d08-ae49-9b431efc8f87";
const OTHER_SESSION_ID = "01a038a1-c2ee-7642-98e4-c94d7a479e0c";

const available: ExternalSessionRuntimeDetector = () => true;
const unavailable: ExternalSessionRuntimeDetector = () => false;

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

describe("TauriExternalSessionGateway", () => {
  it("forwards both typed commands and returns parsed payloads", async () => {
    const invokeCommand = vi
      .fn<InvokeExternalSessionCommand>()
      .mockResolvedValueOnce({ sessions: [summary()], skipped: 3, truncated: true })
      .mockResolvedValueOnce({
        provider: "claudeCode",
        sessionId: SESSION_ID,
        exchanges: [{ role: "user", text: "hello" }],
        exchangesTruncated: true,
        totalPreviewBytes: 128,
      });
    const gateway = new TauriExternalSessionGateway(invokeCommand, available);

    const snapshot = await gateway.listExternalSessions({ repositoryRoot: "/repo" });
    const preview = await gateway.previewExternalSession({
      provider: "claudeCode",
      sessionId: SESSION_ID,
      repositoryRoot: "/repo",
    });

    expect(snapshot).toEqual({ sessions: [summary()], skipped: 3, truncated: true });
    expect(preview.exchanges).toEqual([{ role: "user", text: "hello" }]);
    expect(preview.exchangesTruncated).toBe(true);
    expect(invokeCommand.mock.calls).toEqual([
      ["list_external_agent_sessions", { request: { repositoryRoot: "/repo" } }],
      [
        "preview_external_agent_session",
        { request: { provider: "claudeCode", sessionId: SESSION_ID, repositoryRoot: "/repo" } },
      ],
    ]);
  });

  it("returns empty results without invoking IPC outside the Tauri runtime", async () => {
    const invokeCommand = vi.fn<InvokeExternalSessionCommand>();
    const gateway = new TauriExternalSessionGateway(invokeCommand, unavailable);

    const snapshot = await gateway.listExternalSessions({ repositoryRoot: "/repo" });
    const preview = await gateway.previewExternalSession({
      provider: "codex",
      sessionId: SESSION_ID,
      repositoryRoot: "/repo",
    });

    expect(snapshot).toEqual({ sessions: [], skipped: 0, truncated: false });
    expect(preview).toEqual({
      provider: "codex",
      sessionId: SESSION_ID,
      exchanges: [],
      exchangesTruncated: false,
      totalPreviewBytes: 0,
    });
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects malformed requests before touching the runtime", async () => {
    const invokeCommand = vi.fn<InvokeExternalSessionCommand>();
    const gateway = new TauriExternalSessionGateway(invokeCommand, unavailable);

    await expect(gateway.listExternalSessions({ repositoryRoot: "relative" })).rejects.toThrow(
      TypeError,
    );
    await expect(
      gateway.previewExternalSession({
        provider: "codex",
        sessionId: "../../etc/passwd",
        repositoryRoot: "/repo",
      }),
    ).rejects.toThrow(TypeError);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects a snapshot whose session belongs to another repository root", async () => {
    const invokeCommand = vi
      .fn<InvokeExternalSessionCommand>()
      .mockResolvedValue({ sessions: [summary({ cwd: "/other" })], skipped: 0, truncated: false });
    const gateway = new TauriExternalSessionGateway(invokeCommand, available);

    await expect(gateway.listExternalSessions({ repositoryRoot: "/repo" })).rejects.toThrow(Error);
  });

  it("rejects a preview that answers with a different session identity", async () => {
    const invokeCommand = vi.fn<InvokeExternalSessionCommand>().mockResolvedValue({
      provider: "claudeCode",
      sessionId: OTHER_SESSION_ID,
      exchanges: [],
      exchangesTruncated: false,
      totalPreviewBytes: 0,
    });
    const gateway = new TauriExternalSessionGateway(invokeCommand, available);

    await expect(
      gateway.previewExternalSession({
        provider: "claudeCode",
        sessionId: SESSION_ID,
        repositoryRoot: "/repo",
      }),
    ).rejects.toThrow(Error);
  });

  it("bounds an oversized backend rejection string", async () => {
    const invokeCommand = vi
      .fn<InvokeExternalSessionCommand>()
      .mockRejectedValue("x".repeat(10_000));
    const gateway = new TauriExternalSessionGateway(invokeCommand, available);

    const failure = await gateway
      .listExternalSessions({ repositoryRoot: "/repo" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toHaveLength(MAX_EXTERNAL_SESSION_ERROR_CHARS);
  });

  it("maps an opaque rejection to a generic bounded failure", async () => {
    const invokeCommand = vi.fn<InvokeExternalSessionCommand>().mockRejectedValue({ code: 17 });
    const gateway = new TauriExternalSessionGateway(invokeCommand, available);

    await expect(
      gateway.previewExternalSession({
        provider: "codex",
        sessionId: SESSION_ID,
        repositoryRoot: "/repo",
      }),
    ).rejects.toThrow("The external agent session request failed.");
  });
});
