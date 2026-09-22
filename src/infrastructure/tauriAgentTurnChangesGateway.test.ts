import { describe, expect, it, vi } from "vitest";
import { TauriAgentTurnChangesGateway } from "./tauriAgentTurnChangesGateway";

const summary = { turnId: "turn-1", state: "ready", files: [], truncated: false, reason: null };
const diff = {
  relativePath: "src/app.ts",
  original: { text: "before", truncated: false },
  modified: { text: "after", truncated: false },
  unavailableReason: null,
};
describe("native turn changes gateway", () => {
  it("uses exact closed request envelopes and parsed responses", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(summary).mockResolvedValueOnce(diff);
    const gateway = new TauriAgentTurnChangesGateway(invoke);
    expect(await gateway.getSummary("/project", "turn-1")).toEqual(summary);
    expect(await gateway.getFileDiff("/project", "turn-1", "src/app.ts")).toEqual(diff);
    expect(invoke.mock.calls).toEqual([
      ["agent_turn_changes_get", { request: { rootPath: "/project", turnId: "turn-1" } }],
      [
        "agent_turn_changes_diff",
        { request: { rootPath: "/project", turnId: "turn-1", relativePath: "src/app.ts" } },
      ],
    ]);
  });
  it.each([
    ["relative", "turn"],
    ["/project\0", "turn"],
    ["/" + "é".repeat(2048), "turn"],
    ["/project", ""],
    ["/project", "turn\n"],
    ["/project", "é".repeat(129)],
  ])("rejects invalid authority before IPC", async (root, turn) => {
    const invoke = vi.fn();
    const gateway = new TauriAgentTurnChangesGateway(invoke);
    await expect(gateway.getSummary(root, turn)).rejects.toThrow();
    await expect(gateway.getFileDiff(root, turn, "src/app.ts")).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([
    "../secret",
    "/absolute",
    "a/../b",
    ".git/config",
    "a\\b",
    "a\0b",
    "a/".repeat(65) + "b",
  ])("rejects unsafe relative path %s", async (path) => {
    const invoke = vi.fn();
    await expect(
      new TauriAgentTurnChangesGateway(invoke).getFileDiff("/project", "turn-1", path),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([
    { ...summary, turnId: "foreign" },
    { ...summary, unexpected: true },
    { ...summary, files: [{}] },
  ])("rejects foreign or malformed summaries", async (response) => {
    await expect(
      new TauriAgentTurnChangesGateway(vi.fn().mockResolvedValue(response)).getSummary(
        "/project",
        "turn-1",
      ),
    ).rejects.toThrow();
  });
  it.each([
    { ...diff, relativePath: "other.ts" },
    { ...diff, extra: true },
    { ...diff, original: { text: "a", truncated: false, extra: true } },
  ])("rejects foreign or malformed diffs", async (response) => {
    await expect(
      new TauriAgentTurnChangesGateway(vi.fn().mockResolvedValue(response)).getFileDiff(
        "/project",
        "turn-1",
        "src/app.ts",
      ),
    ).rejects.toThrow();
  });
  it("preserves native failures", async () => {
    const gateway = new TauriAgentTurnChangesGateway(
      vi.fn().mockRejectedValue(new Error("Snapshot unavailable")),
    );
    await expect(gateway.getSummary("/project", "turn-1")).rejects.toThrow("Snapshot unavailable");
  });
});
