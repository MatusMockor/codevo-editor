import {
  genericPhpFrameworkModelFluentExpressionTypeAdapter,
  type PhpFrameworkModelFluentExpressionTypeAdapter,
} from "./phpFrameworkModelFluentExpressionTypeAdapter";
import { phpLaravelModelFluentExpressionTypeAdapter } from "./phpLaravelModelFluentExpressionTypeAdapter";

export function createPhpFrameworkModelFluentExpressionTypeAdapters(
  isLaravelFrameworkActive: boolean,
): PhpFrameworkModelFluentExpressionTypeAdapter {
  if (!isLaravelFrameworkActive) {
    return genericPhpFrameworkModelFluentExpressionTypeAdapter;
  }

  return phpLaravelModelFluentExpressionTypeAdapter;
}
