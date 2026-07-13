import { phpLaravelCollectionCallbackContextForVariable } from "../domain/phpLaravelCollectionCallbackContext";
import type { PhpFrameworkCollectionCallbackVariableExpressionTypeAdapter } from "./phpFrameworkCollectionCallbackVariableExpressionTypeAdapter";

export const phpLaravelCollectionCallbackVariableExpressionTypeAdapter: PhpFrameworkCollectionCallbackVariableExpressionTypeAdapter =
  {
    variableType: async ({
      position,
      resolveCollectionElementType,
      source,
      variableName,
    }) => {
      if (!variableName) {
        return null;
      }

      const callbackContext = phpLaravelCollectionCallbackContextForVariable(
        source,
        position,
        variableName,
      );

      if (!callbackContext) {
        return null;
      }

      return resolveCollectionElementType(callbackContext.receiverExpression);
    },
  };
