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
import { isLatteMemberReferenceAt } from "./latteExpressionDetection";
import { netteLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";
import {
  createLatteProviderFlows,
  type LatteProviderFlowCaches,
  type LatteProviderFlowInFlight,
} from "./latteProviderFlows";
import type { NetteControlCache } from "./netteControlComponents";
import type {
  NettePresenterCache,
  NettePresenterInFlight,
} from "./nettePresenterLinks";
import type { LatteTemplateCache } from "./netteTemplates";
import type {
  LatteTemplateTypeCache,
  LatteTemplateTypeInFlight,
} from "./netteTemplateTypes";
import type {
  LatteViewDataCache,
  LatteViewDataInFlight,
} from "./latteExpressionIntelligence";
import type { LatteFrameworkCapabilities } from "./latteIntelligenceContracts";

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

export function createLatteIntelligence(
  getDependencies: () => LatteIntelligenceDependencies,
  templateCache: LatteTemplateCache = {},
  viewDataCache: LatteViewDataCache = {},
  presenterCache: NettePresenterCache = {},
  componentCache: NetteControlCache = {},
  templateTypeCache: LatteTemplateTypeCache = {},
  frameworkCapabilities: LatteFrameworkCapabilities = netteLatteFrameworkCapabilities,
): LatteIntelligence {
  const inFlight: LatteProviderFlowInFlight = {
    presenterInFlight: new Map(),
    templateTypeInFlight: new Map(),
    viewDataInFlight: new Map(),
  };
  const flows = createLatteProviderFlows({
    caches: {
      componentCache,
      presenterCache,
      templateCache,
      templateTypeCache,
      viewDataCache,
    },
    frameworkCapabilities,
    getDependencies,
    inFlight,
  });

  return {
    ...flows,
    shouldBlockLatteDefinitionFallback: isLatteMemberReferenceAt,
  };
}

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
  const inFlightRef = useRef<LatteProviderFlowInFlight>({
    presenterInFlight: new Map() as NettePresenterInFlight,
    templateTypeInFlight: new Map() as LatteTemplateTypeInFlight,
    viewDataInFlight: new Map() as LatteViewDataInFlight,
  });
  const apiRef = useRef<LatteIntelligence | null>(null);

  if (!apiRef.current) {
    const caches: LatteProviderFlowCaches = {
      componentCache: componentCacheRef.current,
      presenterCache: presenterCacheRef.current,
      templateCache: templateCacheRef.current,
      templateTypeCache: templateTypeCacheRef.current,
      viewDataCache: viewDataCacheRef.current,
    };
    const flows = createLatteProviderFlows({
      caches,
      frameworkCapabilities: netteLatteFrameworkCapabilities,
      getDependencies: () => dependenciesRef.current,
      inFlight: inFlightRef.current,
    });

    apiRef.current = {
      ...flows,
      shouldBlockLatteDefinitionFallback: isLatteMemberReferenceAt,
    };
  }

  return apiRef.current;
}
