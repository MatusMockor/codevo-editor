import { useEffect, useMemo, useRef, useState } from "react";
import type { ClaudeModelManifest } from "../domain/claudeModelCatalog";
import type { CodexModelCatalog } from "../domain/codexModelCatalog";
import type { ModelFirstSeenRepository } from "./modelFirstSeenRepository";
import {
  createModelNewness,
  newModelSignature,
  observeLiveModelCatalogs,
  type ModelNewness,
} from "./modelNewness";

const NEWNESS_REEVALUATION_MS = 3_600_000;

export function useModelNewness(
  repository: ModelFirstSeenRepository,
  claude: ClaudeModelManifest,
  codex: CodexModelCatalog,
  clock: () => number = Date.now,
): ModelNewness {
  const [ledger, setLedger] = useState(() => repository.read());
  const [nowMs, setNowMs] = useState(clock);
  const ledgerRef = useRef(ledger);

  useEffect(() => {
    const observedAt = clock();
    setNowMs(observedAt);
    const next = observeLiveModelCatalogs(ledgerRef.current, claude, codex, observedAt);
    if (next === ledgerRef.current) return;
    ledgerRef.current = next;
    repository.write(next);
    setLedger(next);
  }, [claude, clock, codex, repository]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(clock()), NEWNESS_REEVALUATION_MS);
    return () => clearInterval(timer);
  }, [clock]);

  const signature = useMemo(
    () => newModelSignature(claude, codex, ledger, nowMs),
    [claude, codex, ledger, nowMs],
  );
  return useMemo(() => createModelNewness(signature), [signature]);
}
