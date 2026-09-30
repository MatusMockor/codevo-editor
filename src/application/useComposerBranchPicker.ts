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
  switchToLocal(name: string): Promise<ComposerBranchSwitchResult>;
}

export type ComposerBranchSwitchResult =
  | { readonly kind: "switched" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "superseded" };

export interface ComposerBranchPickerOptions {
  readonly gateway: ComposerBranchGateway | null;
  readonly guard: (target: AgentGitHistoryTarget) => string | null;
  readonly target: ComposerBranchTarget | null;
  readonly onCheckedOut?: (current: string | null) => void;
}

interface BranchOwner {
  readonly gateway: ComposerBranchGateway | null;
  readonly ownerKey: string | null;
  readonly repositoryRoot: string | null;
}

interface OwnedBranchList {
  readonly owner: BranchOwner;
  readonly list: ComposerBranchList;
}

type BranchOperation = (git: ComposerBranchGateway, root: string) => Promise<unknown>;

const MAX_ERROR_LENGTH = 500;
const IDLE_LIST: ComposerBranchList = { kind: "idle" };
const SWITCHED: ComposerBranchSwitchResult = { kind: "switched" };
const SUPERSEDED: ComposerBranchSwitchResult = { kind: "superseded" };
export const STALE_BRANCH_ERROR = "This branch is no longer available. Refresh the branch list.";
export const BRANCH_OPERATION_IN_FLIGHT_ERROR =
  "A branch change is still running in this repository. Wait for it to finish.";

export function useComposerBranchPicker({
  gateway,
  guard,
  onCheckedOut,
  target,
}: ComposerBranchPickerOptions): ComposerBranchPicker {
  const repositoryRoot = target?.repositoryRoot ?? null;
  const ownerKey = target?.ownerKey ?? null;
  const identity = useMemo<BranchOwner>(
    () => ({ gateway, ownerKey, repositoryRoot }),
    [gateway, ownerKey, repositoryRoot],
  );
  const ownerRef = useRef(identity);
  const generationRef = useRef(0);
  const pendingRef = useRef(false);
  const inFlightRootsRef = useRef(new Set<string>());
  const refreshSequenceRef = useRef(0);
  const guardRef = useRef(guard);
  const checkedOutRef = useRef(onCheckedOut);
  const listRef = useRef<ComposerBranchList>(IDLE_LIST);
  const [listState, setListState] = useState<OwnedBranchList>(() => ({
    owner: identity,
    list: IDLE_LIST,
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setList = useCallback((next: ComposerBranchList): void => {
    listRef.current = next;
    setListState({ owner: ownerRef.current, list: next });
  }, []);

  useLayoutEffect(() => {
    guardRef.current = guard;
  }, [guard]);

  useLayoutEffect(() => {
    checkedOutRef.current = onCheckedOut;
  }, [onCheckedOut]);

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
      const current = listRef.current;
      if (current.kind === "ready" && sameBranches(current.branches, branches)) return;
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
    async (
      operation: BranchOperation,
      report: (message: string | null) => void,
    ): Promise<ComposerBranchSwitchResult> => {
      const { gateway: git, ownerKey: key, repositoryRoot: root } = ownerRef.current;
      if (git === null || root === null || key === null || pendingRef.current) return SUPERSEDED;
      const owns = capture();
      const blocked = guardRef.current({ rootPath: root, ownerKey: key });
      if (!owns()) return SUPERSEDED;
      if (blocked !== null) return refused(blocked, report);
      const inFlight = inFlightRootsRef.current;
      if (inFlight.has(root)) return refused(BRANCH_OPERATION_IN_FLIGHT_ERROR, report);
      inFlight.add(root);
      pendingRef.current = true;
      setPending(true);
      report(null);
      try {
        await operation(git, root);
        inFlight.delete(root);
        if (!owns()) return SUPERSEDED;
        pendingRef.current = false;
        setPending(false);
        await refresh();
        if (!owns()) return SUPERSEDED;
        const settled = listRef.current;
        if (settled.kind === "ready") checkedOutRef.current?.(settled.branches.current);
        return SWITCHED;
      } catch (failure: unknown) {
        inFlight.delete(root);
        if (!owns()) return SUPERSEDED;
        pendingRef.current = false;
        setPending(false);
        const result = refused(
          failureMessage(failure, "Could not switch branches. Refresh and try again."),
          report,
        );
        await refresh();
        return result;
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
      }, setError).then(switched);
    },
    [runGuarded],
  );

  const switchToLocal = useCallback(
    (name: string): Promise<ComposerBranchSwitchResult> => {
      const current = listRef.current;
      if (current.kind !== "ready" || !current.branches.local.includes(name)) {
        return Promise.resolve({ kind: "refused", reason: STALE_BRANCH_ERROR });
      }
      if (current.branches.current === name) return Promise.resolve(SWITCHED);
      return runGuarded((git, root) => git.switchBranch(root, name), ignoreReport);
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
      }, setError).then(switched);
    },
    [runGuarded],
  );

  const list = listState.owner === identity ? listState.list : IDLE_LIST;
  return useMemo(
    () => ({ create, error, list, load, pending, switchTo, switchToLocal }),
    [create, error, list, load, pending, switchTo, switchToLocal],
  );
}

function refused(
  reason: string,
  report: (message: string | null) => void,
): ComposerBranchSwitchResult {
  report(reason);
  return { kind: "refused", reason };
}

function switched(result: ComposerBranchSwitchResult): boolean {
  return result.kind === "switched";
}

function ignoreReport(): void {}

function sameBranches(left: GitBranches, right: GitBranches): boolean {
  if (left.current !== right.current || !sameNames(left.local, right.local)) return false;
  const leftRemotes = Object.entries(left.remotes);
  if (leftRemotes.length !== Object.keys(right.remotes).length) return false;
  return leftRemotes.every(([remote, names]) => {
    const other = right.remotes[remote];
    return other !== undefined && sameNames(names, other);
  });
}

function sameNames(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
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
