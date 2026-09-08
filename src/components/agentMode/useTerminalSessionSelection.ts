import { useState } from "react";
import type { ExternalSessionsTarget } from "../../application/agentThreadPorts";
import type { ExternalAgentSessionView } from "../../domain/externalAgentSession";

export const MAX_SESSION_SELECTION = 50;

export function terminalSessionSelectionKey(session: ExternalAgentSessionView): string {
  return `${session.provider}:${session.sessionId}`;
}

export function useTerminalSessionSelection(
  isOpen: boolean,
  target: ExternalSessionsTarget | null,
  sessions: ReadonlyArray<ExternalAgentSessionView>,
) {
  const owner =
    isOpen && target !== null ? JSON.stringify([target.rootKey, target.repositoryRoot]) : null;
  const [state, setState] = useState<{
    readonly owner: string | null;
    readonly target: ExternalSessionsTarget | null;
    readonly keys: ReadonlySet<string>;
  }>({ owner, target, keys: new Set() });
  const eligible = new Map(
    sessions
      .filter((session) => session.alreadyImportedThreadId === null)
      .map((session) => [terminalSessionSelectionKey(session), session]),
  );
  const keys = new Set([...state.keys].filter((key) => eligible.has(key)));
  if (state.owner !== owner || state.target !== target || owner === null) keys.clear();
  if (state.owner !== owner || state.target !== target || keys.size !== state.keys.size)
    setState({ owner, target, keys });
  const selected = [...keys].flatMap((key) => {
    const session = eligible.get(key);
    return session === undefined ? [] : [session];
  });
  const select = (candidates: ReadonlyArray<ExternalAgentSessionView>): void => {
    if (owner === null) return;
    const next = new Set(keys);
    for (const session of candidates) {
      if (next.size >= MAX_SESSION_SELECTION) break;
      const key = terminalSessionSelectionKey(session);
      if (eligible.has(key)) next.add(key);
    }
    setState({ owner, target, keys: next });
  };
  const toggle = (session: ExternalAgentSessionView): void => {
    if (owner === null) return;
    const key = terminalSessionSelectionKey(session);
    if (!eligible.has(key)) return;
    const next = new Set(keys);
    if (next.has(key)) {
      next.delete(key);
      setState({ owner, target, keys: next });
      return;
    }
    select([session]);
  };
  return {
    keys,
    selected,
    select,
    toggle,
    clear: () => setState({ owner, target, keys: new Set() }),
  };
}
