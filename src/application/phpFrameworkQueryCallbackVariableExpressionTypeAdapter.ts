import type { EditorPosition } from "../domain/languageServerFeatures";

export interface PhpFrameworkQueryCallbackVariableExpressionTypeAdapter {
  variableType(context: {
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
