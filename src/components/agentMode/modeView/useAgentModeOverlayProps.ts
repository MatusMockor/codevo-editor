import { useMemo } from "react";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import { useAgentLatestCallback } from "../useAgentThreadPresentationViews";
import type { AgentModeOverlaysProps } from "./AgentModeOverlays";
import type { AgentModeTerminalSessions } from "./useAgentModeTerminalSessions";

export interface AgentModeOverlayPropsInput {
  readonly navigation: AgentThreadNavigation;
  readonly terminalSessions: AgentModeTerminalSessions;
}

export function useAgentModeOverlayProps({
  navigation,
  terminalSessions,
}: AgentModeOverlayPropsInput): AgentModeOverlaysProps {
  const { palette, search: searchState } = navigation;
  const activate = useAgentLatestCallback(palette.activate);
  const search = useMemo<AgentModeOverlaysProps["search"]>(
    () => ({
      archivedThreadIds: palette.archivedThreadIds,
      isOpen: palette.open,
      onActivate: activate,
      onChangeQuery: searchState.setQuery,
      onClose: palette.close,
      pending: searchState.pending,
      query: searchState.query,
      result: searchState.result,
      titles: palette.titles,
    }),
    [
      activate,
      palette.archivedThreadIds,
      palette.open,
      palette.close,
      palette.titles,
      searchState.setQuery,
      searchState.pending,
      searchState.query,
      searchState.result,
    ],
  );
  return {
    search,
    terminalSessions: terminalSessions.paletteProps,
  };
}
