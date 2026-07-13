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

export async function provideLatteCompletions(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  position: EditorPosition,
): Promise<LatteCompletionItem[]> {
  const request = latteProviderRequestContext(options);

  if (!request) {
    return [];
  }

  const { deps } = request;
  const offset = offsetAtEditorPosition(source, position);
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

  const formNameCompletion = latteFormNameCompletionAt(source, offset);

  if (formNameCompletion) {
    return latteFormNameCompletions(
      netteControlCompletionContext(options, request),
      source,
      offset,
      formNameCompletion,
    );
  }

  return latteExpressionCompletions(
    latteExpressionResolutionContext(options, request),
    source,
    offset,
  );
}
