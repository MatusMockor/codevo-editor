import {
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  phpLaravelCollectionModelTypeCandidate,
  phpLaravelEloquentBuilderCollectionModelTypeFromExpression,
  phpLaravelEloquentBuilderModelTypeCandidate,
  phpLaravelEloquentBuilderModelTypeFromExpression,
  phpLaravelRepositoryConventionModelTypeFromCarrierReturnType,
} from "../domain/phpFrameworkLaravel";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { WorkspaceDescriptor } from "../domain/workspace";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { usePhpExpressionTypeResolver } from "./usePhpExpressionTypeResolver";
import { usePhpLaravelMethodGenericModelType } from "./usePhpLaravelMethodGenericModelType";
import { usePhpLaravelModelTypeResolvers } from "./usePhpLaravelModelTypeResolvers";
import { usePhpLaravelRelationResolver } from "./usePhpLaravelRelationResolver";
import { usePhpMethodReturnTypeResolver } from "./usePhpMethodReturnTypeResolver";

export interface PhpFrameworkModelSemantics {
  resolvePhpClassPropertyOrRelationType(
    className: string,
    propertyName: string,
    includeCollectionRelations?: boolean,
  ): Promise<string | null>;
  resolvePhpEloquentBuilderModelType(
    source: string,
    position: EditorPosition,
    expression: string,
    depth?: number,
  ): Promise<string | null>;
  resolvePhpExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
    depth?: number,
  ): Promise<string | null>;
  resolvePhpLaravelRelationPathOwnerType(
    className: string,
    previousRelationNames?: readonly string[],
  ): Promise<string | null>;
}

export interface PhpClassMemberReadResult {
  content: string;
  members: PhpMethodCompletion[];
}

export interface UsePhpFrameworkModelSemanticsOptions {
  activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  collectPhpMethodsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  phpClassHasDynamicBuilderFinder(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  phpClassHasNamedBuilderScope(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  readNavigationFileContent(path: string): Promise<string>;
  readPhpClassMembersFromPath(
    path: string,
    className: string,
  ): Promise<PhpClassMemberReadResult>;
  resolvePhpClassReference(source: string, className: string): string | null;
  resolvePhpClassSourcePaths(className: string): Promise<string[]>;
  resolvePhpDeclaredType(
    source: string,
    typeName: string | null,
  ): string | null;
  resolvePhpFrameworkBoundConcrete(
    className: string,
  ): Promise<string | null>;
  resolvePhpFrameworkProjectMorphMapModelType(): Promise<string | null>;
  resolvePhpFrameworkReturnTypeReference(
    source: string,
    typeName: string | null,
  ): string | null;
  resolvePhpGenericTemplateTypesForInheritedClass(
    source: string,
    inheritedClassName: string,
    inheritedTemplateTypes?: ReadonlyMap<string, string>,
  ): Promise<ReadonlyMap<string, string>>;
  resolvePhpGenericTemplateTypesForMixinClass(
    source: string,
    mixinClassName: string,
    inheritedTemplateTypes?: ReadonlyMap<string, string>,
  ): Promise<ReadonlyMap<string, string>>;
  resolvePhpMethodDeclaredReturnType(
    source: string,
    typeName: string | null,
    lateStaticClassName: string,
    templateTypes?: ReadonlyMap<string, string>,
  ): string | null;
  resolvePhpSemanticTypeReference(
    source: string,
    typeName: string | null,
  ): string | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function usePhpFrameworkModelSemantics({
  activePhpFrameworkProviders,
  collectPhpMethodsForClass,
  currentWorkspaceRootRef,
  frameworkRuntime,
  phpClassHasDynamicBuilderFinder,
  phpClassHasNamedBuilderScope,
  readNavigationFileContent,
  readPhpClassMembersFromPath,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  resolvePhpDeclaredType,
  resolvePhpFrameworkBoundConcrete,
  resolvePhpFrameworkProjectMorphMapModelType,
  resolvePhpFrameworkReturnTypeReference,
  resolvePhpGenericTemplateTypesForInheritedClass,
  resolvePhpGenericTemplateTypesForMixinClass,
  resolvePhpMethodDeclaredReturnType,
  resolvePhpSemanticTypeReference,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpFrameworkModelSemanticsOptions): PhpFrameworkModelSemantics {
  const resolvePhpEloquentBuilderModelTypeRef = useRef(
    async (
      _source: string,
      _position: EditorPosition,
      _expression: string,
    ): Promise<string | null> => null,
  );
  const { resolvePhpMethodReturnType } = usePhpMethodReturnTypeResolver({
    activePhpFrameworkProviders,
    currentWorkspaceRootRef,
    frameworkRuntime,
    readPhpClassMembersFromPath,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpEloquentBuilderModelTypeRef,
    resolvePhpFrameworkBoundConcrete,
    resolvePhpFrameworkReturnTypeReference,
    resolvePhpGenericTemplateTypesForInheritedClass,
    resolvePhpGenericTemplateTypesForMixinClass,
    resolvePhpLaravelProjectMorphMapModelType:
      resolvePhpFrameworkProjectMorphMapModelType,
    resolvePhpMethodDeclaredReturnType,
    workspaceDescriptor,
    workspaceRoot,
  });

  const phpFrameworkGenericModelTypeHelpers = useMemo(
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
      helpers: phpFrameworkGenericModelTypeHelpers,
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
    resolvePhpLaravelProjectMorphMapModelType:
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

  useEffect(() => {
    resolvePhpEloquentBuilderModelTypeRef.current =
      resolvePhpEloquentBuilderModelType;
  }, [resolvePhpEloquentBuilderModelType]);

  const { resolvePhpExpressionType } = usePhpExpressionTypeResolver({
    activePhpFrameworkProviders,
    collectPhpMethodsForClass,
    frameworkRuntime,
    phpClassHasDynamicBuilderFinder,
    phpClassHasNamedBuilderScope,
    resolvePhpClassPropertyOrRelationType,
    resolvePhpClassReference,
    resolvePhpBuilderModelType: resolvePhpEloquentBuilderModelType,
    resolvePhpFrameworkBoundConcrete,
    resolvePhpFrameworkReturnTypeReference,
    resolvePhpCollectionModelType: resolvePhpLaravelCollectionModelType,
    resolvePhpMethodReturnType,
    resolvePhpSemanticTypeReference,
  });

  return {
    resolvePhpClassPropertyOrRelationType,
    resolvePhpEloquentBuilderModelType,
    resolvePhpExpressionType,
    resolvePhpLaravelRelationPathOwnerType,
  };
}
