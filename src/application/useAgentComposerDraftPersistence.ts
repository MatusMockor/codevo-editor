import { useEffect, useState } from "react";
import type { AgentComposerDraftPreferencePort } from "./agentComposerDraftPreferencePort";
import { agentComposerDraftStore, type AgentComposerDraftStore } from "./agentComposerDrafts";
import {
  useDebouncedSessionWriter,
  type UseDebouncedSessionWriterOptions,
} from "./useDebouncedSessionWriter";

const hydratedStores = new WeakSet<AgentComposerDraftStore>();

export function useAgentComposerDraftPersistence(
  port: AgentComposerDraftPreferencePort | null,
  store: AgentComposerDraftStore = agentComposerDraftStore,
  options: UseDebouncedSessionWriterOptions = {},
): void {
  useState(() => hydrateOnce(port, store));
  const writer = useDebouncedSessionWriter(() => port?.save(store.snapshot()), options);
  useEffect(() => {
    if (port === null) return;
    return store.subscribe(writer.schedule);
  }, [port, store, writer]);
}

function hydrateOnce(
  port: AgentComposerDraftPreferencePort | null,
  store: AgentComposerDraftStore,
) {
  if (port === null || hydratedStores.has(store)) return;
  hydratedStores.add(store);
  store.hydrate(port.load());
}
