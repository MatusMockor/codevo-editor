import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";

export interface PhpFrameworkQueryCallbackVariableExpressionTypeAdapter {
  variableType(context: {
    frameworkProviders: readonly PhpFrameworkProvider[];
    position: EditorPosition;
    resolveBuilderModelType: () => Promise<string | null>;
    source: string;
    variableName: string | null;
  }): Promise<string | null>;
}

export const genericPhpFrameworkQueryCallbackVariableExpressionTypeAdapter: PhpFrameworkQueryCallbackVariableExpressionTypeAdapter =
  {
    variableType: async () => null,
  };
