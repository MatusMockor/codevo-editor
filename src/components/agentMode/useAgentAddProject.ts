import { useCallback, useMemo, useState } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import type { AgentWorkbenchAddProjectChrome } from "./agentWorkbenchChrome";

export interface AgentAddProjectOptions {
  readonly chrome: AgentWorkbenchAddProjectChrome | null;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly workspaceRoot: string | null;
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
}: AgentAddProjectOptions): AgentAddProjectState {
  const [open, setOpen] = useState(false);

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
      void chrome.addProject(path).catch((error: unknown) => {
        reportAddProjectNotice(error instanceof Error ? error.message : String(error));
      });
    },
    [chrome, reportAddProjectNotice],
  );

  const openDialog = useCallback(() => setOpen(true), []);
  const closeDialog = useCallback(() => setOpen(false), []);

  return {
    open,
    projectRootPaths,
    openDialog,
    closeDialog,
    addProject,
    reportNotice: reportAddProjectNotice,
  };
}
