import type { AgentComposerDraftPreferencePort } from "../../application/agentComposerDraftPreferencePort";
import type { AgentProjectSelectionPreferencePort } from "../../application/agentProjectSelectionPreferencePort";
import {
  useAgentTranscriptPositionMemory,
  type AgentTranscriptPositionMemory,
  type AgentTranscriptPositionPreferencePort,
} from "../../application/agentTranscriptPositionMemory";
import { useAgentComposerDraftPersistence } from "../../application/useAgentComposerDraftPersistence";
import { useSessionRestoreFlushTriggers } from "../../application/useDebouncedSessionWriter";
import { BrowserAgentComposerDraftPreference } from "../../infrastructure/browserAgentComposerDraftPreference";
import { BrowserAgentProjectSelectionPreference } from "../../infrastructure/browserAgentProjectSelectionPreference";
import { BrowserAgentTranscriptPositionPreference } from "../../infrastructure/browserAgentTranscriptPositionPreference";
import type { AgentNavigationSession } from "./useAgentThreadNavigation";
import { useRestoredAgentNavigationSession } from "./useRestoredAgentNavigationSession";

export interface AgentSessionRestorePorts {
  readonly projectSelections: AgentProjectSelectionPreferencePort | null;
  readonly composerDrafts: AgentComposerDraftPreferencePort | null;
  readonly transcriptPositions: AgentTranscriptPositionPreferencePort | null;
}

export interface AgentSessionRestore {
  readonly navigationSession: AgentNavigationSession;
  readonly transcriptPositions: AgentTranscriptPositionMemory;
}

export const DISABLED_AGENT_SESSION_RESTORE: AgentSessionRestorePorts = Object.freeze({
  projectSelections: null,
  composerDrafts: null,
  transcriptPositions: null,
});

export function browserAgentSessionRestorePorts(): AgentSessionRestorePorts {
  return {
    projectSelections: new BrowserAgentProjectSelectionPreference(),
    composerDrafts: new BrowserAgentComposerDraftPreference(),
    transcriptPositions: new BrowserAgentTranscriptPositionPreference(),
  };
}

export function useAgentSessionRestore(ports: AgentSessionRestorePorts): AgentSessionRestore {
  useSessionRestoreFlushTriggers();
  useAgentComposerDraftPersistence(ports.composerDrafts);
  const navigationSession = useRestoredAgentNavigationSession(ports.projectSelections);
  const transcriptPositions = useAgentTranscriptPositionMemory(ports.transcriptPositions);
  return { navigationSession, transcriptPositions };
}
