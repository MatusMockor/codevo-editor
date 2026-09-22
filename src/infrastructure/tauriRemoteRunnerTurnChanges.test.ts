import { describe, expect, it, vi } from "vitest";
import { TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";

const taskId = "12345678-1234-4234-8234-123456789abc";
const request = { serverId: "linux", taskId };
const summary = { turnId: taskId, state: "ready", files: [], truncated: false, reason: null };
const diff = {
  relativePath: "src/app.ts",
  original: { text: "before", truncated: false },
  modified: { text: "after", truncated: false },
  unavailableReason: null,
};

describe("remote historical turn changes transport", () => {
  it("routes the exact task and file to the historical commands", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(summary).mockResolvedValueOnce(diff);
    const gateway = new TauriRemoteRunnerGateway(invoke);
    expect(await gateway.getTurnChanges(request)).toEqual(summary);
    expect(invoke).toHaveBeenNthCalledWith(1, "remote_runner_get_turn_changes", { request });
    const fileRequest = { ...request, relativePath: diff.relativePath };
    expect(await gateway.getTurnFileDiff(fileRequest)).toEqual(diff);
    expect(invoke).toHaveBeenNthCalledWith(2, "remote_runner_get_turn_file_diff", {
      request: fileRequest,
    });
  });
  it("rejects cross-turn and cross-file responses", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ ...summary, turnId: "12345678-1234-4234-8234-123456789abd" })
      .mockResolvedValueOnce({ ...diff, relativePath: "other.ts" });
    const gateway = new TauriRemoteRunnerGateway(invoke);
    await expect(gateway.getTurnChanges(request)).rejects.toThrow("another turn");
    await expect(
      gateway.getTurnFileDiff({ ...request, relativePath: diff.relativePath }),
    ).rejects.toThrow("different turn file");
  });
  it.each(["../secret", "/etc/passwd", "a//b", "a/../b", ".git/config", "a\\b", "a\n", ""])(
    "rejects unsafe file path %j before IPC",
    async (relativePath) => {
      const invoke = vi.fn();
      await expect(
        new TauriRemoteRunnerGateway(invoke).getTurnFileDiff({ ...request, relativePath }),
      ).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it("rejects unknown request and response fields", () => {
    for (const direction of ["request", "response"] as const) {
      const value = direction === "request" ? request : summary;
      expect(() =>
        validateRemoteRunnerValue("getTurnChanges", direction, { ...value, command: "unexpected" }),
      ).toThrow();
    }
  });
  it("negotiates optional strict turnChanges capability without weakening old descriptors", () => {
    const descriptor = {
      protocolVersion: 1,
      runnerId: "runner",
      name: "Linux",
      capabilities: { taskExecution: true, eventReplay: true },
    };
    expect(() => validateRemoteRunnerValue("getRunner", "response", descriptor)).not.toThrow();
    for (const turnChanges of [true, false]) {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: { ...descriptor.capabilities, turnChanges },
        }),
      ).not.toThrow();
    }
    for (const turnChanges of [null, 1, "true", {}]) {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: { ...descriptor.capabilities, turnChanges },
        }),
      ).toThrow();
    }
  });
});
