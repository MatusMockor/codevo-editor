import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import type { AgentWorkbenchAddProjectChrome } from "./agentWorkbenchChrome";

export interface AgentAddProjectOptions {
  readonly chrome: AgentWorkbenchAddProjectChrome | null;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly workspaceRoot: string | null;
  readonly selectionIdentity: object;
  onProjectAdded(project: AgentProjectDescriptor): void;
  reportNotice(notice: AgentTasksNotice): void;
}

export interface AgentAddProjectState {
  readonly open: boolean;
  readonly projectRootPaths: ReadonlyArray<string>;
  openDialog(): void;
  closeDialog(): void;
  addProject(path: string): void;
  reportNotice(message: string): void;
}

const MAX_ADD_PROJECT_NOTICE_CHARS = 200;

export function useAgentAddProject({
  chrome,
  projects,
  reportNotice,
  workspaceRoot,
  selectionIdentity,
  onProjectAdded,
}: AgentAddProjectOptions): AgentAddProjectState {
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState<{
    readonly rootPath: string;
    readonly ownerId: string;
    readonly generation: number;
    isCurrent(): boolean;
  } | null>(null);
  const authority = useRef({ generation: 0, identity: selectionIdentity, mounted: true });
  if (authority.current.identity !== selectionIdentity) {
    chrome?.cancelSelection?.();
    authority.current = {
      ...authority.current,
      identity: selectionIdentity,
      generation: authority.current.generation + 1,
    };
  }
  useLayoutEffect(() => {
    authority.current.mounted = true;
    return () => {
      authority.current.mounted = false;
      authority.current.generation += 1;
    };
  }, []);
  useLayoutEffect(() => {
    const selection = chrome?.receipt ?? receipt;
    if (selection === null || !selection.isCurrent()) return;
    if (!authority.current.mounted) return;
    if (chrome?.receipt == null && receipt?.generation !== authority.current.generation) return;
    const project = projects.find(
      (candidate) =>
        candidate.rootPath === selection.rootPath &&
        candidate.ownerId === selection.ownerId &&
        candidate.origin === "active-tab",
    );
    if (project === undefined) return;
    setReceipt(null);
    chrome?.consumeSelection?.(selection);
    authority.current.generation += 1;
    onProjectAdded(project);
  }, [chrome, onProjectAdded, projects, receipt]);

  const projectRootPaths = useMemo(
    () => [
      ...projects.map((project) => project.rootPath),
      ...(workspaceRoot === null ? [] : [workspaceRoot]),
    ],
    [projects, workspaceRoot],
  );

  const reportAddProjectNotice = useCallback(
    (message: string) => {
      reportNotice({
        kind: "warning",
        message: message.slice(0, MAX_ADD_PROJECT_NOTICE_CHARS),
        action: null,
      });
    },
    [reportNotice],
  );

  const addProject = useCallback(
    (path: string) => {
      if (chrome === null) return;
      setOpen(false);
      const generation = ++authority.current.generation;
      setReceipt(null);
      void chrome
        .addProject(path)
        .then((opened) => {
          if (!authority.current.mounted || authority.current.generation !== generation) return;
          if (!opened.isCurrent()) return;
          setReceipt({ ...opened, generation });
        })
        .catch((error: unknown) => {
          if (!authority.current.mounted || authority.current.generation !== generation) return;
          reportAddProjectNotice(error instanceof Error ? error.message : String(error));
        });
    },
    [chrome, reportAddProjectNotice],
  );

  const openDialog = useCallback(() => {
    authority.current.generation += 1;
    chrome?.cancelSelection?.();
    setOpen(true);
  }, [chrome]);
  const closeDialog = useCallback(() => {
    authority.current.generation += 1;
    chrome?.cancelSelection?.();
    setOpen(false);
  }, [chrome]);

  return {
    open,
    projectRootPaths,
    openDialog,
    closeDialog,
    addProject,
    reportNotice: reportAddProjectNotice,
  };
}
