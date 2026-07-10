import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";

export interface PhpFrameworkClassMemberCollectionProviderAdapter {
  canCollectLaravelMembers: boolean;
  dynamicWhereMethods(
    context: PhpDynamicWhereMemberCollectionContext,
  ): PhpMethodCompletion[];
  relationCompletions(
    context: PhpRelationMemberCollectionContext,
  ): PhpMethodCompletion[];
}

export interface PhpDynamicWhereMemberCollectionContext {
  className: string;
  options: { isStatic?: boolean };
  source: string;
}

export interface PhpRelationMemberCollectionContext {
  className: string;
  source: string;
}

export const genericPhpFrameworkClassMemberCollectionProviderAdapter: PhpFrameworkClassMemberCollectionProviderAdapter =
  {
    canCollectLaravelMembers: false,
    dynamicWhereMethods: () => [],
    relationCompletions: () => [],
  };
