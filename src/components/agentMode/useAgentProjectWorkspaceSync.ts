import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";

export type AgentProjectWorkspaceTarget = Pick<
  AgentProjectDescriptor,
  "rootKey" | "rootPath" | "ownerId" | "generation" | "label"
>;

export type AgentProjectWorkspaceActivation =
  | { readonly kind: "none"; readonly rootPath: null }
  | { readonly kind: "ready" | "pending"; readonly rootPath: string }
  | { readonly kind: "failed"; readonly rootPath: string; readonly message: string };

export interface AgentProjectWorkspaceSync {
  readonly state: AgentProjectWorkspaceActivation;
  select(target: AgentProjectWorkspaceTarget | null): void;
  retry(): void;
}

export interface AgentProjectWorkspaceSyncOptions {
  readonly workspaceRoot: string | null;
  activate(rootPath: string): Promise<boolean>;
}

const NONE: AgentProjectWorkspaceActivation = { kind: "none", rootPath: null };

function targetKey(target: AgentProjectWorkspaceTarget | null): string {
  if (target === null) return "";
  return JSON.stringify([target.rootKey, target.rootPath, target.ownerId, target.generation]);
}

export function useAgentProjectWorkspaceSync({
  workspaceRoot,
  activate,
}: AgentProjectWorkspaceSyncOptions): AgentProjectWorkspaceSync {
  const [state, setState] = useState<AgentProjectWorkspaceActivation>(NONE);
  const current = useRef({ workspaceRoot, activate });
  current.current = { workspaceRoot, activate };
  const owner = useRef({
    mounted: true,
    epoch: 0,
    target: null as AgentProjectWorkspaceTarget | null,
    pending: false,
    failed: false,
  });
  useEffect(() => {
    const authority = owner.current;
    authority.mounted = true;
    return () => {
      authority.mounted = false;
      authority.epoch += 1;
    };
  }, []);
  const start = useCallback((target: AgentProjectWorkspaceTarget | null, retry: boolean) => {
    const authority = owner.current;
    const sameTarget = targetKey(authority.target) === targetKey(target);
    if (
      !retry &&
      sameTarget &&
      (authority.pending ||
        authority.failed ||
        target === null ||
        current.current.workspaceRoot === target.rootPath)
    )
      return;
    const replaced =
      authority.target !== null &&
      target !== null &&
      !sameTarget &&
      authority.target.rootPath === target.rootPath;
    const pending = authority.pending;
    authority.target = target;
    const epoch = ++authority.epoch;
    authority.pending = false;
    authority.failed = false;
    if (target === null) {
      setState(NONE);
      if (pending && current.current.workspaceRoot !== null) {
        void current.current.activate(current.current.workspaceRoot).catch(() => undefined);
      }
      return;
    }
    if (!pending && !replaced && current.current.workspaceRoot === target.rootPath) {
      setState({ kind: "ready", rootPath: target.rootPath });
      return;
    }
    authority.pending = true;
    setState({ kind: "pending", rootPath: target.rootPath });
    const isCurrent = () => owner.current.mounted && owner.current.epoch === epoch;
    const failed = () => {
      if (!isCurrent()) return;
      owner.current.pending = false;
      owner.current.failed = true;
      setState({
        kind: "failed",
        rootPath: target.rootPath,
        message: `Could not open ${target.label}. Try again or reopen the project.`,
      });
    };
    void current.current.activate(target.rootPath).then((opened) => {
      if (!isCurrent()) return;
      if (!opened) {
        failed();
        return;
      }
      owner.current.pending = false;
      setState({ kind: "ready", rootPath: target.rootPath });
    }, failed);
  }, []);
  const select = useCallback(
    (target: AgentProjectWorkspaceTarget | null) => start(target, false),
    [start],
  );
  const retry = useCallback(() => start(owner.current.target, true), [start]);
  return useMemo(() => ({ state, select, retry }), [state, select, retry]);
}
