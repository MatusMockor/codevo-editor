import type { LatteViewDataCache } from "./latteExpressionIntelligence";
import type { NetteControlCache } from "./netteControlContracts";
import type { NettePresenterCache } from "./nettePresenterLinkDiscovery";
import type { LatteTemplateCache } from "./netteTemplateDiscovery";
import type { LatteTemplateTypeCache } from "./netteTemplateTypes";

export interface LatteIntelligenceCaches {
  componentCache: NetteControlCache;
  presenterCache: NettePresenterCache;
  templateCache: LatteTemplateCache;
  templateTypeCache: LatteTemplateTypeCache;
  viewDataCache: LatteViewDataCache;
}

export function createLatteIntelligenceCaches(): LatteIntelligenceCaches {
  return {
    componentCache: {},
    presenterCache: {},
    templateCache: {},
    templateTypeCache: {},
    viewDataCache: {},
  };
}
