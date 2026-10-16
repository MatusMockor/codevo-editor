import { useCallback, useMemo, type ComponentProps } from "react";
import type { AgentTasksNotice } from "../../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { AgentTerminalSessionsPalette } from "../AgentTerminalSessionsPalette";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import { useAgentSessionImport } from "../useAgentSessionImport";
import type { AgentModeAgents, AgentModeNoticeReporter } from "./agentModeViewProps";
import type { AgentModeProjects } from "./useAgentModeProjects";

const TERMINAL_SESSIONS_UNAVAILABLE_NOTICE: AgentTasksNotice = {
  kind: "warning",
  message: "Terminal sessions are not available in this workbench.",
  action: null,
};

export interface AgentModeTerminalSessionsOptions {
  readonly agents: AgentModeAgents;
  readonly navigation: AgentThreadNavigation;
  readonly groups: AgentModeProjects["groups"];
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly setLocalNotice: AgentModeNoticeReporter;
}

export function useAgentModeTerminalSessions({
  agents,
  navigation,
  groups,
  projects,
  setLocalNotice,
}: AgentModeTerminalSessionsOptions) {
  const externalSessions = agents.externalSessions ?? null;
  const terminalSessionsPalette = navigation.terminalSessions;
  const terminalSessionsTarget = terminalSessionsPalette.target;
  const selectThread = navigation.selectThread;
  const selectImportedThread = useCallback(
    (threadId: string) => {
      selectThread(threadId);
      terminalSessionsPalette.close();
      externalSessions?.close();
    },
    [externalSessions, selectThread, terminalSessionsPalette],
  );
  const sessionImport = useAgentSessionImport({
    open: terminalSessionsPalette.open,
    target: terminalSessionsTarget,
    projects,
    surface: externalSessions,
    importSession: agents.importExternalSession,
    onComplete: selectImportedThread,
  });
  const cancelSessionImport = sessionImport.cancel;
  const openTerminalSessions = useCallback(
    (projectRootKey: string, repositoryRoot: string) => {
      if (projectRootKey.startsWith("remote:") || repositoryRoot.startsWith("remote:")) {
        setLocalNotice(TERMINAL_SESSIONS_UNAVAILABLE_NOTICE);
        return;
      }
      if (externalSessions === null) {
        setLocalNotice(TERMINAL_SESSIONS_UNAVAILABLE_NOTICE);
        return;
      }
      if (!terminalSessionsPalette.openFor(projectRootKey, repositoryRoot)) return;
      cancelSessionImport();
      void externalSessions.open({ rootKey: projectRootKey, repositoryRoot });
    },
    [cancelSessionImport, externalSessions, setLocalNotice, terminalSessionsPalette],
  );
  const closeTerminalSessions = useCallback(() => {
    cancelSessionImport();
    terminalSessionsPalette.close();
    externalSessions?.close();
  }, [cancelSessionImport, externalSessions, terminalSessionsPalette]);
  const newThreadTargetForRail = navigation.newThreadTarget;
  const railTerminalSessionsTarget = useMemo(
    () => newThreadTargetForRail(),
    [newThreadTargetForRail],
  );
  const terminalSessionsProjectLabel = useMemo(() => {
    if (terminalSessionsTarget === null) return null;
    return (
      groups.find((group) => group.projectRootKey === terminalSessionsTarget.projectRootKey)
        ?.label ?? null
    );
  }, [groups, terminalSessionsTarget]);
  const paletteOpen = terminalSessionsPalette.open;
  const { surface, importOne, importMany, importProgress, importNotice } = sessionImport;
  const paletteProps = useMemo<ComponentProps<typeof AgentTerminalSessionsPalette> | null>(
    () =>
      surface === null
        ? null
        : {
            isOpen: paletteOpen,
            onClose: closeTerminalSessions,
            onImport: importOne,
            onImportMany: importMany,
            importProgress,
            importNotice,
            onSelectImported: selectImportedThread,
            projectLabel: terminalSessionsProjectLabel,
            surface,
          },
    [
      closeTerminalSessions,
      importMany,
      importNotice,
      importOne,
      importProgress,
      paletteOpen,
      selectImportedThread,
      surface,
      terminalSessionsProjectLabel,
    ],
  );
  return {
    paletteProps,
    paletteOpen,
    selectImportedThread,
    sessionImport,
    openTerminalSessions,
    closeTerminalSessions,
    railTerminalSessionsTarget,
    terminalSessionsProjectLabel,
  };
}

export type AgentModeTerminalSessions = ReturnType<typeof useAgentModeTerminalSessions>;
