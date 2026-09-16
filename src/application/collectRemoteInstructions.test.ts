import { describe, expect, it, vi, beforeEach } from "vitest";
import { collectRemoteInstructions } from "./collectRemoteInstructions";
import {
  readRemoteInstructionRoot,
  readRemoteInstructionSourceRevision,
} from "./remoteInstructionSources";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
vi.mock("./remoteInstructionSources", () => ({
  readRemoteInstructionRoot: vi.fn(),
  readRemoteInstructionSourceRevision: vi.fn(),
}));
const target = { serverId: "server", runnerId: "runner", projectId: "project" };
function gateway() {
  return {
    getRunner: vi.fn<RemoteRunnerGateway["getRunner"]>().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Runner",
      capabilities: { taskExecution: true, eventReplay: true, instructionSync: true },
    }),
    collectInstructions: vi
      .fn<NonNullable<RemoteRunnerGateway["collectInstructions"]>>()
      .mockResolvedValue({ version: 1, files: [] }),
  };
}
beforeEach(() => {
  vi.mocked(readRemoteInstructionRoot).mockReturnValue("/project");
  vi.mocked(readRemoteInstructionSourceRevision).mockReturnValue(0);
});
describe("instruction source authority", () => {
  it("rejects a missing collector before dispatch", async () => {
    await expect(
      collectRemoteInstructions({ getRunner: gateway().getRunner }, target, () => true, "claude"),
    ).rejects.toThrow("unavailable");
  });
  it("passes the explicit mapped local root", async () => {
    const gw = gateway();
    await collectRemoteInstructions(gw, target, () => true, "claude");
    expect(gw.collectInstructions).toHaveBeenCalledWith({ rootPath: "/project" });
  });
  it.each(["descriptor", "collection"])(
    "rejects A → B → A mapping changes during %s",
    async (stage) => {
      const gw = gateway();
      if (stage === "descriptor")
        gw.getRunner.mockImplementation(async () => {
          vi.mocked(readRemoteInstructionSourceRevision).mockReturnValue(2);
          return {
            protocolVersion: 1,
            runnerId: "runner",
            name: "Runner",
            capabilities: {
              taskExecution: true,
              eventReplay: true,
              instructionSync: true,
            },
          };
        });
      else
        gw.collectInstructions.mockImplementation(async () => {
          vi.mocked(readRemoteInstructionSourceRevision).mockReturnValue(2);
          return { version: 1, files: [] };
        });
      await expect(collectRemoteInstructions(gw, target, () => true, "claude")).rejects.toThrow(
        "source changed",
      );
      if (stage === "descriptor") expect(gw.collectInstructions).not.toHaveBeenCalled();
    },
  );
});

it("skips collection and capability checks for Codex on older runners", async () => {
  const gw = gateway();
  gw.getRunner.mockRejectedValue(new Error("older runner"));
  expect(await collectRemoteInstructions(gw, target, () => true, "codex")).toBeUndefined();
  expect(gw.collectInstructions).not.toHaveBeenCalled();
  expect(gw.getRunner).not.toHaveBeenCalled();
  expect(
    await collectRemoteInstructions({ getRunner: gw.getRunner }, target, () => true, "codex"),
  ).toBeUndefined();
});
