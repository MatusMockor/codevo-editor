import { useEffect, useMemo, useRef } from "react";
import { workbenchAgentThreadOpener } from "../../application/agentThreadOpener";
import {
  workbenchAgentPaletteProvider,
  type AgentPaletteProvider,
} from "../../application/commandPalette/commandPaletteProvider";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type {
  AgentThreadScriptEntry,
  AgentThreadScriptsSurface,
} from "../../application/useAgentThreadScripts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentThreadDisplayTitle } from "./agentModePresentation";

export interface AgentCommandPaletteProviderOptions {
  readonly threads: ReadonlyArray<AgentThreadView>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly selectedThreadId: string | null;
  readonly activeProjectKey: string | null;
  readonly scripts: Pick<AgentThreadScriptsSurface, "entries" | "truncated" | "runScript">;
  selectThread(threadId: string): void;
  setProjectScope(projectRootKey: string): boolean;
  newThread(): void;
}

interface PaletteSnapshotData {
  readonly threads: ReadonlyArray<AgentThreadView>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly selectedThreadId: string | null;
  readonly activeProjectKey: string | null;
  readonly scriptEntries: ReadonlyArray<AgentThreadScriptEntry>;
  readonly scriptsTruncated: boolean;
}

export function useAgentCommandPaletteProvider(options: AgentCommandPaletteProviderOptions): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const { activeProjectKey, projects, selectedThreadId, threads } = options;
  const scriptEntries = options.scripts.entries;
  const scriptsTruncated = options.scripts.truncated;
  const snapshot = useMemo(
    () =>
      paletteSnapshot(
        { threads, projects, selectedThreadId, activeProjectKey, scriptEntries, scriptsTruncated },
        latest,
      ),
    [activeProjectKey, projects, scriptEntries, scriptsTruncated, selectedThreadId, threads],
  );

  useEffect(() => workbenchAgentPaletteProvider.publish(snapshot), [snapshot]);
  useEffect(
    () =>
      workbenchAgentThreadOpener.publish({
        openThread(threadId) {
          const known = latest.current.threads.some((view) => view.thread.threadId === threadId);
          if (!known) return false;
          latest.current.selectThread(threadId);
          return true;
        },
      }),
    [],
  );
}

function paletteSnapshot(
  data: PaletteSnapshotData,
  latest: { readonly current: AgentCommandPaletteProviderOptions },
): AgentPaletteProvider {
  const labels = new Map(data.projects.map((project) => [project.rootKey, project.label]));
  const live = () => latest.current.threads.filter((view) => view.lifecycle !== "archived");
  const knownProject = (key: string) =>
    latest.current.projects.some((project) => project.rootKey === key);
  return {
    projects: data.projects.map((project) => ({
      key: project.rootKey,
      label: project.label,
      path: project.rootPath,
      current: project.rootKey === data.activeProjectKey,
    })),
    threads: data.threads
      .filter((view) => view.lifecycle !== "archived")
      .map((view) => ({
        id: view.thread.threadId,
        title: agentThreadDisplayTitle(view.thread),
        projectLabel: labels.get(view.thread.owner.rootKey) ?? view.repositoryLabel,
        updatedAtMs: view.thread.updatedAtEpochMs,
        current: view.thread.threadId === data.selectedThreadId,
      })),
    scripts: data.scriptEntries.map((entry) => ({
      key: entry.key,
      name: entry.label,
      detail: entry.detail,
      runnable: entry.availability.kind === "available",
    })),
    scriptsTruncated: data.scriptsTruncated,
    activeProjectKey: data.activeProjectKey,
    openThread(threadId) {
      if (!live().some((view) => view.thread.threadId === threadId)) return false;
      latest.current.selectThread(threadId);
      return true;
    },
    switchProject(projectKey) {
      if (!knownProject(projectKey)) return false;
      return latest.current.setProjectScope(projectKey);
    },
    newThreadIn(projectKey) {
      if (!knownProject(projectKey)) return false;
      if (!latest.current.setProjectScope(projectKey)) return false;
      latest.current.newThread();
      return true;
    },
    runScript(scriptKey) {
      return latest.current.scripts.runScript(scriptKey);
    },
  };
}
