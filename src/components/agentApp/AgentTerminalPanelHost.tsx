import { useCallback, type PointerEvent } from "react";
import type { AgentProviderSignInSurface } from "../../application/useAgentProviderSignIn";
import type { TerminalTheme } from "../../domain/settings";
import type { TerminalGateway } from "../../domain/terminal";
import type { WorkbenchNotice } from "../../domain/workbenchNotice";
import { BottomPanel } from "../BottomPanel";

export interface AgentTerminalPanelHostProps {
  readonly onHide: () => void;
  readonly onRevealFile: (path: string, line: number | null) => void;
  readonly onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  readonly onTerminalSessionReady: (sessionId: number | null) => void;
  readonly onTrustWorkspace: () => void;
  readonly providerSignIn: AgentProviderSignInSurface;
  readonly terminalGateway: TerminalGateway;
  readonly terminalOwnerKey: string | null;
  readonly terminalShellIntegrationEnabled: boolean;
  readonly terminalTheme: TerminalTheme;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
}

export function AgentTerminalPanelHost({
  onHide,
  onRevealFile,
  onResizeStart,
  onTerminalSessionReady,
  onTrustWorkspace,
  providerSignIn,
  terminalGateway,
  terminalOwnerKey,
  terminalShellIntegrationEnabled,
  terminalTheme,
  workspaceRoot,
  workspaceTrusted,
}: AgentTerminalPanelHostProps) {
  const openTerminalLink = useCallback(
    async (notice: WorkbenchNotice) => {
      const target = notice.navigationTarget;
      if (!target) return false;
      onRevealFile(target.path, target.range.start.lineNumber);
      return true;
    },
    [onRevealFile],
  );
  return (
    <BottomPanel
      onClose={onHide}
      onOpenProblem={openTerminalLink}
      onResizeStart={onResizeStart}
      onTerminalSessionReady={onTerminalSessionReady}
      onTrustWorkspace={onTrustWorkspace}
      providerSignIn={providerSignIn}
      terminalGateway={terminalGateway}
      terminalOwnerKey={terminalOwnerKey}
      terminalShellIntegrationEnabled={terminalShellIntegrationEnabled}
      terminalTheme={terminalTheme}
      workspaceRoot={workspaceRoot}
      workspaceTrusted={workspaceTrusted}
    />
  );
}
