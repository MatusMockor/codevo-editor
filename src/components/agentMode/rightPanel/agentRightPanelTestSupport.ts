import { createElement, type ReactNode } from "react";
import { inlineDiffViewGateway } from "../../../infrastructure/inlineDiffViewGateway";
import type { AgentRightPanelGateways } from "./agentRightPanelGateways";
import { AgentRightPanelContext, type AgentRightPanelContextValue } from "./agentRightPanelContext";

export function rightPanelTestContext(
  overrides: Partial<AgentRightPanelContextValue> = {},
  gateways: Partial<AgentRightPanelGateways> = {},
): AgentRightPanelContextValue {
  const value: AgentRightPanelContextValue = {
    thread: null,
    scope: { kind: "none" },
    workspaceRoot: "/repo",
    workspaceTrusted: true,
    target: { repositoryRoot: "/repo", worktreePath: null },
    checkoutRoot: "/repo",
    chrome: {
      gateways: {
        git: unusedGit(),
        surfaceStatus: {
          getSurfaceStatus: () => Promise.reject(new Error("no status in this test")),
        },
        branchDiff: {
          getBranchChanges: () => Promise.reject(new Error("no branch diff in this test")),
          getBranchFileSides: () => Promise.reject(new Error("no branch diff in this test")),
        },
        diffComputation: inlineDiffViewGateway,
        fileSearch: { searchFiles: async () => [] },
        pullRequest: {
          getContext: () => Promise.reject(new Error("no pull request gateway in this test")),
          create: () => Promise.reject(new Error("no pull request gateway in this test")),
        },
        worktrees: {
          addBranchWorktree: () => Promise.reject(new Error("no worktree gateway in this test")),
        },
        externalUrl: {
          openExternal: () => Promise.reject(new Error("no external url opener in this test")),
        },
        ...gateways,
      },
      projectRepositories: [{ root: "/repo", prefix: "" }],
      unreadableRepositories: false,
      statusRevision: 0,
      copyText: async () => undefined,
    },
    gitStatus: { load: { kind: "idle" }, refresh: () => undefined },
    agents: {
      showChanges: async () => undefined,
      showFileDiff: async () => undefined,
      hideFileDiff: () => undefined,
      openChangedFile: async () => undefined,
      openChangedFileDiff: async () => undefined,
    },
    shipActions: null,
    diffScope: { kind: "workingTree" },
    legacyWorkingTreeDiff: null,
    onDiffScopeChange: () => undefined,
    openSurface: () => undefined,
    closeSurface: () => undefined,
    openFile: () => undefined,
    previewFile: () => undefined,
    revealPath: async () => undefined,
    copyText: async () => undefined,
    checkout: null,
    historyTarget: null,
    scripts: null,
    scriptsChrome: null,
    ...overrides,
  };
  return value;
}

export function WithRightPanelContext(props: {
  readonly value: AgentRightPanelContextValue;
  readonly children: ReactNode;
}) {
  return createElement(AgentRightPanelContext.Provider, { value: props.value }, props.children);
}

export function unusedGit(): AgentRightPanelGateways["git"] {
  const reject = () => Promise.reject(new Error("git is not used in this test"));
  return {
    getStatus: reject,
    getDiff: reject,
    stageFiles: reject,
    commit: reject,
    push: reject,
    fetch: reject,
    createBranch: reject,
    switchBranch: reject,
  };
}
