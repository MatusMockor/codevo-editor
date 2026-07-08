/**
 * Nette **NEON** config navigation + completion intelligence (spec §4.8, Slice
 * 8), a sibling of `useLatteIntelligence`: the workbench controller mounts it
 * with a thin dependency surface (strangler pattern), while every decision lives
 * here so the logic is unit-testable WITHOUT the controller, Monaco, or React.
 *
 * Responsibilities:
 *   - `provideNeonDefinition` (Cmd+B): a service-class reference
 *     (`App\Model\Foo`, entity `Foo(`, `factory: Foo::method`) resolves to its
 *     PHP file through the injected `openClassTarget` (the SAME index + PSR-4
 *     resolver a Laravel `use Foo\Bar;` jump uses); an `includes:` entry resolves
 *     to the referenced `.neon` file, relative to the current config's directory.
 *   - `provideNeonCompletions`: class-name completion inside a `services:` value
 *     position, sourced from the injected workspace class-name search (the
 *     project symbol index, filtered to type symbols).
 *
 * GATING (spec §4.9): every entry point is inert unless BOTH an active framework
 * provider opts into NEON config intelligence AND the semantic tier (`fullSmart`)
 * is on. Highlighting runs independently, so a `.neon` file in a non-Nette
 * project (or `basic` mode) gets nothing from here.
 *
 * ISOLATION (project rule): each async flow captures the requested workspace root
 * up front and re-checks the LIVE root after every `await`, dropping stale
 * results so nothing leaks across project tabs. The class-resolution and
 * class-name-search dependencies carry their OWN isolation guards inside the
 * controller; this hook additionally re-checks before its own `openTarget`.
 */

import { useRef } from "react";
import type {
  NeonIntelligence,
  NeonIntelligenceDependencies,
} from "./neonIntelligenceContracts";
import { createNeonIntelligence } from "./neonProviderFlows";
import {
  type NeonConfigCache,
} from "./neonProjectConfigDiscovery";

export type { NeonConfigCache } from "./neonProjectConfigDiscovery";

export type { NeonCompletionItem, NeonCompletionItemKind } from "./neonCompletionProvider";
export type {
  NeonDirectoryEntry,
  NeonIntelligence,
  NeonIntelligenceActiveDocument,
  NeonIntelligenceDependencies,
} from "./neonIntelligenceContracts";
export { createNeonIntelligence } from "./neonProviderFlows";

/**
 * Thin React wrapper: keeps a live dependency ref (so the stable API always sees
 * the latest gating flags / root), then builds the intelligence API exactly once
 * so its callback identities never churn across renders.
 */
export function useNeonIntelligence(
  dependencies: NeonIntelligenceDependencies,
): NeonIntelligence {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const configCacheRef = useRef<NeonConfigCache>({});
  const apiRef = useRef<NeonIntelligence | null>(null);

  if (!apiRef.current) {
    apiRef.current = createNeonIntelligence(
      () => dependenciesRef.current,
      configCacheRef.current,
    );
  }

  return apiRef.current;
}
