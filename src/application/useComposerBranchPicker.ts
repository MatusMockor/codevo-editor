import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { localBranchRef, remoteBranchRef, type AgentBranchRef } from "../domain/agentWorktreeBase";
import type { GitBranches, GitGateway, GitHistoryGateway } from "../domain/git";
import { validateNewBranchName } from "../domain/gitBranchPicker";
import type { AgentBranchCheckoutGateway } from "./useAgentBranchCheckout";
import type { AgentGitHistoryTarget } from "./useAgentGitHistory";

export type ComposerBranchGateway = AgentBranchCheckoutGateway &
  Pick<GitGateway, "createBranch"> &
  Pick<GitHistoryGateway, "getBranches">;

export interface ComposerBranchItem {
  readonly current: boolean;
  readonly kind: "local" | "remote";
  readonly name: string;
  readonly ref: AgentBranchRef;
}

export interface ComposerBranchTarget {
  readonly ownerKey: string;
  readonly repositoryRoot: string;
}

export type ComposerBranchList =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly branches: GitBranches }
  | { readonly kind: "error"; readonly message: string };

export interface ComposerBranchPicker {
  readonly error: string | null;
  readonly list: ComposerBranchList;
  readonly pending: boolean;
  create(name: string): Promise<boolean>;
  load(): void;
  switchTo(item: ComposerBranchItem): Promise<boolean>;
}

export interface ComposerBranchPickerOptions {
  readonly gateway: ComposerBranchGateway | null;
  readonly guard: (target: AgentGitHistoryTarget) => string | null;
  readonly target: ComposerBranchTarget | null;
}

type BranchOperation = (git: ComposerBranchGateway, root: string) => Promise<unknown>;

const MAX_ERROR_LENGTH = 500;
const IDLE_LIST: ComposerBranchList = { kind: "idle" };
export const STALE_BRANCH_ERROR = "This branch is no longer available. Refresh the branch list.";
export const BRANCH_OPERATION_IN_FLIGHT_ERROR =
  "A branch change is still running in this repository. Wait for it to finish.";

export function useComposerBranchPicker({
  gateway,
  guard,
  target,
}: ComposerBranchPickerOptions): ComposerBranchPicker {
  const repositoryRoot = target?.repositoryRoot ?? null;
  const ownerKey = target?.ownerKey ?? null;
  const identity = useMemo(
    () => ({ gateway, ownerKey, repositoryRoot }),
    [gateway, ownerKey, repositoryRoot],
  );
  const ownerRef = useRef(identity);
  const generationRef = useRef(0);
  const pendingRef = useRef(false);
  const inFlightRootsRef = useRef(new Set<string>());
  const refreshSequenceRef = useRef(0);
  const guardRef = useRef(guard);
  const listRef = useRef<ComposerBranchList>(IDLE_LIST);
  const [list, setListState] = useState<ComposerBranchList>(IDLE_LIST);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setList = useCallback((next: ComposerBranchList): void => {
    listRef.current = next;
    setListState(next);
  }, []);

  useLayoutEffect(() => {
    guardRef.current = guard;
  }, [guard]);

  useLayoutEffect(() => {
    ownerRef.current = identity;
    generationRef.current += 1;
    pendingRef.current = false;
    setList(IDLE_LIST);
    setPending(false);
    setError(null);
    return () => {
      generationRef.current += 1;
    };
  }, [identity, setList]);

  const capture = useCallback(() => {
    const owner = ownerRef.current;
    const generation = generationRef.current;
    return () => ownerRef.current === owner && generationRef.current === generation;
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const { gateway: git, repositoryRoot: root } = ownerRef.current;
    if (git === null || root === null) return;
    const ownsOwner = capture();
    refreshSequenceRef.current += 1;
    const sequence = refreshSequenceRef.current;
    const owns = () => ownsOwner() && refreshSequenceRef.current === sequence;
    if (listRef.current.kind !== "ready") setList({ kind: "loading" });
    try {
      const branches = await git.getBranches(root);
      if (!owns()) return;
      setList({ kind: "ready", branches });
    } catch (failure: unknown) {
      if (!owns()) return;
      setList({ kind: "error", message: failureMessage(failure, "Branches could not be loaded.") });
    }
  }, [capture, setList]);

  const load = useCallback((): void => {
    void refresh();
  }, [refresh]);

  const runGuarded = useCallback(
    async (operation: BranchOperation): Promise<boolean> => {
      const { gateway: git, ownerKey: key, repositoryRoot: root } = ownerRef.current;
      if (git === null || root === null || key === null || pendingRef.current) return false;
      const owns = capture();
      const blocked = guardRef.current({ rootPath: root, ownerKey: key });
      if (!owns()) return false;
      if (blocked !== null) {
        setError(blocked);
        return false;
      }
      const inFlight = inFlightRootsRef.current;
      if (inFlight.has(root)) {
        setError(BRANCH_OPERATION_IN_FLIGHT_ERROR);
        return false;
      }
      inFlight.add(root);
      pendingRef.current = true;
      setPending(true);
      setError(null);
      try {
        await operation(git, root);
        inFlight.delete(root);
        if (!owns()) return false;
        pendingRef.current = false;
        setPending(false);
        await refresh();
        return owns();
      } catch (failure: unknown) {
        inFlight.delete(root);
        if (!owns()) return false;
        pendingRef.current = false;
        setPending(false);
        setError(failureMessage(failure, "Could not switch branches. Refresh and try again."));
        await refresh();
        return false;
      }
    },
    [capture, refresh],
  );

  const switchTo = useCallback(
    (item: ComposerBranchItem): Promise<boolean> => {
      const current = listRef.current;
      if (current.kind !== "ready" || !branchListContains(current.branches, item)) {
        setError(STALE_BRANCH_ERROR);
        return Promise.resolve(false);
      }
      if (item.current) return Promise.resolve(true);
      return runGuarded((git, root) => {
        if (item.kind === "local") return git.switchBranch(root, item.name);
        if (git.checkoutRemoteBranch === undefined) {
          return Promise.reject(new Error("Switching to a remote branch is unavailable."));
        }
        return git.checkoutRemoteBranch(root, item.name);
      });
    },
    [runGuarded],
  );

  const create = useCallback(
    (name: string): Promise<boolean> => {
      const validated = validateNewBranchName(name);
      if (validated.kind === "invalid") {
        setError(validated.reason);
        return Promise.resolve(false);
      }
      return runGuarded(async (git, root) => {
        await git.createBranch(root, validated.name);
        await git.switchBranch(root, validated.name);
      });
    },
    [runGuarded],
  );

  return { create, error, list, load, pending, switchTo };
}

function branchListContains(branches: GitBranches, item: ComposerBranchItem): boolean {
  if (item.kind === "local") {
    return branches.local.includes(item.name) && localBranchRef(item.name) === item.ref;
  }
  return Object.entries(branches.remotes).some(([remote, names]) =>
    names.some(
      (name) => `${remote}/${name}` === item.name && remoteBranchRef(remote, name) === item.ref,
    ),
  );
}

function failureMessage(failure: unknown, fallback: string): string {
  const raw = failureText(failure);
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .trim()
    .slice(0, MAX_ERROR_LENGTH);
  if (cleaned === "") return fallback;
  return cleaned;
}

function failureText(failure: unknown): string {
  if (failure instanceof Error) return failure.message;
  if (typeof failure === "string") return failure;
  return "";
}
