import { phpFrameworkQueryCallbackContextForVariable } from "../domain/phpFrameworkProviders";
import type { PhpFrameworkQueryCallbackVariableExpressionTypeAdapter } from "./phpFrameworkQueryCallbackVariableExpressionTypeAdapter";

const ELOQUENT_BUILDER_TYPE = "Illuminate\\Database\\Eloquent\\Builder";

export const phpLaravelQueryCallbackVariableExpressionTypeAdapter: PhpFrameworkQueryCallbackVariableExpressionTypeAdapter =
  {
    variableType: async ({
      frameworkProviders,
      position,
      resolveBuilderModelType,
      source,
      variableName,
    }) => {
      if (!variableName) {
        return null;
      }

      if (
        !phpFrameworkQueryCallbackContextForVariable(
          source,
          position,
          variableName,
          frameworkProviders,
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
