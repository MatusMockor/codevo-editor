import { describe, expect, it } from "vitest";
import { MAX_AGENT_PROJECT_ROOTS } from "../../domain/agentProject";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { projectFixture } from "./agentThreadsSurfaceTestFixtures";
import {
  recalledProjectSelection,
  rememberProjectSelection,
  restorableProjectThread,
  type AgentProjectSelectionMemory,
} from "./agentProjectSelectionMemory";

describe("project selection memory", () => {
  it("evicts the least recently remembered project at the project limit", () => {
    const memory: AgentProjectSelectionMemory = new Map();
    for (let index = 0; index < MAX_AGENT_PROJECT_ROOTS; index += 1)
      rememberProjectSelection(memory, projectFixture({ rootKey: `root-${index}` }), null, null);
    rememberProjectSelection(memory, projectFixture({ rootKey: "root-0" }), null, null);
    rememberProjectSelection(memory, projectFixture({ rootKey: "new" }), null, null);
    expect(memory.size).toBe(MAX_AGENT_PROJECT_ROOTS);
    expect(memory.has("root-0")).toBe(true);
    expect(memory.has("root-1")).toBe(false);
  });

  it("does not restore a thread whose repository no longer belongs to the project", () => {
    const project = projectFixture();
    const base = surfaceThreadView();
    const thread = {
      ...base,
      thread: { ...base.thread, owner: { ...base.thread.owner, repositoryRoot: "/removed" } },
    };
    const memory: AgentProjectSelectionMemory = new Map();
    rememberProjectSelection(
      memory,
      project,
      thread.thread.threadId,
      JSON.stringify(thread.thread.owner),
    );
    expect(
      restorableProjectThread(recalledProjectSelection(memory, project), project, [thread]),
    ).toBeNull();
  });
});
