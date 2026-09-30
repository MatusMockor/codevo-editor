import type { AgentComposerDraftEntry } from "../domain/agentComposerDraftSnapshot";

export interface AgentComposerDraftPreferencePort {
  load(): readonly AgentComposerDraftEntry[];
  save(entries: readonly AgentComposerDraftEntry[]): void;
}
