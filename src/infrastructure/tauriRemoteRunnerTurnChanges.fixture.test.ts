import { describe, expect, it } from "vitest";
import { parseAgentTurnChangeSummary } from "../domain/agentTurnChanges";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import { TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";

const recordedTurn = {
  turnId: "7d2f3a1c-5b6e-4c8d-9a0b-1e2f3a4b5c6d",
  state: "ready",
  files: [
    {
      relativePath: "CHANGELOG.md",
      oldRelativePath: null,
      status: "modified",
      addedLines: 52,
      deletedLines: 0,
    },
    {
      relativePath: "package-lock.json",
      oldRelativePath: null,
      status: "modified",
      addedLines: null,
      deletedLines: null,
    },
    {
      relativePath: "src-tauri/Cargo.lock",
      oldRelativePath: null,
      status: "modified",
      addedLines: null,
      deletedLines: null,
    },
    {
      relativePath: "src/application/agentAttachmentCarriedIntake.ts",
      oldRelativePath: null,
      status: "added",
      addedLines: 207,
      deletedLines: 0,
    },
    {
      relativePath: "src-tauri/tauri.conf.json",
      oldRelativePath: null,
      status: "modified",
      addedLines: 1,
      deletedLines: 1,
    },
  ],
  truncated: false,
  reason: null,
};
const runningTurn = {
  turnId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  state: "unavailable",
  files: [],
  truncated: false,
  reason: "A complete snapshot of this turn is unavailable.",
};

describe("real runner turn changes payloads", () => {
  it.each([recordedTurn, runningTurn])(
    "accepts the recorded server summary for turn $turnId",
    async (payload) => {
      const parsed = parseAgentTurnChangeSummary(payload);
      expect(parsed.turnId).toBe(payload.turnId);
      expect(parsed.files.length).toBe(payload.files.length);
      expect(() => validateRemoteRunnerValue("getTurnChanges", "response", payload)).not.toThrow();
      const gateway = new TauriRemoteRunnerGateway(async () => payload);
      const result = await gateway.getTurnChanges({ serverId: "linux", taskId: payload.turnId });
      expect(result).toEqual(parsed);
    },
  );
});
