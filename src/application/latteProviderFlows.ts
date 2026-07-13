import type { EditorPosition } from "../domain/languageServerFeatures";
import { type NetteControlCache } from "./netteControlContracts";
import { type NettePresenterCache } from "./nettePresenterLinkDiscovery";
import { type LatteTemplateCache } from "./netteTemplateDiscovery";
import {
  type LatteCompletionItem,
} from "./latteCompletionItems";
import { isLatteMemberReferenceAt } from "./latteExpressionDetection";
import { netteLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";
import { type LatteViewDataCache } from "./latteExpressionIntelligence";
import type { LatteTemplateTypeCache } from "./netteTemplateTypes";
import type {
  LatteFrameworkCapabilities,
  LatteIntelligence,
} from "./latteIntelligenceContracts";
import type { LatteIntelligenceDependencies } from "./latteIntelligenceContracts";
import type { NavigationRequest } from "./navigationRequest";
import { type LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import {
  provideLatteDefinition as provideLatteDefinitionFlow,
} from "./latteDefinitionProvider";
import {
  provideLatteCompletions as provideLatteCompletionsFlow,
} from "./latteCompletionProvider";
import {
  provideLatteCodeActions as provideLatteCodeActionsFlow,
} from "./latteTemplateCodeActions";
import {
  createLattePhpPresenterLinkFlow,
} from "./lattePhpPresenterLinkFlow";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

export interface LatteProviderFlows {
  provideLatteCodeActions(
    source: string,
    range: PhpCodeActionRange,
  ): Promise<PhpCodeActionDescriptor[]>;
  provideLatteCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<LatteCompletionItem[]>;
  provideLatteDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  providePhpPresenterLinkCompletions(
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null>;
  isPhpPresenterLinkCompletionContext(source: string, offset: number): boolean;
  providePhpPresenterLinkDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  /**
   * @deprecated Use {@link providePhpPresenterLinkCompletions}.
   */
  provideNettePhpLinkCompletions(
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null>;
  /**
   * @deprecated Use {@link providePhpPresenterLinkDefinition}.
   */
  provideNettePhpLinkDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export function createLatteIntelligence(
  getDependencies: () => LatteIntelligenceDependencies,
  templateCache: LatteTemplateCache = {},
  viewDataCache: LatteViewDataCache = {},
  presenterCache: NettePresenterCache = {},
  componentCache: NetteControlCache = {},
  templateTypeCache: LatteTemplateTypeCache = {},
  frameworkCapabilities: LatteFrameworkCapabilities = netteLatteFrameworkCapabilities,
): LatteIntelligence {
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
    inFlight: {
      presenterInFlight: new Map(),
      templateTypeInFlight: new Map(),
      viewDataInFlight: new Map(),
    },
  });

  return {
    ...flows,
    shouldBlockLatteDefinitionFallback: isLatteMemberReferenceAt,
  };
}

export function createLatteProviderFlows(
  options: LatteProviderFlowFactoryOptions,
): LatteProviderFlows {
  const phpPresenterLinks = createLattePhpPresenterLinkFlow(options);

  return {
    provideLatteCodeActions: (source, range) =>
      provideLatteCodeActionsFlow(options, source, range),
    provideLatteCompletions: (source, position) =>
      provideLatteCompletionsFlow(options, source, position),
    provideLatteDefinition: (source, offset, request) =>
      provideLatteDefinitionFlow(options, source, offset, request),
    ...phpPresenterLinks,
  };
}
