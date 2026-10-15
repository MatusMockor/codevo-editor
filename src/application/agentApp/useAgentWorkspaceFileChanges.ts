import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  fileChangeInvalidatesNodePackageScripts,
  fileChangeInvalidatesVscodeProcessTasks,
} from "../../domain/agentWorkspaceDiscoveryInvalidation";
import type {
  WorkspaceFileChangeEvent,
  WorkspaceFileChangeGateway,
  WorkspaceFileChangeUnsubscribeFn,
} from "../../domain/workspaceFileChange";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";

export interface AgentFileChangeOwner {
  readonly rootPath: string;
}

export type AgentFileChangeListener = (event: WorkspaceFileChangeEvent) => void;

export interface AgentWorkspaceFileChangesOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly gateway: Pick<WorkspaceFileChangeGateway, "startWatching" | "subscribeFileChanges">;
  readonly onChange: AgentFileChangeListener;
  readonly owner: AgentFileChangeOwner | null;
  readonly reportError: (source: string, error: unknown) => void;
}

interface DiscoveryVersions {
  readonly nodePackageScripts: number;
  readonly owner: AgentFileChangeOwner | null;
  readonly vscodeProcessTasks: number;
}

const INITIAL_VERSIONS: DiscoveryVersions = {
  nodePackageScripts: 0,
  owner: null,
  vscodeProcessTasks: 0,
};

export function useAgentWorkspaceFileChanges({
  currentWorkspaceRootRef,
  gateway,
  onChange,
  owner,
  reportError,
}: AgentWorkspaceFileChangesOptions) {
  const [versions, setVersions] = useState<DiscoveryVersions>(INITIAL_VERSIONS);
  const listenerRef = useRef(onChange);
  listenerRef.current = onChange;

  useEffect(() => {
    if (owner === null) return undefined;
    const subscriptionOwner = owner;
    const rootPath = owner.rootPath;
    let active = true;
    let unsubscribe: WorkspaceFileChangeUnsubscribeFn | null = null;
    const isCurrent = () =>
      active && workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath);

    void gateway.startWatching(rootPath).catch((error) => {
      if (isCurrent()) reportError("Workspace", error);
    });
    void gateway
      .subscribeFileChanges((event) => {
        if (!isCurrent() || !workspaceRootKeysEqual(event.rootPath, rootPath)) return;
        const scripts = fileChangeInvalidatesNodePackageScripts(event);
        const tasks = fileChangeInvalidatesVscodeProcessTasks(event);
        if (scripts || tasks) {
          setVersions((current) => {
            const base = current.owner === subscriptionOwner ? current : INITIAL_VERSIONS;
            return {
              nodePackageScripts: base.nodePackageScripts + Number(scripts),
              owner: subscriptionOwner,
              vscodeProcessTasks: base.vscodeProcessTasks + Number(tasks),
            };
          });
        }
        listenerRef.current(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }
        unsubscribe = dispose;
      })
      .catch((error) => {
        if (isCurrent()) reportError("Workspace", error);
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [currentWorkspaceRootRef, gateway, owner, reportError]);

  const current = versions.owner !== null && versions.owner === owner ? versions : INITIAL_VERSIONS;
  return {
    nodePackageScriptDiscoveryVersion: current.nodePackageScripts,
    vscodeProcessTasksVersion: current.vscodeProcessTasks,
  };
}
