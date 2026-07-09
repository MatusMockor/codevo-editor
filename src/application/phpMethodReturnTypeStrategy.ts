export interface PhpMethodReturnTypeStrategy {
  declaredReturnTypeOverride(
    context: PhpDeclaredReturnTypeStrategyContext,
  ): Promise<string | null>;
  facadeTargetClassName(className: string): string | null;
  methodCallReturnType(
    context: PhpMethodCallReturnTypeStrategyContext,
  ): Promise<string | null>;
  staticCallReturnType(
    context: PhpStaticCallReturnTypeStrategyContext,
  ): string | null;
}

export interface PhpDeclaredReturnTypeStrategyContext {
  methodReturnExpressions: readonly string[];
  returnType: string;
}

export interface PhpMethodCallReturnTypeStrategyContext {
  methodName: string;
  ownerSource: string;
  receiverExpression: string;
  receiverType: string | null;
}

export interface PhpStaticCallReturnTypeStrategyContext {
  className: string | null;
  methodName: string;
}

export const genericPhpMethodReturnTypeStrategy: PhpMethodReturnTypeStrategy = {
  async declaredReturnTypeOverride() {
    return null;
  },
  facadeTargetClassName() {
    return null;
  },
  async methodCallReturnType() {
    return null;
  },
  staticCallReturnType() {
    return null;
  },
};
