import type { RemoteRunnerServer } from "../../../domain/remoteRunner";
import type { RepositoryLookupGateway } from "../../../application/repositoryLookupPorts";
import { ProjectOnboardingLayer } from "../../projects/ProjectOnboardingLayer";
import { AgentTerminalSessionsPalette } from "../AgentTerminalSessionsPalette";
import { AgentThreadSearchPalette } from "../AgentThreadSearchPalette";
import type { AgentWorkbenchChrome } from "../agentWorkbenchChrome";
import type { AgentThreadNavigation } from "../useAgentThreadNavigation";
import type { AgentModeCreation } from "./useAgentModeCreation";
import type { AgentModeTerminalSessions } from "./useAgentModeTerminalSessions";

export interface AgentModeOverlaysProps {
  readonly addProjectChrome: AgentWorkbenchChrome["addProject"];
  readonly creation: AgentModeCreation["creation"];
  readonly lookupGateway: RepositoryLookupGateway | null;
  readonly selectedServerId: string | null;
  readonly servers: readonly RemoteRunnerServer[];
  readonly palette: AgentThreadNavigation["palette"];
  readonly search: AgentThreadNavigation["search"];
  readonly terminalSessions: AgentModeTerminalSessions;
}

export function AgentModeOverlays({
  addProjectChrome,
  creation,
  lookupGateway,
  selectedServerId,
  servers,
  palette,
  search,
  terminalSessions,
}: AgentModeOverlaysProps) {
  const { sessionImport } = terminalSessions;
  return (
    <>
      <ProjectOnboardingLayer
        chrome={addProjectChrome}
        creation={creation}
        lookupGateway={lookupGateway}
        selectedServerId={selectedServerId}
        servers={servers}
      />
      <AgentThreadSearchPalette
        archivedThreadIds={palette.archivedThreadIds}
        isOpen={palette.open}
        onActivate={palette.activate}
        onChangeQuery={search.setQuery}
        onClose={palette.close}
        pending={search.pending}
        query={search.query}
        result={search.result}
        titles={palette.titles}
      />
      {sessionImport.surface !== null && (
        <AgentTerminalSessionsPalette
          isOpen={terminalSessions.paletteOpen}
          onClose={terminalSessions.closeTerminalSessions}
          onImport={sessionImport.importOne}
          onImportMany={sessionImport.importMany}
          importProgress={sessionImport.importProgress}
          importNotice={sessionImport.importNotice}
          onSelectImported={terminalSessions.selectImportedThread}
          projectLabel={terminalSessions.terminalSessionsProjectLabel}
          surface={sessionImport.surface}
        />
      )}
    </>
  );
}
