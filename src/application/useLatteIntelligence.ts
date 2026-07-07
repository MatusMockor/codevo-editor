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
import type { NetteControlCache } from "./netteControlComponents";
import type { NettePresenterCache } from "./nettePresenterLinks";
import type { LatteTemplateCache } from "./netteTemplates";
import type { LatteTemplateTypeCache } from "./netteTemplateTypes";
import type { LatteViewDataCache } from "./latteExpressionIntelligence";

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
export type { LatteDirectoryEntry, LatteTemplateCache } from "./netteTemplates";
export type { LatteViewDataCache } from "./latteExpressionIntelligence";
export { netteLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";
export { createLatteIntelligence } from "./latteProviderFlows";

export function useLatteIntelligence(
  dependencies: LatteIntelligenceDependencies,
): LatteIntelligence {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const templateCacheRef = useRef<LatteTemplateCache>({});
  const viewDataCacheRef = useRef<LatteViewDataCache>({});
  const presenterCacheRef = useRef<NettePresenterCache>({});
  const componentCacheRef = useRef<NetteControlCache>({});
  const templateTypeCacheRef = useRef<LatteTemplateTypeCache>({});
  const apiRef = useRef<LatteIntelligence | null>(null);

  if (!apiRef.current) {
    apiRef.current = createLatteIntelligence(
      () => dependenciesRef.current,
      templateCacheRef.current,
      viewDataCacheRef.current,
      presenterCacheRef.current,
      componentCacheRef.current,
      templateTypeCacheRef.current,
    );
  }

  return apiRef.current;
}
