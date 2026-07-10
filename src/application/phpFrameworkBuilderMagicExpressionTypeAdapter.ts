export interface PhpFrameworkBuilderMagicExpressionTypeAdapter {
  methodCallType(context: {
    methodName: string;
    resolveBuilderModelType: () => Promise<string | null>;
    resolveReceiverType: () => Promise<string | null>;
    source: string;
  }): Promise<string | null>;
  staticCallType(context: {
    className: string | null;
    methodName: string;
  }): Promise<string | null>;
}

export const genericPhpFrameworkBuilderMagicExpressionTypeAdapter: PhpFrameworkBuilderMagicExpressionTypeAdapter =
  {
    methodCallType: async () => null,
    staticCallType: async () => null,
  };
