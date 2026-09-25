import { describe, expect, it } from "vitest";
import type { AgentProjectTrust } from "../domain/agentProject";
import {
  BRANCH_CHECKOUT_UNAVAILABLE_REASON,
  agentBranchCheckoutGuardReason,
  type AgentBranchCheckoutGuardState,
} from "./agentBranchCheckoutGuard";

const ROOT_A = "/projects/a";
const ROOT_B = "/projects/b";

function project(rootPath: string, trust: AgentProjectTrust) {
  return { rootKey: rootPath, rootPath, repositories: [], trust };
}

function document(path: string, dirty: boolean) {
  return { path, content: dirty ? "draft" : "saved", savedContent: "saved" };
}

function state(
  overrides: Partial<AgentBranchCheckoutGuardState> = {},
): AgentBranchCheckoutGuardState {
  return {
    workspaceRoot: ROOT_A,
    workspaceTrusted: true,
    projects: [project(ROOT_A, "trusted"), project(ROOT_B, "trusted")],
    threads: [],
    documents: [document(`${ROOT_A}/index.ts`, false)],
    dispatching: false,
    isLiveDocumentDirty: () => false,
    ...overrides,
  };
}

describe("agentBranchCheckoutGuardReason", () => {
  it("blocks an untrusted target root while the active workspace is trusted and clean", () => {
    const guard = state({ projects: [project(ROOT_A, "trusted"), project(ROOT_B, "untrusted")] });
    expect(agentBranchCheckoutGuardReason(ROOT_B, guard)).toBe(BRANCH_CHECKOUT_UNAVAILABLE_REASON);
  });

  it("blocks a target root whose trust is not yet known", () => {
    const guard = state({ projects: [project(ROOT_A, "trusted"), project(ROOT_B, "unknown")] });
    expect(agentBranchCheckoutGuardReason(ROOT_B, guard)).toBe(BRANCH_CHECKOUT_UNAVAILABLE_REASON);
  });

  it("blocks a dirty target root while the active workspace is trusted and clean", () => {
    const guard = state({
      documents: [document(`${ROOT_A}/index.ts`, false), document(`${ROOT_B}/server.ts`, true)],
    });
    expect(agentBranchCheckoutGuardReason(ROOT_B, guard)).toContain("Save your unsaved files");
  });

  it("allows a trusted clean target root while the active workspace is untrusted", () => {
    const guard = state({
      workspaceTrusted: false,
      projects: [project(ROOT_A, "untrusted"), project(ROOT_B, "trusted")],
    });
    expect(agentBranchCheckoutGuardReason(ROOT_B, guard)).toBeNull();
  });

  it("allows a trusted clean target root while the active workspace is dirty", () => {
    const guard = state({ documents: [document(`${ROOT_A}/index.ts`, true)] });
    expect(agentBranchCheckoutGuardReason(ROOT_B, guard)).toBeNull();
  });

  it("blocks the active workspace when the editor no longer trusts it", () => {
    expect(agentBranchCheckoutGuardReason(ROOT_A, state({ workspaceTrusted: false }))).toBe(
      BRANCH_CHECKOUT_UNAVAILABLE_REASON,
    );
  });

  it("fails closed for a root that no project owns", () => {
    expect(agentBranchCheckoutGuardReason("/projects/unknown", state())).toBe(
      BRANCH_CHECKOUT_UNAVAILABLE_REASON,
    );
  });

  it("resolves a nested repository through the owning project's repositories", () => {
    const nested = `${ROOT_B}/packages/api`;
    const owner = { ...project(ROOT_B, "untrusted"), repositories: [{ repositoryRoot: nested }] };
    const guard = state({ projects: [project(ROOT_A, "trusted"), owner] });
    expect(agentBranchCheckoutGuardReason(nested, guard)).toBe(BRANCH_CHECKOUT_UNAVAILABLE_REASON);
    const trusted = state({ projects: [{ ...owner, trust: "trusted" }] });
    expect(agentBranchCheckoutGuardReason(nested, trusted)).toBeNull();
  });

  it("resolves a thread worktree checkout through the thread's project", () => {
    const worktree = "/worktrees/b-feature";
    const thread = { projectRootKey: ROOT_B, rootPath: worktree, running: false };
    const untrusted = state({
      projects: [project(ROOT_A, "trusted"), project(ROOT_B, "untrusted")],
      threads: [thread],
    });
    expect(agentBranchCheckoutGuardReason(worktree, untrusted)).toBe(
      BRANCH_CHECKOUT_UNAVAILABLE_REASON,
    );
    expect(agentBranchCheckoutGuardReason(worktree, state({ threads: [thread] }))).toBeNull();
    expect(
      agentBranchCheckoutGuardReason(worktree, state({ threads: [{ ...thread, running: true }] })),
    ).toContain("Stop the agent");
  });
});
