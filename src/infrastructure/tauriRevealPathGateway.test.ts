import { describe, expect, it } from "vitest";
import {
  REVEAL_PATH_FAILED,
  REVEAL_PATH_UNAVAILABLE,
  TauriRevealPathGateway,
  type RevealPathCommand,
  type RevealPathRequest,
} from "./tauriRevealPathGateway";

const REQUEST: RevealPathRequest = {
  rootPath: "/workspace/app",
  path: "/workspace/app/.worktrees/agt-1",
};

describe("TauriRevealPathGateway", () => {
  it("passes the workspace root and path to the guarded command", async () => {
    const calls: Array<{ command: string; args: RevealPathRequest }> = [];
    const gateway = new TauriRevealPathGateway(recording(calls), () => true);

    await gateway.revealPath(REQUEST);

    expect(calls).toEqual([{ command: "reveal_item_in_dir", args: REQUEST }]);
  });

  it("fails closed without the native runtime", async () => {
    const calls: Array<{ command: string; args: RevealPathRequest }> = [];
    const gateway = new TauriRevealPathGateway(recording(calls), () => false);

    await expect(gateway.revealPath(REQUEST)).rejects.toThrow(REVEAL_PATH_UNAVAILABLE);
    expect(calls).toEqual([]);
  });

  it("reports a bounded failure when the command rejects", async () => {
    const gateway = new TauriRevealPathGateway(
      () => Promise.reject(new Error("Path is outside the workspace root.")),
      () => true,
    );

    await expect(gateway.revealPath(REQUEST)).rejects.toThrow(REVEAL_PATH_FAILED);
  });
});

function recording(calls: Array<{ command: string; args: RevealPathRequest }>): RevealPathCommand {
  return async (command, args) => {
    calls.push({ command, args });
  };
}
