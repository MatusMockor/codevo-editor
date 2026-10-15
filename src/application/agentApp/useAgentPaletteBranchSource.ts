import { useMemo, useRef, type MutableRefObject } from "react";
import type { GitGateway } from "../../domain/git";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { PaletteBranch, PaletteBranchSource } from "../commandPalette/commandPaletteProvider";

export const AGENT_BRANCH_SOURCE_STALE_REASON = "The project changed before the branch switch.";
export const AGENT_BRANCH_SWITCH_BUSY_REASON = "Another branch switch is still running.";
export const AGENT_REMOTE_CHECKOUT_UNAVAILABLE_REASON =
  "Checking out remote branches is not available here.";

export interface AgentPaletteBranchOwner {
  readonly rootPath: string;
}

export interface AgentPaletteBranchSourceOptions {
  readonly checkoutGuard: (rootPath: string) => string | null;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly gitGateway: Pick<
    GitGateway,
    "branchList" | "checkoutRemoteBranch" | "remoteBranchList" | "switchBranch"
  >;
  readonly owner: AgentPaletteBranchOwner | null;
  readonly refreshGitStatus: () => Promise<void>;
}

export function useAgentPaletteBranchSource({
  checkoutGuard,
  currentWorkspaceRootRef,
  gitGateway,
  owner,
  refreshGitStatus,
}: AgentPaletteBranchSourceOptions): PaletteBranchSource | null {
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const portsRef = useRef({ checkoutGuard, refreshGitStatus });
  portsRef.current = { checkoutGuard, refreshGitStatus };
  const switchingRef = useRef(false);

  return useMemo(() => {
    if (owner === null) return null;
    const sourceOwner = owner;
    const rootPath = owner.rootPath;
    const isCurrent = () =>
      ownerRef.current === sourceOwner &&
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath);
    const requireCurrent = () => {
      if (!isCurrent()) throw new Error(AGENT_BRANCH_SOURCE_STALE_REASON);
    };
    return {
      scopeKey: rootPath,
      scopeLabel: folderLabel(rootPath),
      async load() {
        requireCurrent();
        const [local, remote] = await Promise.all([
          gitGateway.branchList(rootPath),
          gitGateway.remoteBranchList?.(rootPath) ?? Promise.resolve([]),
        ]);
        requireCurrent();
        return [
          ...local.map((branch) => ({
            current: branch.isCurrent,
            name: branch.name,
            remote: false,
          })),
          ...remote.map((branch) => ({ current: false, name: branch.name, remote: true })),
        ];
      },
      async switchTo(branch: PaletteBranch) {
        requireCurrent();
        const blocked = portsRef.current.checkoutGuard(rootPath);
        if (blocked !== null) throw new Error(blocked);
        if (switchingRef.current) throw new Error(AGENT_BRANCH_SWITCH_BUSY_REASON);
        switchingRef.current = true;
        try {
          await checkoutBranch(gitGateway, rootPath, branch);
        } finally {
          switchingRef.current = false;
        }
        if (!isCurrent()) return;
        await portsRef.current.refreshGitStatus();
      },
    };
  }, [currentWorkspaceRootRef, gitGateway, owner]);
}

async function checkoutBranch(
  gitGateway: AgentPaletteBranchSourceOptions["gitGateway"],
  rootPath: string,
  branch: PaletteBranch,
): Promise<void> {
  if (!branch.remote) {
    await gitGateway.switchBranch(rootPath, branch.name);
    return;
  }
  if (gitGateway.checkoutRemoteBranch === undefined) {
    throw new Error(AGENT_REMOTE_CHECKOUT_UNAVAILABLE_REASON);
  }
  await gitGateway.checkoutRemoteBranch(rootPath, branch.name);
}

function folderLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}
