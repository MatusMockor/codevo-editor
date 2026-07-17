import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  detectLatteIncludeCompletionAt,
  detectLatteTagCompletionAt,
} from "../domain/latteNavigation";
import { detectLatteNAttributeCompletionAt } from "../domain/latteAttributeCompletions";
import {
  latteFunctionCompletionContextAt,
  latteFunctionCompletions,
  latteNAttributeCompletions,
  latteTagCompletions as buildLatteTagCompletions,
  type LatteCompletionItem,
  type LatteFunctionCompletionContext,
} from "./latteCompletionItems";
import {
  latteFunctionDiscoveryContext,
  loadLatteFunctionRegistrations,
} from "./latteFunctionDiscovery";
import { resolveLatteProjectFilters } from "./latteFilterCallableResolution";
import {
  latteExpressionCompletions,
} from "./latteExpressionIntelligence";
import {
  isLattePresenterLinkIntelligenceActive,
  offsetAtEditorPosition,
} from "./latteIntelligenceRuntime";
import {
  latteControlCompletionAt,
  latteControlCompletions,
  latteFormFieldMacroCompletionAt,
  latteFormFieldMacroCompletions,
  latteFormNameCompletionAt,
  latteFormNameCompletions,
} from "./netteControlComponents";
import {
  lattePresenterLinkCompletions,
} from "./nettePresenterLinkCompletions";
import {
  latteTemplateCompletions,
} from "./netteTemplateCompletions";
import {
  latteNetteSnippetNameCompletions,
} from "./netteAjaxSnippetCompletions";
import {
  latteTranslationCompletionAt,
  latteTranslationCompletions,
} from "./latteTranslationTargets";
import {
  latteExpressionResolutionContext,
  latteTemplateCompletionContext,
  netteControlCompletionContext,
  nettePresenterLinkCompletionContext,
} from "./netteLatteProviderOptions";
import {
  LATTE_MAX_COMPLETIONS,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import {
  latteProviderRequestContext,
  type LatteProviderRequestContext,
} from "./latteProviderRequestContext";
import { latteBlockIncludeCompletionAt } from "./latteBlockSymbols";

export async function provideLatteCompletions(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  position: EditorPosition,
): Promise<LatteCompletionItem[]> {
  const offset = offsetAtEditorPosition(source, position);
  const blockCompletion = latteBlockIncludeCompletionAt(source, offset);

  if (blockCompletion) {
    return blockCompletion.candidates
      .slice(0, LATTE_MAX_COMPLETIONS)
      .map((declaration) => ({
        detail: "Same-file Latte block",
        insertText: declaration.name,
        kind: "block" as const,
        label: declaration.name,
        replaceEnd: blockCompletion.replaceSpan.end,
        replaceStart: blockCompletion.replaceSpan.start,
      }));
  }

  const attributeCompletion = detectLatteNAttributeCompletionAt(source, offset);

  if (attributeCompletion) {
    return latteNAttributeCompletions(attributeCompletion, LATTE_MAX_COMPLETIONS);
  }

  const request = latteProviderRequestContext(options);

  if (!request) {
    return [];
  }

  const { deps } = request;
  const includeCompletion = detectLatteIncludeCompletionAt(source, offset);

  if (includeCompletion) {
    return latteTemplateCompletions(
      latteTemplateCompletionContext(options, request),
      includeCompletion,
    );
  }

  const tagCompletion = detectLatteTagCompletionAt(source, offset);

  if (tagCompletion) {
    const tagCompletions = buildLatteTagCompletions(
      tagCompletion.prefix,
      tagCompletion.start,
      offset,
      LATTE_MAX_COMPLETIONS,
    );
    const functionCompletions = await latteTagPositionFunctionCompletions(
      options,
      request,
      source,
      tagCompletion,
      offset,
    );

    return [...tagCompletions, ...functionCompletions];
  }

  if (isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
    const linkCompletion =
      options.frameworkCapabilities.lattePresenterLinkCompletionContextAt(
        source,
        offset,
      );

    if (linkCompletion) {
      return lattePresenterLinkCompletions(
        nettePresenterLinkCompletionContext(options, request),
        linkCompletion,
      );
    }
  }

  const controlCompletion = latteControlCompletionAt(source, offset);

  if (controlCompletion) {
    return latteControlCompletions(
      netteControlCompletionContext(options, request),
      controlCompletion,
    );
  }

  const formFieldMacroCompletion = latteFormFieldMacroCompletionAt(source, offset);

  if (formFieldMacroCompletion) {
    return latteFormFieldMacroCompletions(
      netteControlCompletionContext(options, request),
      source,
      offset,
      formFieldMacroCompletion,
    );
  }

  const formNameCompletion = latteFormNameCompletionAt(source, offset);

  if (formNameCompletion) {
    return latteFormNameCompletions(
      netteControlCompletionContext(options, request),
      source,
      offset,
      formNameCompletion,
    );
  }

  const translationCompletion = latteTranslationCompletionAt(source, offset);

  if (translationCompletion) {
    return latteTranslationCompletions(request, translationCompletion);
  }

  const snippetCompletions = latteNetteSnippetNameCompletions(source, offset);

  if (snippetCompletions) {
    return snippetCompletions;
  }

  const expressionCompletions = await latteExpressionCompletions(
    latteExpressionResolutionContext(options, request),
    source,
    offset,
  );

  if (expressionCompletions.length > 0) {
    return expressionCompletions;
  }

  const functionCompletion = latteFunctionCompletionContextAt(source, offset);

  if (!functionCompletion) {
    return [];
  }

  return projectAwareLatteFunctionCompletions(
    options,
    request,
    functionCompletion,
  );
}

async function latteTagPositionFunctionCompletions(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
  source: string,
  tagCompletion: { prefix: string; start: number },
  offset: number,
): Promise<LatteCompletionItem[]> {
  if (source[tagCompletion.start + 1] === "/") {
    return [];
  }

  if (tagCompletion.prefix.length === 0) {
    return [];
  }

  return projectAwareLatteFunctionCompletions(options, request, {
    end: offset,
    prefix: tagCompletion.prefix,
    start: tagCompletion.start + 1,
  });
}

async function projectAwareLatteFunctionCompletions(
  options: LatteProviderFlowFactoryOptions,
  request: LatteProviderRequestContext,
  completion: LatteFunctionCompletionContext,
): Promise<LatteCompletionItem[]> {
  const discovery = latteFunctionDiscoveryContext(options, request);
  const registrations = await loadLatteFunctionRegistrations(discovery);

  if (!discovery.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();
  const resolvedFunctions = await resolveLatteProjectFilters(
    {
      deps: request.deps,
      isRequestedRootActive: discovery.isRequestedRootActive,
    },
    registrations.filter((registration) =>
      registration.name.toLowerCase().startsWith(normalizedPrefix),
    ),
  );

  if (!discovery.isRequestedRootActive()) {
    return [];
  }

  return latteFunctionCompletions(
    completion,
    LATTE_MAX_COMPLETIONS,
    resolvedFunctions,
  );
}
