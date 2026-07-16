/**
 * Thin React mount for Latte/Nette intelligence.
 *
 * Provider flow and domain decisions live in `latteProviderFlows.ts`; this hook
 * only keeps fresh dependencies plus stable per-root caches.
 */

import { useRef } from "react";
import type {
  LatteIntelligence,
  LatteIntelligenceDependencies,
} from "./latteIntelligenceContracts";
import {
  createLatteIntelligence,
} from "./latteProviderFlows";
import {
  createLatteIntelligenceCaches,
} from "./latteIntelligenceCaches";
import { createLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";

export type {
  LatteFrameworkCapabilities,
  LatteIntelligence,
  LatteIntelligenceActiveDocument,
  LatteIntelligenceDependencies,
} from "./latteIntelligenceContracts";
export type {
  LatteCompletionItem,
  LatteCompletionItemKind,
} from "./latteCompletionItems";
export type { LatteDirectoryEntry, LatteTemplateCache } from "./netteTemplateDiscovery";
export type { LatteViewDataCache } from "./latteExpressionIntelligence";
export { createLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";
export { createLatteIntelligence } from "./latteProviderFlows";

export function useLatteIntelligence(
  dependencies: LatteIntelligenceDependencies,
): LatteIntelligence {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const cachesRef = useRef(createLatteIntelligenceCaches());
  const apiRef = useRef<LatteIntelligence | null>(null);

  if (!apiRef.current) {
    const caches = cachesRef.current;

    apiRef.current = createLatteIntelligence(
      () => dependenciesRef.current,
      caches.templateCache,
      caches.viewDataCache,
      caches.presenterCache,
      caches.componentCache,
      caches.templateTypeCache,
      createLatteFrameworkCapabilities(
        () => dependenciesRef.current.frameworkIntelligence.providers,
      ),
      caches.filterCache,
      caches.includeArgumentCache,
      caches.includeArgumentInFlight,
      caches.includeArgumentGenerationByRoot,
    );
  }

  return apiRef.current;
}
