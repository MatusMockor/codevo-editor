import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodDefinitionHint } from "../domain/phpNavigation";

export interface PhpFrameworkRelationStringContext {
  className: string | null;
  kind: string;
  methodName: string;
  previousRelationNames?: string[];
  receiverExpression: string | null;
  relationName: string;
}

export interface PhpContextualMemberDefinitionNavigationResult {
  failureMessage?: string;
  opened: boolean;
}

export interface PhpDynamicWhereDefinitionNavigationContext {
  className: string | null;
  isRequestStillCurrent: () => boolean;
  methodName: string;
}

export interface PhpRelationStringDefinitionNavigationContext {
  context: PhpFrameworkRelationStringContext;
  isRequestStillCurrent: () => boolean;
  position: EditorPosition;
  source: string;
}

export interface PhpFrameworkContextualMemberDefinitionNavigationAdapter {
  dynamicWhereDefinition(
    context: PhpDynamicWhereDefinitionNavigationContext,
  ): Promise<PhpContextualMemberDefinitionNavigationResult>;
  relationStringDefinition(
    context: PhpRelationStringDefinitionNavigationContext,
  ): Promise<PhpContextualMemberDefinitionNavigationResult>;
  supportsBuilderModelNavigation(): boolean;
  requestMethodDefinitionHint(
    receiverType: string | null,
    methodName: string,
  ): PhpMethodDefinitionHint | null;
  localScopeMethodName(methodName: string): string | null;
  staticBuilderTargetClassName(methodName: string): string | null;
}

export const genericPhpFrameworkContextualMemberDefinitionNavigationAdapter: PhpFrameworkContextualMemberDefinitionNavigationAdapter =
  {
    dynamicWhereDefinition: async () => ({ opened: false }),
    relationStringDefinition: async () => ({ opened: false }),
    supportsBuilderModelNavigation: () => false,
    requestMethodDefinitionHint: () => null,
    localScopeMethodName: () => null,
    staticBuilderTargetClassName: () => null,
  };
