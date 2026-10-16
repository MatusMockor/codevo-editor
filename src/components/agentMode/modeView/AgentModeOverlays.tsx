import { memo, type ComponentProps } from "react";
import { AgentTerminalSessionsPalette } from "../AgentTerminalSessionsPalette";
import { AgentThreadSearchPalette } from "../AgentThreadSearchPalette";

export interface AgentModeOverlaysProps {
  readonly search: ComponentProps<typeof AgentThreadSearchPalette>;
  readonly terminalSessions: ComponentProps<typeof AgentTerminalSessionsPalette> | null;
}

export const AgentModeOverlays = memo(function AgentModeOverlays({
  search,
  terminalSessions,
}: AgentModeOverlaysProps) {
  return (
    <>
      <AgentThreadSearchPalette {...search} />
      {terminalSessions !== null && <AgentTerminalSessionsPalette {...terminalSessions} />}
    </>
  );
});
