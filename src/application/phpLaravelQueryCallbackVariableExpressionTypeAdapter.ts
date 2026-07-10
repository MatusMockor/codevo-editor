import { phpLaravelQueryCallbackContextForVariable } from "../domain/phpSemanticEngine";
import type { PhpFrameworkQueryCallbackVariableExpressionTypeAdapter } from "./phpFrameworkQueryCallbackVariableExpressionTypeAdapter";

const ELOQUENT_BUILDER_TYPE = "Illuminate\\Database\\Eloquent\\Builder";

export const phpLaravelQueryCallbackVariableExpressionTypeAdapter: PhpFrameworkQueryCallbackVariableExpressionTypeAdapter =
  {
    variableType: async ({
      position,
      resolveBuilderModelType,
      source,
      variableName,
    }) => {
      if (!variableName) {
        return null;
      }

      if (
        !phpLaravelQueryCallbackContextForVariable(
          source,
          position,
          variableName,
        )
      ) {
        return null;
      }

      const modelType = await resolveBuilderModelType();

      if (!modelType) {
        return null;
      }

      return ELOQUENT_BUILDER_TYPE;
    },
  };
