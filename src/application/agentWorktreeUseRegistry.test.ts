import { describe, expect, it } from "vitest";
import {
  createAgentWorktreeUseRegistry,
  MAX_RETIRED_AGENT_WORKTREES,
} from "./agentWorktreeUseRegistry";

const PATH = "/workspace/app/.worktrees/agt-1";
const OTHER = "/workspace/app/.worktrees/agt-2";

describe("createAgentWorktreeUseRegistry", () => {
  it("refuses a removal while a start holds the worktree and allows it after release", () => {
    const registry = createAgentWorktreeUseRegistry();
    const start = registry.claimStart(PATH);

    expect(start).not.toBeNull();
    expect(registry.claimRemoval(PATH)).toBeNull();
    expect(registry.claimRemoval(OTHER)).not.toBeNull();
    start?.release();
    start?.release();
    expect(registry.claimRemoval(PATH)).not.toBeNull();
  });

  it("counts concurrent starts on the same worktree", () => {
    const registry = createAgentWorktreeUseRegistry();
    const first = registry.claimStart(PATH);
    const second = registry.claimStart(PATH);

    first?.release();
    expect(registry.claimRemoval(PATH)).toBeNull();
    second?.release();
    expect(registry.claimRemoval(PATH)).not.toBeNull();
  });

  it("refuses a start while the worktree is being removed and after it was removed", () => {
    const registry = createAgentWorktreeUseRegistry();
    const removal = registry.claimRemoval(PATH);

    expect(registry.claimStart(PATH)).toBeNull();
    expect(registry.claimRemoval(PATH)).toBeNull();
    removal?.settle("removed");
    removal?.settle("kept");
    expect(registry.claimStart(PATH)).toBeNull();
  });

  it("allows a start again when the removal kept the worktree", () => {
    const registry = createAgentWorktreeUseRegistry();
    registry.claimRemoval(PATH)?.settle("kept");

    expect(registry.claimStart(PATH)).not.toBeNull();
  });

  it("revives a retired path only when a worktree is created there again", () => {
    const registry = createAgentWorktreeUseRegistry();
    registry.claimRemoval(PATH)?.settle("removed");

    registry.noteCreated(PATH);

    expect(registry.claimStart(PATH)).not.toBeNull();
  });

  it("evicts the oldest retired path deterministically at capacity", () => {
    const registry = createAgentWorktreeUseRegistry();
    for (let index = 0; index <= MAX_RETIRED_AGENT_WORKTREES; index += 1) {
      registry.claimRemoval(`/workspace/app/.worktrees/agt-${index}`)?.settle("removed");
    }

    expect(registry.claimStart("/workspace/app/.worktrees/agt-0")).not.toBeNull();
    expect(registry.claimStart("/workspace/app/.worktrees/agt-1")).toBeNull();
    expect(
      registry.claimStart(`/workspace/app/.worktrees/agt-${MAX_RETIRED_AGENT_WORKTREES}`),
    ).toBeNull();
  });
});
