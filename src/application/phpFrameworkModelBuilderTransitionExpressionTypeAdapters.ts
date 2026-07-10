import {
  genericPhpFrameworkModelBuilderTransitionExpressionTypeAdapter,
  type PhpFrameworkModelBuilderTransitionExpressionTypeAdapter,
} from "./phpFrameworkModelBuilderTransitionExpressionTypeAdapter";
import { phpLaravelModelBuilderTransitionExpressionTypeAdapter } from "./phpLaravelModelBuilderTransitionExpressionTypeAdapter";

export function createPhpFrameworkModelBuilderTransitionExpressionTypeAdapters(
  isLaravelFrameworkActive: boolean,
): PhpFrameworkModelBuilderTransitionExpressionTypeAdapter {
  if (!isLaravelFrameworkActive) {
    return genericPhpFrameworkModelBuilderTransitionExpressionTypeAdapter;
  }

  return phpLaravelModelBuilderTransitionExpressionTypeAdapter;
}
