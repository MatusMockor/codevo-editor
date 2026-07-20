import { useEffect, useRef, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { WorkspaceDescriptor } from "../domain/workspace";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpModelSemanticsAdapterHook } from "./phpModelSemanticsAdapter";
import { usePhpExpressionTypeResolver } from "./usePhpExpressionTypeResolver";
import { usePhpMethodReturnTypeResolver } from "./usePhpMethodReturnTypeResolver";

export interface PhpFrameworkModelSemantics {
  resolvePhpClassPropertyOrRelationType(
    className: string,
    propertyName: string,
    includeCollectionRelations?: boolean,
  ): Promise<string | null>;
  resolvePhpFrameworkBuilderModelType(
    source: string,
    position: EditorPosition,
    expression: string,
    depth?: number,
  ): Promise<string | null>;
  resolvePhpFrameworkCollectionModelType(
    source: string,
    position: EditorPosition,
    expression: string,
    depth?: number,
  ): Promise<string | null>;
  resolvePhpFrameworkRelationPathOwnerType(
    className: string,
    previousRelationNames?: readonly string[],
  ): Promise<string | null>;
  resolvePhpExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
    depth?: number,
  ): Promise<string | null>;
}

export interface PhpClassMemberReadResult {
  content: string;
  members: PhpMethodCompletion[];
}

export interface UsePhpFrameworkModelSemanticsOptions {
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
  useModelSemanticsAdapter: PhpModelSemanticsAdapterHook;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function usePhpFrameworkModelSemantics({
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
  useModelSemanticsAdapter,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpFrameworkModelSemanticsOptions): PhpFrameworkModelSemantics {
  const resolvePhpFrameworkBuilderModelTypeRef = useRef(
    async (
      _source: string,
      _position: EditorPosition,
      _expression: string,
    ): Promise<string | null> => null,
  );
  const { resolvePhpMethodReturnType } = usePhpMethodReturnTypeResolver({
    currentWorkspaceRootRef,
    frameworkRuntime,
    readPhpClassMembersFromPath,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpEloquentBuilderModelTypeRef:
      resolvePhpFrameworkBuilderModelTypeRef,
    resolvePhpFrameworkBoundConcrete,
    resolvePhpFrameworkReturnTypeReference,
    resolvePhpGenericTemplateTypesForInheritedClass,
    resolvePhpGenericTemplateTypesForMixinClass,
    resolvePhpFrameworkProjectMorphMapModelType,
    resolvePhpMethodDeclaredReturnType,
    workspaceDescriptor,
    workspaceRoot,
  });

  const {
    resolveModelBuilderModelType,
    resolveModelCollectionModelType,
    resolveModelPropertyOrRelationType,
    resolveModelRelationPathOwnerType,
  } = useModelSemanticsAdapter({
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
  });

  useEffect(() => {
    resolvePhpFrameworkBuilderModelTypeRef.current =
      resolveModelBuilderModelType;
  }, [resolveModelBuilderModelType]);

  const { resolvePhpExpressionType } = usePhpExpressionTypeResolver({
    collectPhpMethodsForClass,
    frameworkRuntime,
    phpClassHasDynamicBuilderFinder,
    phpClassHasNamedBuilderScope,
    resolvePhpClassPropertyOrRelationType: resolveModelPropertyOrRelationType,
    resolvePhpClassReference,
    resolvePhpBuilderModelType: resolveModelBuilderModelType,
    resolvePhpFrameworkBoundConcrete,
    resolvePhpFrameworkReturnTypeReference,
    resolvePhpCollectionModelType: resolveModelCollectionModelType,
    resolvePhpMethodReturnType,
    resolvePhpSemanticTypeReference,
  });

  return {
    resolvePhpClassPropertyOrRelationType: resolveModelPropertyOrRelationType,
    resolvePhpFrameworkBuilderModelType: resolveModelBuilderModelType,
    resolvePhpFrameworkCollectionModelType: resolveModelCollectionModelType,
    resolvePhpFrameworkRelationPathOwnerType: resolveModelRelationPathOwnerType,
    resolvePhpExpressionType,
  };
}
