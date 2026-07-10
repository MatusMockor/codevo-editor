export interface PhpFrameworkModelBuilderTransitionExpressionTypeAdapter {
  methodCallType(context: {
    methodName: string;
    resolveCollectionTerminalModelType: () => Promise<string | null>;
    resolveModelFactoryModelType: () => Promise<string | null>;
    resolveBuilderTerminalModelType: () => Promise<string | null>;
    resolveBuilderModelType: () => Promise<string | null>;
    resolveCollectionModelType: () => Promise<string | null>;
  }): Promise<string | null>;
  staticCallType(context: {
    className: string | null;
    methodName: string;
  }): Promise<string | null>;
}

export const genericPhpFrameworkModelBuilderTransitionExpressionTypeAdapter: PhpFrameworkModelBuilderTransitionExpressionTypeAdapter =
  {
    methodCallType: async () => null,
    staticCallType: async () => null,
  };
