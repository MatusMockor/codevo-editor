import { useEffect, useRef } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread } from "../domain/agentThread";
import type {
  WorkspaceFileChangeEvent,
  WorkspaceFileChangeGateway,
} from "../domain/workspaceFileChange";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { workspacePathBelongsToRoot } from "./workbenchController/workspacePathPolicy";

interface Input {
  readonly project: AgentProjectDescriptor | null;
  readonly thread: AgentThread | null;
  readonly workspaceOwnerKey: string | null;
  readonly openWorkspaceRoots: readonly string[];
  readonly gateway: WorkspaceFileChangeGateway | null;
  readonly handleChange: (
    event: WorkspaceFileChangeEvent,
    isCurrent: () => boolean,
  ) => Promise<void>;
  readonly reportError: (error: unknown) => void;
}

export function externalAgentWorktreeRoot(
  input: Pick<Input, "project" | "thread" | "openWorkspaceRoots">,
): string | null {
  const { project, thread, openWorkspaceRoots } = input;
  if (!project || !thread || thread.archived || thread.target.isolation !== "worktree") return null;
  if (
    thread.owner.rootKey !== project.rootKey ||
    (thread.owner.ownerId !== project.ownerId &&
      !project.runtimeOwnerIds?.includes(thread.owner.ownerId))
  )
    return null;
  if (
    thread.owner.repositoryRoot !== project.rootPath &&
    !project.repositories.some((entry) => entry.repositoryRoot === thread.owner.repositoryRoot)
  )
    return null;
  const root = thread.target.worktreePath;
  if (!root || root.length > 32768 || root.includes("\0") || root.split(/[\\/]/).includes(".."))
    return null;
  if (!root.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(root)) return null;
  if (
    openWorkspaceRoots.some(
      (workspace) =>
        workspacePathBelongsToRoot(root, workspace) || workspacePathBelongsToRoot(workspace, root),
    )
  )
    return null;
  return root;
}

export function useAgentWorktreeFileChanges(input: Input): void {
  const current = useRef(input);
  current.current = input;
  const root = externalAgentWorktreeRoot(input);
  const identity = JSON.stringify([
    input.workspaceOwnerKey,
    input.project?.rootKey,
    input.project?.ownerId,
    input.project?.generation,
    input.project?.leaseToken,
    input.thread?.threadId,
    input.thread?.owner.ownerId,
    root,
  ]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  useEffect(() => {
    if (!root || !input.workspaceOwnerKey || !input.gateway?.releaseRoot) return;
    const gateway = input.gateway;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let pending = false;
    const isCurrent = () => active && currentIdentity.current === identity;
    const event: WorkspaceFileChangeEvent = {
      rootPath: root,
      path: root,
      relativePath: "",
      kind: "rescanRequired",
    };
    const refresh = async () => {
      if (!isCurrent()) return;
      pending = true;
      if (running) return;
      running = true;
      try {
        while (pending && isCurrent()) {
          pending = false;
          await current.current.handleChange(event, isCurrent);
          if (!isCurrent()) return;
        }
      } catch (error) {
        if (isCurrent()) current.current.reportError(error);
      } finally {
        running = false;
      }
    };
    const schedule = () => {
      if (!isCurrent() || timer) return;
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 100);
    };
    void input.gateway
      .subscribeFileChanges((change) => {
        if (isCurrent() && workspaceRootKeysEqual(change.rootPath, root)) schedule();
      })
      .then((dispose) => {
        if (!isCurrent()) {
          dispose();
          return;
        }
        unsubscribe = dispose;
        return gateway.startWatching(root).then(() => {
          if (isCurrent()) void refresh();
        });
      })
      .catch((error) => {
        if (isCurrent()) current.current.reportError(error);
      });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      if (
        current.current.openWorkspaceRoots.some((workspace) =>
          workspaceRootKeysEqual(workspace, root),
        )
      )
        return;
      void Promise.resolve(gateway.releaseRoot?.(root)).catch((error) =>
        current.current.reportError(error),
      );
    };
  }, [identity, input.gateway, input.workspaceOwnerKey, root]);
}
