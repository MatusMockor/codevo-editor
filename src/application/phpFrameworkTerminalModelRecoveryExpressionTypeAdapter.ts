interface PhpTerminalModelRecoveryContext {
  receiverExpression: string;
  resolveExpressionType: (expression: string) => Promise<string | null>;
}

export interface PhpFrameworkTerminalModelRecoveryExpressionTypeAdapter {
  collectionTerminalModelType(
    context: PhpTerminalModelRecoveryContext & {
      resolveCollectionModelType: () => Promise<string | null>;
    },
  ): Promise<string | null>;
  builderTerminalModelType(
    context: PhpTerminalModelRecoveryContext & {
      resolveBuilderModelType: () => Promise<string | null>;
    },
  ): Promise<string | null>;
}

export const genericPhpFrameworkTerminalModelRecoveryExpressionTypeAdapter: PhpFrameworkTerminalModelRecoveryExpressionTypeAdapter =
  {
    collectionTerminalModelType: async () => null,
    builderTerminalModelType: async () => null,
  };
