import type { PhpMethodDefinitionHint } from "../domain/phpNavigation";

export interface PhpFrameworkContextualMemberDefinitionNavigationAdapter {
  supportsBuilderModelNavigation(): boolean;
  requestMethodDefinitionHint(
    receiverType: string | null,
    methodName: string,
  ): PhpMethodDefinitionHint | null;
  localScopeMethodName(methodName: string): string | null;
  dynamicWhereTargetClassName(className: string | null): string | null;
  staticBuilderTargetClassName(methodName: string): string | null;
}

export const genericPhpFrameworkContextualMemberDefinitionNavigationAdapter: PhpFrameworkContextualMemberDefinitionNavigationAdapter =
  {
    supportsBuilderModelNavigation: () => false,
    requestMethodDefinitionHint: () => null,
    localScopeMethodName: () => null,
    dynamicWhereTargetClassName: () => null,
    staticBuilderTargetClassName: () => null,
  };
