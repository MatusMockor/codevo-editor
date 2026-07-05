import { useCallback, type MutableRefObject } from "react";
import {
  phpMixinClassNames,
  phpTraitClassNames,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import {
  phpExtendsClassName,
  phpSuperTypeReferences,
  resolvePhpClassName,
} from "../domain/phpNavigation";
import { phpCurrentClassName } from "../domain/phpSemanticEngine";
import {
  phpDeclaredGenericTypeCandidates,
  phpDeclaredTypeCandidate,
  phpMethodReturnExpressions,
} from "../domain/phpTypeAnalysis";
import { firstPhpDocTypeToken } from "../domain/phpDocTemplates";
import { phpLaravelRelationTargetClassNameFromExpression } from "../domain/phpFrameworkLaravel";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface PhpClassMemberReadResult {
  content: string;
  members: PhpMethodCompletion[];
}

export interface UsePhpLaravelRelationResolverOptions {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  isLaravelFrameworkActive: boolean;
  readPhpClassMembersFromPath: (
    path: string,
    className: string,
  ) => Promise<PhpClassMemberReadResult>;
  resolvePhpClassReference: (source: string, className: string) => string | null;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  resolvePhpDeclaredType: (
    source: string,
    typeName: string | null,
  ) => string | null;
  resolvePhpGenericTemplateTypesForInheritedClass: (
    source: string,
    inheritedClassName: string,
    inheritedTemplateTypes?: ReadonlyMap<string, string>,
  ) => Promise<ReadonlyMap<string, string>>;
  resolvePhpGenericTemplateTypesForMixinClass: (
    source: string,
    mixinClassName: string,
    inheritedTemplateTypes?: ReadonlyMap<string, string>,
  ) => Promise<ReadonlyMap<string, string>>;
  resolvePhpLaravelProjectMorphMapModelType: () => Promise<string | null>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function usePhpLaravelRelationResolver({
  currentWorkspaceRootRef,
  isLaravelFrameworkActive,
  readPhpClassMembersFromPath,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  resolvePhpDeclaredType,
  resolvePhpGenericTemplateTypesForInheritedClass,
  resolvePhpGenericTemplateTypesForMixinClass,
  resolvePhpLaravelProjectMorphMapModelType,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpLaravelRelationResolverOptions) {
  const resolvePhpClassPropertyOrRelationType = useCallback(
    async (
      className: string,
      propertyName: string,
      includeCollectionRelations = false,
      visitedClassNames = new Set<string>(),
      templateTypes: ReadonlyMap<string, string> = new Map(),
    ): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return null;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const visitedKey = normalizedClassName.toLowerCase();

      if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
        return null;
      }

      visitedClassNames.add(visitedKey);

      if (!isRequestedRootActive()) {
        return null;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return null;
        }

        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return null;
          }

          const matchingMembers = members.filter(
            (candidate) =>
              candidate.name.toLowerCase() === propertyName.toLowerCase(),
          );
          const relationMethod =
            matchingMembers.find((candidate) => candidate.kind !== "property") ??
            null;
          const propertyMember =
            matchingMembers.find(
              (candidate) => candidate.kind === "property" && candidate.returnType,
            ) ?? null;
          const resolvedPropertyMember = propertyMember
            ? phpMethodCompletionWithTemplateReturnType(
                propertyMember,
                templateTypes,
              )
            : null;
          const collectionPropertyModelType =
            resolvedPropertyMember && includeCollectionRelations
              ? phpCollectionGenericModelTypeCandidate(
                  resolvedPropertyMember.returnType,
                )
              : null;
          const resolvedCollectionPropertyModelType = collectionPropertyModelType
            ? resolvePhpClassReference(content, collectionPropertyModelType)
            : null;

          const relationType = relationMethod?.returnType
            ? resolvePhpLaravelRelationModelType(
                content,
                relationMethod.returnType,
                includeCollectionRelations,
              )
            : null;

          if (relationType) {
            return relationType;
          }

          if (resolvedCollectionPropertyModelType) {
            return resolvedCollectionPropertyModelType;
          }

          const propertyReturnType = resolvedPropertyMember?.returnType ?? null;
          const propertyTypeCandidate = propertyReturnType
            ? phpDeclaredTypeCandidate(propertyReturnType)
            : null;
          const propertyType = propertyTypeCandidate?.includes("\\")
            ? propertyTypeCandidate
            : propertyReturnType
              ? resolvePhpDeclaredType(content, propertyReturnType)
              : null;

          if (propertyType) {
            return propertyType;
          }

          if (relationMethod) {
            let hasMorphToReturnExpression = false;

            for (const expression of phpMethodReturnExpressions(
              content,
              relationMethod.name,
            )) {
              if (isLaravelMorphToFactoryExpression(expression)) {
                hasMorphToReturnExpression = true;
              }

              const relationTargetClassName =
                phpLaravelRelationTargetClassNameFromExpression(
                  expression,
                  includeCollectionRelations,
                );
              const resolvedRelationTargetClassName = relationTargetClassName
                ? resolvePhpRelationTargetClassReference(
                    content,
                    relationTargetClassName,
                  )
                : null;

              if (resolvedRelationTargetClassName) {
                return resolvedRelationTargetClassName;
              }
            }

            if (hasMorphToReturnExpression && isLaravelFrameworkActive) {
              const morphMapModelType =
                await resolvePhpLaravelProjectMorphMapModelType();

              if (!isRequestedRootActive()) {
                return null;
              }

              if (morphMapModelType) {
                return morphMapModelType;
              }
            }
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(content, traitName);
            const traitTemplateTypes = resolvedTraitName
              ? await resolvePhpGenericTemplateTypesForInheritedClass(
                  content,
                  resolvedTraitName,
                  templateTypes,
                )
              : new Map<string, string>();
            const traitType = resolvedTraitName
              ? await resolvePhpClassPropertyOrRelationType(
                  resolvedTraitName,
                  propertyName,
                  includeCollectionRelations,
                  visitedClassNames,
                  traitTemplateTypes,
                )
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (traitType) {
              return traitType;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(content, mixinName);
            const mixinTemplateTypes = resolvedMixinName
              ? await resolvePhpGenericTemplateTypesForMixinClass(
                  content,
                  resolvedMixinName,
                  templateTypes,
                )
              : new Map<string, string>();
            const mixinType = resolvedMixinName
              ? await resolvePhpClassPropertyOrRelationType(
                  resolvedMixinName,
                  propertyName,
                  includeCollectionRelations,
                  visitedClassNames,
                  mixinTemplateTypes,
                )
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (mixinType) {
              return mixinType;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );
            const superTypeTemplateTypes = resolvedSuperTypeName
              ? await resolvePhpGenericTemplateTypesForInheritedClass(
                  content,
                  resolvedSuperTypeName,
                  templateTypes,
                )
              : new Map<string, string>();
            const superTypePropertyType = resolvedSuperTypeName
              ? await resolvePhpClassPropertyOrRelationType(
                  resolvedSuperTypeName,
                  propertyName,
                  includeCollectionRelations,
                  visitedClassNames,
                  superTypeTemplateTypes,
                )
              : null;

            if (!isRequestedRootActive()) {
              return null;
            }

            if (superTypePropertyType) {
              return superTypePropertyType;
            }
          }

          return null;
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }

          continue;
        }
      }

      if (!isRequestedRootActive()) {
        return null;
      }

      return null;
    },
    [
      currentWorkspaceRootRef,
      isLaravelFrameworkActive,
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      resolvePhpDeclaredType,
      resolvePhpGenericTemplateTypesForInheritedClass,
      resolvePhpGenericTemplateTypesForMixinClass,
      resolvePhpLaravelProjectMorphMapModelType,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const resolvePhpLaravelRelationPathOwnerType = useCallback(
    async (
      className: string,
      previousRelationNames: readonly string[] = [],
    ): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!isLaravelFrameworkActive || !requestedRoot) {
        return null;
      }

      let ownerType: string | null = className;

      for (const relationName of previousRelationNames) {
        if (!isRequestedRootActive()) {
          return null;
        }

        ownerType = ownerType
          ? await resolvePhpClassPropertyOrRelationType(
              ownerType,
              relationName,
              true,
            )
          : null;

        if (!isRequestedRootActive()) {
          return null;
        }

        if (!ownerType) {
          return null;
        }
      }

      return ownerType;
    },
    [
      currentWorkspaceRootRef,
      isLaravelFrameworkActive,
      resolvePhpClassPropertyOrRelationType,
      workspaceRoot,
    ],
  );

  return {
    resolvePhpClassPropertyOrRelationType,
    resolvePhpLaravelRelationPathOwnerType,
  };
}

