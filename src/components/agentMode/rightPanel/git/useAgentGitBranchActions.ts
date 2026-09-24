import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentGitHistoryTarget } from "../../../../application/useAgentGitHistory";
import type { AgentTaskIsolation } from "../../../../domain/agentTask";
import type { GitGateway } from "../../../../domain/git";
import {
  validateNewBranchName,
  type GitBranchPickerItem,
} from "../../../../domain/gitBranchPicker";
import { useLatest } from "../../../../ui/foundation/useLatest";
import type { AgentRightPanelContextValue } from "../agentRightPanelContext";
import type { AgentRightPanelGateways } from "../agentRightPanelGateways";

export const REMOTE_CHECKOUT_UNAVAILABLE = "This repository cannot check out remote branches here.";
export const WORKTREE_THREAD_SWITCH_REASON =
  "This thread's worktree stays on its own branch. Create a new branch in a new worktree instead.";

export interface AgentGitBranchActionsInput {
  readonly ownerKey: string | null;
  readonly rootPath: string | null;
  readonly repositoryRoot: string | null;
  readonly currentBranch: string | null;
  readonly isolation: AgentTaskIsolation | null;
  readonly git: Pick<GitGateway, "createBranch"> | null;
  readonly checkout: AgentRightPanelContextValue["checkout"];
  readonly historyTarget: AgentGitHistoryTarget | null;
  readonly worktrees: AgentRightPanelGateways["worktrees"] | null;
  onChanged(): void;
}

export type AgentGitBranchNotice =
  | { readonly kind: "error"; readonly text: string }
  | {
      readonly kind: "worktree";
      readonly text: string;
      readonly path: string;
      readonly trusted: boolean;
    };

export interface AgentGitBranchActions {
  readonly notice: AgentGitBranchNotice | null;
  readonly busy: boolean;
  switchTo(item: GitBranchPickerItem): Promise<void>;
  create(name: string, options: { readonly worktree: boolean }): Promise<void>;
  dismiss(): void;
}

type Outcome =
  | { readonly kind: "done" }
  | { readonly kind: "stale" }
  | {
      readonly kind: "notice";
      readonly notice: AgentGitBranchNotice;
      readonly changed: boolean;
    };

type SwitchAccess =
  | { readonly kind: "blocked"; readonly reason: string }
  | {
      readonly kind: "ready";
      readonly checkout: NonNullable<AgentRightPanelContextValue["checkout"]>;
      readonly rootPath: string;
    };

interface Operation {
  readonly input: AgentGitBranchActionsInput;
  latest(): AgentGitBranchActionsInput;
  current(): boolean;
}

const DONE: Outcome = { kind: "done" };
const STALE: Outcome = { kind: "stale" };

export function useAgentGitBranchActions(input: AgentGitBranchActionsInput): AgentGitBranchActions {
  const [notice, setNotice] = useState<AgentGitBranchNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useLatest(input);
  const epoch = useRef(0);
  const ownerIdentity = JSON.stringify([input.ownerKey, input.rootPath]);

  useLayoutEffect(() => {
    epoch.current += 1;
    setNotice(null);
    setBusy(false);
    return () => {
      epoch.current += 1;
    };
  }, [ownerIdentity]);

  const perform = useCallback(
    async (run: (operation: Operation) => Promise<Outcome>): Promise<void> => {
      const started = epoch.current;
      const operation: Operation = {
        input: inputRef.current,
        latest: () => inputRef.current,
        current: () => epoch.current === started,
      };
      setBusy(true);
      setNotice(null);
      const outcome = await run(operation).catch((error: unknown) =>
        errorOutcome(errorText(error)),
      );
      if (!operation.current() || outcome.kind === "stale") return;
      setBusy(false);
      if (outcome.kind === "done") {
        inputRef.current.onChanged();
        return;
      }
      setNotice(outcome.notice);
      if (outcome.notice.kind === "error" && !outcome.changed) return;
      inputRef.current.onChanged();
    },
    [inputRef],
  );

  const switchTo = useCallback(
    (item: GitBranchPickerItem) =>
      perform((operation) => {
        if (operation.input.isolation === "worktree") {
          return Promise.resolve(errorOutcome(WORKTREE_THREAD_SWITCH_REASON));
        }
        return guardedSwitch(operation.input, item);
      }),
    [perform],
  );

  const create = useCallback(
    (name: string, options: { readonly worktree: boolean }) =>
      perform(async (operation) => {
        const validated = validateNewBranchName(name);
        if (validated.kind === "invalid") return errorOutcome(validated.reason);
        if (options.worktree) return createWorktree(operation.input, validated.name);
        return createAndSwitch(operation, validated.name);
      }),
    [perform],
  );

  const dismiss = useCallback(() => setNotice(null), []);

  return useMemo(
    () => ({ notice, busy, switchTo, create, dismiss }),
    [busy, create, dismiss, notice, switchTo],
  );
}

async function createAndSwitch(operation: Operation, branch: string): Promise<Outcome> {
  const { input } = operation;
  if (input.isolation === "worktree") return errorOutcome(WORKTREE_THREAD_SWITCH_REASON);
  if (input.git === null || input.rootPath === null) {
    return errorOutcome("Branches cannot be created here.");
  }
  const access = switchAccess(input);
  if (access.kind === "blocked") return errorOutcome(access.reason);
  await input.git.createBranch(input.rootPath, branch);
  if (!operation.current()) return STALE;
  const switched = await guardedSwitch(operation.latest(), {
    name: branch,
    kind: "local",
    badge: null,
  }).catch((error: unknown) => errorOutcome(errorText(error)));
  if (switched.kind !== "notice") return switched;
  return { ...switched, changed: true };
}

function switchAccess(input: AgentGitBranchActionsInput): SwitchAccess {
  const { checkout, historyTarget, rootPath } = input;
  if (checkout === null || historyTarget === null || rootPath === null) {
    return { kind: "blocked", reason: "Branches cannot be switched here." };
  }
  const blocked = checkout.guard(historyTarget);
  if (blocked !== null) return { kind: "blocked", reason: blocked };
  return { kind: "ready", checkout, rootPath };
}

async function guardedSwitch(
  input: AgentGitBranchActionsInput,
  item: GitBranchPickerItem,
): Promise<Outcome> {
  const access = switchAccess(input);
  if (access.kind === "blocked") return errorOutcome(access.reason);
  const { checkout, rootPath } = access;
  if (item.kind === "local") {
    await checkout.gateway.switchBranch(rootPath, item.name);
    return DONE;
  }
  const checkoutRemote = checkout.gateway.checkoutRemoteBranch;
  if (checkoutRemote === undefined) return errorOutcome(REMOTE_CHECKOUT_UNAVAILABLE);
  await checkoutRemote.call(checkout.gateway, rootPath, item.name);
  return DONE;
}

async function createWorktree(input: AgentGitBranchActionsInput, branch: string): Promise<Outcome> {
  if (input.worktrees === null || input.repositoryRoot === null) {
    return errorOutcome("Worktrees cannot be created here.");
  }
  const receipt = await input.worktrees.addBranchWorktree({
    repositoryRoot: input.repositoryRoot,
    branch,
    startPoint: input.currentBranch,
  });
  return {
    kind: "notice",
    changed: true,
    notice: {
      kind: "worktree",
      text: `Created a worktree at ${receipt.worktreePath}`,
      path: receipt.worktreePath,
      trusted: receipt.trusted,
    },
  };
}

function errorOutcome(text: string): Outcome {
  return { kind: "notice", notice: { kind: "error", text }, changed: false };
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Git reported an error.";
}
