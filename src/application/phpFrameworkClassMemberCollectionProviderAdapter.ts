import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";

export interface PhpFrameworkClassMemberCollectionProviderAdapter {
  canCollectSyntheticMembers: boolean;
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
    canCollectSyntheticMembers: false,
    dynamicWhereMethods: () => [],
    relationCompletions: () => [],
  };
