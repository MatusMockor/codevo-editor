import type { EditorPosition } from "../domain/languageServerFeatures";

export interface PhpFrameworkCollectionCallbackVariableExpressionTypeAdapter {
  variableType(context: {
    position: EditorPosition;
    resolveCollectionElementType: (
      receiverExpression: string,
    ) => Promise<string | null>;
    source: string;
    variableName: string | null;
  }): Promise<string | null>;
}

export const genericPhpFrameworkCollectionCallbackVariableExpressionTypeAdapter: PhpFrameworkCollectionCallbackVariableExpressionTypeAdapter =
  {
    variableType: async () => null,
  };
