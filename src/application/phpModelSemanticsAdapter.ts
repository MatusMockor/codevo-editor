import type { MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { WorkspaceDescriptor } from "../domain/workspace";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpModelSourceCandidate {
  className: string;
  path: string;
  source: string;
}

export interface PhpModelMorphMapEntry {
  alias: string;
  modelClassName: string;
}

export type PhpModelCarrierTypeResolver = (
  source: string,
  position: EditorPosition,
  expression: string,
  depth?: number,
) => Promise<string | null>;

export interface PhpModelSemanticsAdapter {
  resolveModelBuilderModelType: PhpModelCarrierTypeResolver;
  resolveModelCollectionModelType: PhpModelCarrierTypeResolver;
  resolveModelPropertyOrRelationType(
    className: string,
    propertyName: string,
    includeCollectionRelations?: boolean,
  ): Promise<string | null>;
  resolveModelRelationPathOwnerType(
    className: string,
    previousRelationNames?: readonly string[],
  ): Promise<string | null>;
}

export interface PhpModelSourceSemanticsAdapter {
  modelSourcesForTableName<Candidate extends PhpModelSourceCandidate>(
    tableName: string,
    candidates: readonly Candidate[],
  ): readonly Candidate[];
  morphMapEntriesFromSource(
    source: string,
  ): readonly PhpModelMorphMapEntry[];
}

export const emptyPhpModelSourceSemanticsAdapter: PhpModelSourceSemanticsAdapter =
  {
    modelSourcesForTableName: () => [],
    morphMapEntriesFromSource: () => [],
  };

export interface PhpModelSemanticsClassMemberReadResult {
  content: string;
  members: PhpMethodCompletion[];
}

export interface PhpModelSemanticsAdapterDependencies {
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
  ): Promise<PhpModelSemanticsClassMemberReadResult>;
  resolvePhpClassReference(source: string, className: string): string | null;
  resolvePhpClassSourcePaths(className: string): Promise<string[]>;
  resolvePhpDeclaredType(
    source: string,
    typeName: string | null,
  ): string | null;
  resolvePhpFrameworkProjectMorphMapModelType(): Promise<string | null>;
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
  resolvePhpMethodReturnType(
    className: string,
    methodName: string,
  ): Promise<string | null>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export type PhpModelSemanticsAdapterHook = (
  dependencies: PhpModelSemanticsAdapterDependencies,
) => PhpModelSemanticsAdapter;
