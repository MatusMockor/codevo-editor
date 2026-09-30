import type { AgentCliKind } from "../domain/agentTask";
import { claudeModelReleaseDate, type ClaudeModelManifest } from "../domain/claudeModelCatalog";
import { codexModelReleaseDate, type CodexModelCatalog } from "../domain/codexModelCatalog";
import {
  findModelFirstSeen,
  modelIsNew,
  observeModelCatalogs,
  type ModelFirstSeenLedger,
} from "../domain/modelNewness";

export interface ModelNewness {
  isNew(provider: AgentCliKind, modelId: string): boolean;
}

export const NO_MODEL_NEWNESS: ModelNewness = Object.freeze({ isNew: () => false });

const SIGNATURE_SEPARATOR = "\n";

export function observeLiveModelCatalogs(
  ledger: ModelFirstSeenLedger,
  claude: ClaudeModelManifest,
  codex: CodexModelCatalog,
  nowMs: number,
): ModelFirstSeenLedger {
  return observeModelCatalogs(
    ledger,
    [
      {
        provider: "claudeCode",
        modelIds: claude.claudeCode.map((entry) => entry.choice),
        live: claude.source === "live",
      },
      {
        provider: "codex",
        modelIds: codex.models.map((entry) => entry.id),
        live: codex.source === "live",
      },
    ],
    nowMs,
  );
}

export function newModelSignature(
  claude: ClaudeModelManifest,
  codex: CodexModelCatalog,
  ledger: ModelFirstSeenLedger,
  nowMs: number,
): string {
  const fresh: Array<string> = [];
  for (const entry of claude.claudeCode) {
    const evidence = {
      catalogFlag: entry.isNew,
      releaseDate: claudeModelReleaseDate(entry),
      firstSeen: findModelFirstSeen(ledger, "claudeCode", entry.choice),
    };
    if (modelIsNew(evidence, nowMs)) fresh.push(newnessKey("claudeCode", entry.choice));
  }
  for (const entry of codex.models) {
    const evidence = {
      releaseDate: codexModelReleaseDate(entry),
      firstSeen: findModelFirstSeen(ledger, "codex", entry.id),
    };
    if (modelIsNew(evidence, nowMs)) fresh.push(newnessKey("codex", entry.id));
  }
  return fresh.sort().join(SIGNATURE_SEPARATOR);
}

export function createModelNewness(signature: string): ModelNewness {
  if (signature === "") return NO_MODEL_NEWNESS;
  const fresh = new Set(signature.split(SIGNATURE_SEPARATOR));
  return Object.freeze({
    isNew: (provider: AgentCliKind, modelId: string) => fresh.has(newnessKey(provider, modelId)),
  });
}

function newnessKey(provider: AgentCliKind, modelId: string): string {
  return `${provider}/${modelId}`;
}