export function isLaravelMorphToFactoryExpression(expression: string): boolean {
  return /\$(?:this|[A-Za-z_][A-Za-z0-9_]*)\??->morphTo\s*\(/i.test(
    expression,
  );
}

export function phpMethodCompletionWithTemplateReturnType(
  method: PhpMethodCompletion,
  templateTypes: ReadonlyMap<string, string>,
): PhpMethodCompletion {
  if (!method.returnType || templateTypes.size === 0) {
    return method;
  }

  let returnType = method.returnType;

  for (const [templateName, resolvedType] of templateTypes) {
    returnType = returnType.replace(
      new RegExp(
        `(^|[^A-Za-z0-9_\\\\])${escapeRegExp(templateName)}(?![A-Za-z0-9_])`,
        "gi",
      ),
      `$1${resolvedType}`,
    );
  }

  return returnType === method.returnType ? method : { ...method, returnType };
}

function resolvePhpLaravelRelationModelType(
  source: string,
  returnType: string,
  includeCollectionRelations: boolean,
): string | null {
  if (!isLaravelEloquentRelationType(returnType, includeCollectionRelations)) {
    return null;
  }

  const relatedModelType = phpDeclaredGenericTypeCandidates(returnType).find(
    (candidate) => !isGenericPhpPlaceholder(candidate),
  );

  return relatedModelType ? resolvePhpClassName(source, relatedModelType) : null;
}

function resolvePhpRelationTargetClassReference(
  source: string,
  className: string,
): string | null {
  const normalizedClassName = className.trim().replace(/^\\+/, "").toLowerCase();

  if (
    normalizedClassName === "__class__" ||
    normalizedClassName === "self" ||
    normalizedClassName === "static" ||
    normalizedClassName === "$this"
  ) {
    return phpCurrentClassName(source);
  }

  if (normalizedClassName === "parent") {
    const parentClassName = phpExtendsClassName(source);

    return parentClassName ? resolvePhpClassName(source, parentClassName) : null;
  }

  return resolvePhpClassName(source, className);
}

export function phpCollectionGenericModelTypeCandidate(
  typeName: string | null,
): string | null {
  if (!typeName) {
    return null;
  }

  const arrayItemType = phpCollectionArrayModelTypeCandidate(typeName);

  if (arrayItemType) {
    return arrayItemType;
  }

  if (!/\bCollection\s*</i.test(typeName)) {
    return null;
  }

  return (
    phpDeclaredGenericTypeCandidates(typeName).find(
      (candidate) => !isGenericPhpPlaceholder(candidate),
    ) ?? null
  );
}

function phpCollectionArrayModelTypeCandidate(typeName: string): string | null {
  if (!/\bCollection\b/i.test(typeName)) {
    return null;
  }

  for (const segment of typeName.split(/[|&]/)) {
    const match =
      /^(\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\[\]$/.exec(
        segment.trim(),
      );
    const candidate = match?.[1] ?? null;

    if (candidate && !isGenericPhpPlaceholder(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function phpClassDocGenericCollectionModelTypeCandidate(
  source: string,
): string | null {
  for (const match of source.matchAll(
    /@(?:(?:phpstan|psalm|template)-)?(?:extends|implements)\s+([^\r\n*]+)/g,
  )) {
    const typeName = firstPhpDocTypeToken(match[1] ?? null);
    const candidate = phpCollectionGenericModelTypeCandidate(typeName);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function isLaravelEloquentRelationType(
  typeName: string,
  includeCollectionRelations: boolean,
): boolean {
  const normalizedTypeName = typeName
    .trim()
    .replace(/^\?/, "")
    .replace(/^\\+/, "")
    .split("<")[0]
    ?.toLowerCase();

  if (!normalizedTypeName) {
    return false;
  }

  if (
    normalizedTypeName.startsWith(
      "illuminate\\database\\eloquent\\relations\\",
    )
  ) {
    const shortTypeName = shortPhpName(normalizedTypeName);
    return includeCollectionRelations
      ? laravelEloquentRelationTypes.has(shortTypeName)
      : laravelEloquentSingularRelationTypes.has(shortTypeName);
  }

  return includeCollectionRelations
    ? laravelEloquentRelationTypes.has(normalizedTypeName)
    : laravelEloquentSingularRelationTypes.has(normalizedTypeName);
}

function isGenericPhpPlaceholder(typeName: string): boolean {
  const normalized = typeName.trim().replace(/^\\+/, "").toLowerCase();

  return (
    normalized === "self" ||
    normalized === "static" ||
    normalized === "$this" ||
    normalized === "illuminate\\database\\eloquent\\model" ||
    normalized === "model" ||
    /^t[A-Z_]/.test(typeName)
  );
}

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const laravelEloquentRelationTypes = new Set([
  "belongsto",
  "belongstomany",
  "hasmany",
  "hasmanythrough",
  "hasone",
  "hasonethrough",
  "morphmany",
  "morphone",
  "morphedbymany",
  "morphto",
  "morphtomany",
]);

const laravelEloquentSingularRelationTypes = new Set([
  "belongsto",
  "hasone",
  "hasonethrough",
  "morphone",
  "morphto",
]);
