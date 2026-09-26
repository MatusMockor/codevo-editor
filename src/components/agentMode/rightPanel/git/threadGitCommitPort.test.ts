import { describe, expect, it } from "vitest";
import type { AgentShipStepResult } from "../../../../domain/agentShip";
import type { AgentCommitSelection } from "../../../../domain/gitCommitSelection";
import { AMEND_UNAVAILABLE_REASONS } from "../../../../application/rightPanel/projectGitCommitPort";
import { threadGitCommitPort } from "./threadGitCommitPort";

const THREAD = "agt-1";
const SUCCEEDED: AgentShipStepResult = { kind: "succeeded" };

function scripted(commit: AgentShipStepResult, push: AgentShipStepResult = SUCCEEDED) {
  const calls: string[] = [];
  const actions = {
    onCommit: async (threadId: string, message: string, selection?: AgentCommitSelection) => {
      calls.push(`commit:${threadId}:${message}:${selection?.kind ?? "none"}`);
      return commit;
    },
    onPush: async (threadId: string) => {
      calls.push(`push:${threadId}`);
      return push;
    },
  };
  return { actions, calls };
}

describe("threadGitCommitPort", () => {
  it("reports a commit from the ship step result, not from rendered state", async () => {
    const fake = scripted(SUCCEEDED);
    const port = threadGitCommitPort(fake.actions, THREAD);

    await expect(port.commit("m", { kind: "paths", relativePaths: ["a.ts"] })).resolves.toEqual({
      kind: "committed",
    });
    expect(fake.calls).toEqual(["commit:agt-1:m:paths"]);
  });

  it("reports the commit failure of the step", async () => {
    const fake = scripted({
      kind: "failed",
      failure: {
        step: "commit",
        reason: "staleSelection",
        message: "The change list changed. Review the selection and commit again.",
      },
    });
    const port = threadGitCommitPort(fake.actions, THREAD);

    await expect(
      port.commitAndPush("m", { kind: "paths", relativePaths: ["a.ts"] }),
    ).resolves.toEqual({
      kind: "failed",
      message: "The change list changed. Review the selection and commit again.",
    });
    expect(fake.calls).toEqual(["commit:agt-1:m:paths"]);
  });

  it("reports why a step did not run", async () => {
    const fake = scripted({
      kind: "notRun",
      message: "Stop the agent before shipping its changes.",
    });
    const port = threadGitCommitPort(fake.actions, THREAD);

    await expect(port.commit("m", { kind: "paths", relativePaths: ["a.ts"] })).resolves.toEqual({
      kind: "failed",
      message: "Stop the agent before shipping its changes.",
    });
  });

  it("commits and pushes when both steps succeed", async () => {
    const fake = scripted(SUCCEEDED, SUCCEEDED);
    const port = threadGitCommitPort(fake.actions, THREAD);

    await expect(
      port.commitAndPush("m", { kind: "paths", relativePaths: ["a.ts"] }),
    ).resolves.toEqual({ kind: "pushed" });
    expect(fake.calls).toEqual(["commit:agt-1:m:paths", "push:agt-1"]);
  });

  it("surfaces the real push failure reason after a completed commit", async () => {
    const fake = scripted(SUCCEEDED, {
      kind: "failed",
      failure: { step: "push", reason: "gitError", message: "No upstream branch is configured." },
    });
    const port = threadGitCommitPort(fake.actions, THREAD);

    await expect(
      port.commitAndPush("m", { kind: "paths", relativePaths: ["a.ts"] }),
    ).resolves.toEqual({
      kind: "pushFailed",
      message: "Committed, but the push failed: No upstream branch is configured.",
    });
  });

  it("rejects an invalid message without calling the ship flow", async () => {
    const fake = scripted(SUCCEEDED);
    const port = threadGitCommitPort(fake.actions, THREAD);

    await expect(
      port.commit("   ", { kind: "paths", relativePaths: ["a.ts"] }),
    ).resolves.toMatchObject({ kind: "failed" });
    expect(fake.calls).toEqual([]);
  });

  it("keeps amend unavailable for agent threads without touching the ship flow", async () => {
    const fake = scripted(SUCCEEDED);
    const port = threadGitCommitPort(fake.actions, THREAD);
    await expect(port.amendCandidate()).resolves.toEqual({
      kind: "unavailable",
      reason: AMEND_UNAVAILABLE_REASONS.thread,
    });
    await expect(port.amend("a".repeat(40), "m", { kind: "all" })).resolves.toEqual({
      kind: "failed",
      message: AMEND_UNAVAILABLE_REASONS.thread,
    });
    expect(fake.calls).toEqual([]);
  });
});
