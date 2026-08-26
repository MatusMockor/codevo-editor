import { useCallback } from "react";
import type {
  AgentTasksNotice,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import type { AgentProjectGroup } from "./agentModePresentation";
import type {
  AgentProjectMenuCommand,
  AgentProjectMenuTarget,
  AgentRailScope,
  AgentThreadCopyDetail,
  AgentThreadMenuCommand,
} from "./agentSidebarPresentation";

export const CLIPBOARD_UNAVAILABLE_NOTICE: AgentTasksNotice = {
  kind: "warning",
  message: "The clipboard is not available, nothing was copied.",
  action: null,
};
export const NOTHING_TO_COPY_NOTICE: AgentTasksNotice = {
  kind: "info",
  message: "This thread has nothing to copy for that detail.",
  action: null,
};
export const REVEAL_FAILED_NOTICE: AgentTasksNotice = {
  kind: "warning",
  message: "Unable to reveal that path in the file manager.",
  action: null,
};

export type AgentMenuCommandSurface = Pick<
  AgentThreadsSurface,
  | "threads"
  | "togglePin"
  | "stop"
  | "archive"
  | "remove"
  | "renameThread"
  | "markThreadUnread"
  | "threadCopyDetail"
>;

export interface AgentThreadMenuCommandOptions {
  readonly agents: AgentMenuCommandSurface;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  revealPath(path: string): Promise<void>;
  reportNotice(notice: AgentTasksNotice): void;
  onTrustProject(projectRootKey: string): void;
  onReleaseProject(projectRootKey: string): void;
  onFilterScope(scope: AgentRailScope): void;
  onThreadRemoved(threadId: string): void;
  startNewThread(projectRootKey: string, repositoryRoot: string): void;
}

export interface AgentThreadMenuCommands {
  handleProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
  handleThreadMenuCommand(threadId: string, command: AgentThreadMenuCommand): void;
}

export function useAgentThreadMenuCommands({
  agents,
  groups,
  onFilterScope,
  onReleaseProject,
  onThreadRemoved,
  onTrustProject,
  reportNotice,
  revealPath,
  startNewThread,
}: AgentThreadMenuCommandOptions): AgentThreadMenuCommands {
  const threadViews = agents.threads;

  const remove = useCallback(
    (threadId: string) => {
      agents.remove(threadId);
      onThreadRemoved(threadId);
    },
    [agents, onThreadRemoved],
  );

  const copyText = useCallback(
    (text: string) => {
      const clipboard = clipboardWriter();
      if (clipboard === null) {
        reportNotice(CLIPBOARD_UNAVAILABLE_NOTICE);
        return;
      }
      void clipboard(text).catch(() => reportNotice(CLIPBOARD_UNAVAILABLE_NOTICE));
    },
    [reportNotice],
  );

  const copyThreadDetail = useCallback(
    (threadId: string, detail: AgentThreadCopyDetail) => {
      const text = agents.threadCopyDetail(threadId, detail);
      if (text === null) {
        reportNotice(NOTHING_TO_COPY_NOTICE);
        return;
      }
      copyText(text);
    },
    [agents, copyText, reportNotice],
  );

  const handleProjectCommand = useCallback(
    (target: AgentProjectMenuTarget, command: AgentProjectMenuCommand) => {
      switch (command) {
        case "trust":
          onTrustProject(target.projectRootKey);
          return;
        case "release":
          onReleaseProject(target.projectRootKey);
          return;
        case "filterToProject":
          onFilterScope({
            kind: "repository",
            projectRootKey: target.projectRootKey,
            repositoryRoot: target.repositoryRoot,
          });
          return;
        case "reveal":
          if (target.rootPath === null) return;
          void revealPath(target.rootPath).catch(() => reportNotice(REVEAL_FAILED_NOTICE));
          return;
        case "copyPath":
          if (target.rootPath === null) return;
          copyText(target.rootPath);
          return;
        default:
          return unsupportedProjectCommand(command);
      }
    },
    [copyText, onFilterScope, onReleaseProject, onTrustProject, reportNotice, revealPath],
  );

  const handleThreadMenuCommand = useCallback(
    (threadId: string, command: AgentThreadMenuCommand) => {
      switch (command.kind) {
        case "togglePin":
          agents.togglePin(threadId);
          return;
        case "stop":
          void agents.stop(threadId);
          return;
        case "archive":
          agents.archive(threadId);
          return;
        case "delete":
          remove(threadId);
          return;
        case "newThread": {
          const repositoryRoot = threadRepositoryRoot(threadViews, threadId);
          if (repositoryRoot === null) return;
          const projectRootKey = projectRootKeyForRepository(groups, repositoryRoot);
          if (projectRootKey === null) return;
          startNewThread(projectRootKey, repositoryRoot);
          return;
        }
        case "rename":
          agents.renameThread(threadId, command.title);
          return;
        case "markUnread":
          agents.markThreadUnread(threadId);
          return;
        case "copy":
          copyThreadDetail(threadId, command.detail);
          return;
        default:
          return unsupportedThreadMenuCommand(command);
      }
    },
    [agents, copyThreadDetail, groups, remove, startNewThread, threadViews],
  );

  return { handleProjectCommand, handleThreadMenuCommand };
}

function clipboardWriter(): ((text: string) => Promise<void>) | null {
  if (typeof navigator === "undefined") return null;
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== "function") return null;
  return (text) => clipboard.writeText(text);
}

function threadRepositoryRoot(
  views: ReadonlyArray<AgentThreadView>,
  threadId: string,
): string | null {
  const view = views.find((candidate) => candidate.thread.threadId === threadId);
  return view?.thread.owner.repositoryRoot ?? null;
}

function projectRootKeyForRepository(
  groups: ReadonlyArray<AgentProjectGroup>,
  repositoryRoot: string,
): string | null {
  const group = groups.find((candidate) =>
    candidate.repos.some((repo) => repo.repositoryRoot === repositoryRoot),
  );
  return group?.projectRootKey ?? null;
}

function unsupportedProjectCommand(command: never): never {
  throw new TypeError(`Unsupported agent project command: ${String(command)}.`);
}

function unsupportedThreadMenuCommand(command: never): never {
  throw new TypeError(`Unsupported agent thread menu command: ${JSON.stringify(command)}.`);
}
