import { useCallback, useEffect, useRef } from "react";
import { mapWithBoundedConcurrency } from "../../application/boundedConcurrency";
import { settleAgentThreadMutation } from "../../application/agentThreadMutationOutcome";
import type {
  AgentTasksNotice,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import {
  AGENT_THREAD_BULK_CONCURRENCY,
  agentThreadBulkPlan,
  agentThreadBulkReport,
  type AgentThreadBulkAction,
  type AgentThreadBulkCandidate,
  type AgentThreadBulkCommand,
} from "../../domain/agentThreadBulkAction";
import { runningTurn } from "../../domain/agentThread";
import type { AgentProjectGroup } from "./agentModePresentation";
import type {
  AgentProjectMenuCommand,
  AgentProjectMenuTarget,
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

export function staleSelectionNotice(action: AgentThreadBulkAction): AgentTasksNotice {
  return {
    kind: "warning",
    message: `The thread selection no longer belongs to this project, nothing was ${bulkPastTense(action)}.`,
    action: null,
  };
}

export type AgentMenuCommandSurface = Pick<
  AgentThreadsSurface,
  | "threads"
  | "togglePin"
  | "stop"
  | "archive"
  | "unarchive"
  | "remove"
  | "batchThreadMutations"
  | "renameThread"
  | "markThreadUnread"
  | "threadCopyDetail"
  | "updateThreadOrganization"
  | "reorderThread"
>;

export interface AgentThreadMenuCommandOptions {
  readonly agents: AgentMenuCommandSurface;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  revealPath(path: string): Promise<void>;
  reportNotice(notice: AgentTasksNotice): void;
  onTrustProject(projectRootKey: string): void;
  onCloseProject(rootPath: string): void;
  onReleaseProject(projectRootKey: string): void;
  onThreadRemoved(threadId: string): void;
  onOpenTerminalSessions(projectRootKey: string, repositoryRoot: string): void;
  startNewThread(projectRootKey: string, repositoryRoot: string): void;
}

export interface AgentThreadMenuCommands {
  handleProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
  handleThreadMenuCommand(threadId: string, command: AgentThreadMenuCommand): void;
  handleThreadBulkCommand(command: AgentThreadBulkCommand): void;
}

export function useAgentThreadMenuCommands({
  agents,
  groups,
  onCloseProject,
  onOpenTerminalSessions,
  onReleaseProject,
  onThreadRemoved,
  onTrustProject,
  reportNotice,
  revealPath,
  startNewThread,
}: AgentThreadMenuCommandOptions): AgentThreadMenuCommands {
  const threadViews = agents.threads;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const remove = useCallback(
    async (threadId: string): Promise<boolean> => {
      const removed = await settleAgentThreadMutation(agents.remove(threadId));
      if (removed && mounted.current) onThreadRemoved(threadId);
      return removed;
    },
    [agents, onThreadRemoved],
  );

  const applyBulkAction = useCallback(
    (action: AgentThreadBulkAction, threadId: string): Promise<boolean> => {
      switch (action) {
        case "archive":
          return settleAgentThreadMutation(agents.archive(threadId));
        case "unarchive":
          return settleAgentThreadMutation(agents.unarchive?.(threadId));
        case "delete":
          return remove(threadId);
        default:
          return unsupportedBulkAction(action);
      }
    },
    [agents, remove],
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
      if (target.projectRootKey.startsWith("remote:") && command !== "copyPath") {
        reportNotice({
          kind: "info",
          message: "This project action is not available on the server yet.",
          action: null,
        });
        return;
      }
      switch (command) {
        case "trust":
          onTrustProject(target.projectRootKey);
          return;
        case "release":
          onReleaseProject(target.projectRootKey);
          return;
        case "close":
          if (target.rootPath !== null) onCloseProject(target.rootPath);
          return;
        case "reveal":
          if (target.rootPath === null) return;
          void revealPath(target.rootPath).catch(() => reportNotice(REVEAL_FAILED_NOTICE));
          return;
        case "copyPath":
          if (target.rootPath === null) return;
          copyText(target.rootPath);
          return;
        case "terminalSessions":
          onOpenTerminalSessions(target.projectRootKey, target.repositoryRoot);
          return;
        default:
          return unsupportedProjectCommand(command);
      }
    },
    [
      copyText,
      onCloseProject,
      onOpenTerminalSessions,
      onReleaseProject,
      onTrustProject,
      reportNotice,
      revealPath,
    ],
  );

  const handleThreadMenuCommand = useCallback(
    (threadId: string, command: AgentThreadMenuCommand) => {
      switch (command.kind) {
        case "snooze":
          agents.updateThreadOrganization?.(threadId, {
            snoozedUntil: command.until,
            settledAt: null,
          });
          return;
        case "unsnooze":
          agents.updateThreadOrganization?.(threadId, { snoozedUntil: null });
          return;
        case "settle":
          agents.updateThreadOrganization?.(threadId, {
            settledAt: Date.now(),
            snoozedUntil: null,
          });
          return;
        case "restore":
          agents.updateThreadOrganization?.(threadId, { settledAt: null, snoozedUntil: null });
          return;
        case "moveBefore":
        case "moveAfter":
          agents.reorderThread?.(
            threadId,
            command.targetThreadId,
            command.kind === "moveBefore" ? "before" : "after",
            ...(command.destination === undefined ? [] : [command.destination]),
          );
          return;
        case "togglePin":
          agents.togglePin(threadId);
          return;
        case "stop":
          void agents.stop(threadId);
          return;
        case "archive":
          void agents.archive(threadId);
          return;
        case "unarchive":
          void agents.unarchive?.(threadId);
          return;
        case "delete":
          void remove(threadId);
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

  const handleThreadBulkCommand = useCallback(
    (command: AgentThreadBulkCommand) => {
      if (command.kind === "stale") {
        reportNotice(staleSelectionNotice(command.action));
        return;
      }
      const plan = agentThreadBulkPlan(command.request, bulkCandidates(threadViews));
      const run = () =>
        mapWithBoundedConcurrency(
          plan.applyIds,
          AGENT_THREAD_BULK_CONCURRENCY,
          async (threadId) => ({
            threadId,
            ok: await applyBulkAction(plan.action, threadId),
          }),
        );
      void (agents.batchThreadMutations?.(run) ?? run()).then((outcomes) => {
        if (!mounted.current) return;
        const failed = outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.threadId);
        reportNotice({
          kind: failed.length === 0 ? "info" : "warning",
          message: agentThreadBulkReport(plan, failed),
          action: null,
        });
      });
    },
    [agents, applyBulkAction, reportNotice, threadViews],
  );

  return { handleProjectCommand, handleThreadBulkCommand, handleThreadMenuCommand };
}

function bulkCandidates(
  views: ReadonlyArray<AgentThreadView>,
): ReadonlyArray<AgentThreadBulkCandidate> {
  return views.map((view) => ({
    threadId: view.thread.threadId,
    ownerKey: view.thread.owner.rootKey,
    running: runningTurn(view.thread) !== null,
    archived: view.thread.archived,
  }));
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

function bulkPastTense(action: AgentThreadBulkAction): string {
  switch (action) {
    case "archive":
      return "archived";
    case "unarchive":
      return "unarchived";
    case "delete":
      return "deleted";
    default:
      return unsupportedBulkAction(action);
  }
}

function unsupportedBulkAction(action: never): never {
  throw new TypeError(`Unsupported agent thread bulk action: ${String(action)}.`);
}

function unsupportedProjectCommand(command: never): never {
  throw new TypeError(`Unsupported agent project command: ${String(command)}.`);
}

function unsupportedThreadMenuCommand(command: never): never {
  throw new TypeError(`Unsupported agent thread menu command: ${JSON.stringify(command)}.`);
}
