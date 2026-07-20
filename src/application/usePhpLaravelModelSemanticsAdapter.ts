import { useMemo } from "react";
import {
  phpLaravelCollectionModelTypeCandidate,
  phpLaravelEloquentBuilderCollectionModelTypeFromExpression,
  phpLaravelEloquentBuilderModelTypeCandidate,
  phpLaravelEloquentBuilderModelTypeFromExpression,
  phpLaravelRepositoryConventionModelTypeFromCarrierReturnType,
} from "../domain/phpFrameworkLaravel";
import type {
  PhpModelSemanticsAdapter,
  PhpModelSemanticsAdapterDependencies,
} from "./phpModelSemanticsAdapter";
import { usePhpLaravelMethodGenericModelType } from "./usePhpLaravelMethodGenericModelType";
import { usePhpLaravelModelTypeResolvers } from "./usePhpLaravelModelTypeResolvers";
import { usePhpLaravelRelationResolver } from "./usePhpLaravelRelationResolver";

export function usePhpLaravelModelSemanticsAdapter({
  currentWorkspaceRootRef,
  frameworkRuntime,
  phpClassHasDynamicBuilderFinder,
  phpClassHasNamedBuilderScope,
  readNavigationFileContent,
  readPhpClassMembersFromPath,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  resolvePhpDeclaredType,
  resolvePhpFrameworkProjectMorphMapModelType,
  resolvePhpGenericTemplateTypesForInheritedClass,
  resolvePhpGenericTemplateTypesForMixinClass,
  resolvePhpMethodReturnType,
  workspaceDescriptor,
  workspaceRoot,
}: PhpModelSemanticsAdapterDependencies): PhpModelSemanticsAdapter {
  const phpLaravelGenericModelTypeHelpers = useMemo(
    () => ({
      builderCollectionModelTypeFromExpression:
        phpLaravelEloquentBuilderCollectionModelTypeFromExpression,
      builderModelTypeCandidate: phpLaravelEloquentBuilderModelTypeCandidate,
      builderModelTypeFromExpression:
        phpLaravelEloquentBuilderModelTypeFromExpression,
      collectionModelTypeCandidate: phpLaravelCollectionModelTypeCandidate,
      repositoryConventionModelTypeFromCarrierReturnType:
        phpLaravelRepositoryConventionModelTypeFromCarrierReturnType,
    }),
    [],
  );

  const { resolvePhpLaravelMethodGenericModelType } =
    usePhpLaravelMethodGenericModelType({
      currentWorkspaceRootRef,
      frameworkRuntime,
      helpers: phpLaravelGenericModelTypeHelpers,
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    });

  const {
    resolvePhpClassPropertyOrRelationType,
    resolvePhpLaravelRelationPathOwnerType,
  } = usePhpLaravelRelationResolver({
    currentWorkspaceRootRef,
    frameworkRuntime,
    readPhpClassMembersFromPath,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpDeclaredType,
    resolvePhpGenericTemplateTypesForInheritedClass,
    resolvePhpGenericTemplateTypesForMixinClass,
    resolvePhpFrameworkProjectMorphMapModelType,
    workspaceDescriptor,
    workspaceRoot,
  });

  const {
    resolvePhpEloquentBuilderModelType,
    resolvePhpLaravelCollectionModelType,
  } = usePhpLaravelModelTypeResolvers({
    currentWorkspaceRootRef,
    frameworkRuntime,
    phpClassHasLaravelDynamicWhere: phpClassHasDynamicBuilderFinder,
    phpClassHasLaravelLocalScope: phpClassHasNamedBuilderScope,
    readNavigationFileContent,
    resolvePhpClassPropertyOrRelationType,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpLaravelMethodGenericModelType,
    resolvePhpLaravelRelationPathOwnerType,
    resolvePhpMethodReturnType,
    workspaceDescriptor,
    workspaceRoot,
  });

  return useMemo(
    () => ({
      resolveModelBuilderModelType: resolvePhpEloquentBuilderModelType,
      resolveModelCollectionModelType: resolvePhpLaravelCollectionModelType,
      resolveModelPropertyOrRelationType: resolvePhpClassPropertyOrRelationType,
      resolveModelRelationPathOwnerType: resolvePhpLaravelRelationPathOwnerType,
    }),
    [
      resolvePhpClassPropertyOrRelationType,
      resolvePhpEloquentBuilderModelType,
      resolvePhpLaravelCollectionModelType,
      resolvePhpLaravelRelationPathOwnerType,
    ],
  );
}
