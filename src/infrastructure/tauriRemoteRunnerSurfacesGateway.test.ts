import { describe, expect, it, vi } from "vitest";
import { TauriRemoteRunnerSurfacesGateway } from "./tauriRemoteRunnerSurfacesGateway";
const scope = {
  serverId: "linux",
  runnerId: "7389088c-29b8-4cec-9a15-e825e1fb2f66",
  projectId: "editor",
};
describe("remote surface boundary", () => {
  it("explains native string save conflicts with recovery guidance", async () => {
    const invoke = vi.fn().mockRejectedValue("Runner request failed (HTTP 409).");
    const gateway = new TauriRemoteRunnerSurfacesGateway(invoke);
    await expect(
      gateway.writeFile({
        ...scope,
        path: "notes.txt",
        text: "edited",
        expectedVersion: "a".repeat(64),
      }),
    ).rejects.toThrow(
      "The file or workspace changed on the server. Your edits are preserved. Compare with server before saving again.",
    );
    await expect(gateway.readFile({ ...scope, path: "notes.txt" })).rejects.toThrow(
      "Runner request failed (HTTP 409).",
    );
  });
  it("normalizes native string errors and bounds unknown failures", async () => {
    const invoke = vi.fn().mockRejectedValue("Server disconnected.");
    const gateway = new TauriRemoteRunnerSurfacesGateway(invoke);
    await expect(gateway.capabilities(scope)).rejects.toThrow("Server disconnected.");
    invoke.mockRejectedValue({ secret: "not a message" });
    await expect(gateway.capabilities(scope)).rejects.toThrow(
      "The server could not complete this operation.",
    );
    invoke.mockRejectedValue("x".repeat(2000));
    await expect(gateway.capabilities(scope)).rejects.toThrow(
      "The server could not complete this operation.",
    );
  });
  it("rejects unsafe paths and excess authority before IPC", async () => {
    const invoke = vi.fn();
    const gateway = new TauriRemoteRunnerSurfacesGateway(invoke);
    for (const path of ["../secret", "/etc/passwd", "x/.git/config", "C:/secret"])
      await expect(gateway.readFile({ ...scope, path })).rejects.toThrow();
    await expect(
      gateway.readFile({ ...scope, path: "ok", host: "other" } as Parameters<
        typeof gateway.readFile
      >[0]),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("keeps scope and semantic command at the closed boundary", async () => {
    const invoke = vi.fn().mockResolvedValue({ files: true, history: true, terminal: true });
    expect(await new TauriRemoteRunnerSurfacesGateway(invoke).capabilities(scope)).toEqual({
      files: true,
      history: true,
      terminal: true,
    });
    expect(invoke).toHaveBeenCalledWith("remote_runner_surface", {
      request: { operation: "capabilities", ...scope },
    });
  });
  it("rejects unsupported and excessive responses", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ files: true, history: true, terminal: true, host: "secret" });
    await expect(
      new TauriRemoteRunnerSurfacesGateway(invoke).capabilities(scope),
    ).rejects.toThrow();
  });
  it("rejects a foreign terminal owner and mismatched file response", async () => {
    const invoke = vi.fn().mockResolvedValue({
      id: scope.runnerId,
      projectId: "other",
      taskId: null,
      cols: 80,
      rows: 24,
      status: "running",
      exitCode: null,
      sequence: 0,
    });
    const gateway = new TauriRemoteRunnerSurfacesGateway(invoke);
    await expect(gateway.openTerminal({ ...scope, cols: 80, rows: 24 })).rejects.toThrow(
      "ownership",
    );
    invoke.mockResolvedValue({
      path: "foreign",
      text: "",
      version: null,
      unavailableReason: "binary",
    });
    await expect(gateway.readFile({ ...scope, path: "expected" })).rejects.toThrow("ownership");
  });
  it("preserves NUL terminal input and output", async () => {
    const snapshot = {
      id: scope.runnerId,
      projectId: scope.projectId,
      taskId: null,
      cols: 80,
      rows: 24,
      status: "running",
      exitCode: null,
      sequence: 1,
    };
    const invoke = vi.fn().mockResolvedValue({
      ...snapshot,
      chunks: [{ sequence: 1, data: "\0hello" }],
      truncated: false,
    });
    const gateway = new TauriRemoteRunnerSurfacesGateway(invoke);
    expect(
      (await gateway.pollTerminal({ ...scope, terminalId: scope.runnerId, after: 0 })).chunks[0]
        ?.data,
    ).toBe("\0hello");
    invoke.mockResolvedValue({ accepted: true });
    await expect(
      gateway.writeTerminal({ ...scope, terminalId: scope.runnerId, data: "\0" }),
    ).resolves.toEqual({ accepted: true });
  });
});
