import type { NeonCrossFileRepository } from "./neonCrossFileSymbolSweep";
import { snapshotNeonCrossFileRepository } from "./neonCrossFileSymbolSweep";
import {
  NEON_SEMANTIC_DIAGNOSTIC_RULES,
  diagnoseNeonSemanticSnapshot,
  type NeonSemanticDiagnostic,
  type NeonSemanticDiagnosticRule,
} from "../domain/neonSemanticDiagnostics";
import { neonSemanticDocumentFactsFromSource } from "../domain/neonSemanticFacts";

/**
 * Runs diagnostics from one fresh repository snapshot. `null` means the request
 * became stale and must not mutate marker state; `[]` is an authoritative clear.
 */
export async function provideNeonSemanticDiagnostics(
  repository: NeonCrossFileRepository,
  rules: readonly NeonSemanticDiagnosticRule[] = NEON_SEMANTIC_DIAGNOSTIC_RULES,
): Promise<readonly NeonSemanticDiagnostic[] | null> {
  if (repository.isCurrent?.() === false) return null;
  const snapshot = await snapshotNeonCrossFileRepository(repository);
  if (
    repository.isCurrent?.() === false ||
    snapshot.incompleteReasons.includes("staleRepository")
  ) {
    return null;
  }
  if (snapshot.status !== "complete") return [];
  const documents = snapshot.component.map(({ path, source }) =>
    neonSemanticDocumentFactsFromSource(path, source),
  );
  const diagnostics = diagnoseNeonSemanticSnapshot(
    { documents, state: "complete" },
    undefined,
    rules,
  );
  return repository.isCurrent?.() === false ? null : diagnostics;
}
