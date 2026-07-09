export interface PhpDiagnosticEditorPosition {
  column: number;
  lineNumber: number;
}

export interface PhpDiagnosticStaticMethodStrategyContext {
  className: string | null;
  methodName: string;
}

export interface PhpDiagnosticMemberMethodStrategyContext {
  methodName: string;
  position: PhpDiagnosticEditorPosition;
  receiverExpression: string;
  source: string;
}

export interface PhpDiagnosticContextStrategy {
  ensureFrameworkSourceCollectionsLoaded(rootPath: string): void;
  memberMethodExists(
    context: PhpDiagnosticMemberMethodStrategyContext,
  ): Promise<boolean>;
  staticMethodExists(
    context: PhpDiagnosticStaticMethodStrategyContext,
  ): Promise<boolean>;
}

export const genericPhpDiagnosticContextStrategy: PhpDiagnosticContextStrategy = {
  ensureFrameworkSourceCollectionsLoaded: () => undefined,
  memberMethodExists: async () => false,
  staticMethodExists: async () => false,
};
