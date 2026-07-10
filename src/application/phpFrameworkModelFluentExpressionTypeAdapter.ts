export interface PhpFrameworkModelFluentExpressionTypeAdapter {
  receiverMethodCallType(context: {
    methodName: string;
    receiverType: string | null;
  }): string | null;
}

export const genericPhpFrameworkModelFluentExpressionTypeAdapter: PhpFrameworkModelFluentExpressionTypeAdapter =
  {
    receiverMethodCallType: () => null,
  };
