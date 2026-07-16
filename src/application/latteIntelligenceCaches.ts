import type { LatteViewDataCache } from "./latteExpressionIntelligence";
import type { LatteFilterCache } from "./latteFilterDiscovery";
import type { NetteControlCache } from "./netteControlContracts";
import type { NettePresenterCache } from "./nettePresenterLinkDiscovery";
import type {
  NettePresenterMappingCache,
  NettePresenterMappingGeneration,
  NettePresenterMappingInFlight,
} from "./nettePresenterMappingDiscovery";
import { createNettePresenterMappingGeneration } from "./nettePresenterMappingDiscovery";
import type { LatteTemplateCache } from "./netteTemplateDiscovery";
import type { LatteTemplateTypeCache } from "./netteTemplateTypes";
import type {
  NetteIncludedTemplateArgumentCache,
  NetteIncludedTemplateArgumentInFlight,
} from "./netteIncludedTemplateArguments";

export type LatteIncludeArgumentGenerationByRoot = Record<string, number>;

export interface LatteIntelligenceCaches {
  componentCache: NetteControlCache;
  filterCache: LatteFilterCache;
  includeArgumentCache: NetteIncludedTemplateArgumentCache;
  includeArgumentGenerationByRoot: LatteIncludeArgumentGenerationByRoot;
  includeArgumentInFlight: NetteIncludedTemplateArgumentInFlight;
  presenterCache: NettePresenterCache;
  presenterMappingCache: NettePresenterMappingCache;
  presenterMappingGeneration: NettePresenterMappingGeneration;
  presenterMappingInFlight: NettePresenterMappingInFlight;
  templateCache: LatteTemplateCache;
  templateTypeCache: LatteTemplateTypeCache;
  viewDataCache: LatteViewDataCache;
}

export function createLatteIntelligenceCaches(): LatteIntelligenceCaches {
  return {
    componentCache: {},
    filterCache: {},
    includeArgumentCache: {},
    includeArgumentGenerationByRoot: {},
    includeArgumentInFlight: {
      graphs: new Map(),
      queries: new Map(),
    },
    presenterCache: {},
    presenterMappingCache: {},
    presenterMappingGeneration: createNettePresenterMappingGeneration(),
    presenterMappingInFlight: new Map(),
    templateCache: {},
    templateTypeCache: {},
    viewDataCache: {},
  };
}
