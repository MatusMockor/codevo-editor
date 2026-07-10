import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodDefinitionHint } from "../domain/phpNavigation";
import type { PhpIdentifierContext } from "../domain/phpNavigation";

type PhpLaravelRelationStringContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelRelationString" }
>;

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
  context: PhpLaravelRelationStringContext;
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
