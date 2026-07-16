import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  detectLatteIncludeCompletionAt,
  detectLatteTagCompletionAt,
} from "../domain/latteNavigation";
import {
  latteTagCompletions as buildLatteTagCompletions,
  type LatteCompletionItem,
} from "./latteCompletionItems";
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
    return buildLatteTagCompletions(
      tagCompletion.prefix,
      tagCompletion.start,
      offset,
      LATTE_MAX_COMPLETIONS,
    );
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

  return latteExpressionCompletions(
    latteExpressionResolutionContext(options, request),
    source,
    offset,
  );
}
