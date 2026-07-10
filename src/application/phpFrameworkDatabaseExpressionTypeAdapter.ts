export interface PhpFrameworkDatabaseExpressionTypeAdapter {
  methodCallType(context: {
    methodName: string;
    resolveReceiverType: () => Promise<string | null>;
  }): Promise<string | null>;
  staticCallType(context: {
    className: string | null;
    methodName: string;
  }): string | null;
}

export const genericPhpFrameworkDatabaseExpressionTypeAdapter: PhpFrameworkDatabaseExpressionTypeAdapter =
  {
    methodCallType: async () => null,
    staticCallType: () => null,
  };
