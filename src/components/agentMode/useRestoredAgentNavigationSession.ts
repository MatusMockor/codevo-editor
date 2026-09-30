import { useRef, useState } from "react";
import type { AgentProjectSelectionPreferencePort } from "../../application/agentProjectSelectionPreferencePort";
import {
  useDebouncedSessionWriter,
  type UseDebouncedSessionWriterOptions,
} from "../../application/useDebouncedSessionWriter";
import { createAgentNavigationRestoreLedger } from "./agentNavigationRestoreLedger";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";

export function useRestoredAgentNavigationSession(
  preference: AgentProjectSelectionPreferencePort | null,
  options: UseDebouncedSessionWriterOptions = {},
): AgentNavigationSession {
  const preferenceRef = useRef(preference);
  preferenceRef.current = preference;
  const sessionRef = useRef<AgentNavigationSession | null>(null);
  const writer = useDebouncedSessionWriter(() => {
    const ledger = sessionRef.current?.restore;
    if (ledger === undefined) return;
    preferenceRef.current?.save(ledger.snapshot());
  }, options);
  const [session] = useState<AgentNavigationSession>(() => ({
    current: {
      selectedThreadId: null,
      selectedThreadOwnerKey: null,
      scopeState: NO_SCOPE_STATE,
    },
    restore: createAgentNavigationRestoreLedger(preference?.load() ?? [], () => writer.schedule()),
  }));
  sessionRef.current = session;
  return session;
}
