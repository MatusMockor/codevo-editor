export interface PhpFrameworkBuilderMagicExpressionTypeAdapter {
  methodCallType(context: {
    methodName: string;
    resolveBuilderModelType: () => Promise<string | null>;
    resolveReceiverModelTypeCandidate: () => Promise<string | null>;
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
