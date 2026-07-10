import {
  genericPhpFrameworkQueryCallbackVariableExpressionTypeAdapter,
  type PhpFrameworkQueryCallbackVariableExpressionTypeAdapter,
} from "./phpFrameworkQueryCallbackVariableExpressionTypeAdapter";
import { phpLaravelQueryCallbackVariableExpressionTypeAdapter } from "./phpLaravelQueryCallbackVariableExpressionTypeAdapter";

export function createPhpFrameworkQueryCallbackVariableExpressionTypeAdapters(
  isLaravelFrameworkActive: boolean,
): PhpFrameworkQueryCallbackVariableExpressionTypeAdapter {
  if (!isLaravelFrameworkActive) {
    return genericPhpFrameworkQueryCallbackVariableExpressionTypeAdapter;
  }

  return phpLaravelQueryCallbackVariableExpressionTypeAdapter;
}
