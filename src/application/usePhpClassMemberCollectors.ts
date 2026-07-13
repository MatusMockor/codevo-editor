import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  phpMixinClassNames,
  phpMethodCompletionsFromSource,
  phpTraitClassNames,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import {
  phpDocGenericInheritances,
  phpDocGenericMixins,
  phpDocTemplateNames,
} from "../domain/phpSemanticEngine";
import {
  phpExtendsClassName,
  phpSuperTypeReferences,
  resolvePhpClassName,
} from "../domain/phpNavigation";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  phpMethodCompletionWithTemplateReturnType,
} from "./usePhpLaravelRelationResolver";
import type { PhpFrameworkSourceRegistryContext } from "./usePhpFrameworkSourceRegistries";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  createPhpFrameworkClassMemberCollectionProviderAdapters,
} from "./phpFrameworkClassMemberCollectionProviderAdapters";

export interface PhpClassMemberReadResult {
  content: string;
  members: PhpMethodCompletion[];
}

interface PhpClassMemberCacheEntry {
  members: PhpMethodCompletion[];
  sourceSignature: string;
}

export interface UsePhpClassMemberCollectorsOptions {
  activePhpFrameworkProviderSignature: string;
  activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  currentPhpFrameworkSourceContext: () => PhpFrameworkSourceRegistryContext;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  isLaravelFrameworkActive?: boolean;
  readNavigationFileContent: (path: string) => Promise<string>;
  resolvePhpClassReference: (source: string, className: string) => string | null;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  resolvePhpDeclaredType: (source: string, typeName: string | null) => string | null;
  resolvePhpFrameworkBoundConcrete: (
    className: string,
  ) => Promise<string | null>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpClassMemberCollectors {
  collectPhpLaravelDynamicWhereMethodsForClass: (
    className: string,
    options?: { isStatic?: boolean },
  ) => Promise<PhpMethodCompletion[]>;
  collectPhpLaravelRelationCompletionsForClass: (
    className: string,
  ) => Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass: (
    className: string,
  ) => Promise<PhpMethodCompletion[]>;
  readPhpClassMembersFromPath: (
    path: string,
    className: string,
  ) => Promise<PhpClassMemberReadResult>;
  resetPhpClassMemberCache: () => void;
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
}

export function usePhpClassMemberCollectors({
  activePhpFrameworkProviderSignature,
  activePhpFrameworkProviders,
  currentPhpFrameworkSourceContext,
  currentWorkspaceRootRef,
  frameworkRuntime,
  isLaravelFrameworkActive: legacyIsLaravelFrameworkActive = false,
  readNavigationFileContent,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  resolvePhpDeclaredType,
  resolvePhpFrameworkBoundConcrete,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpClassMemberCollectorsOptions): PhpClassMemberCollectors {
  const phpClassMemberCacheRef = useRef<Record<string, PhpClassMemberCacheEntry>>(
    {},
  );
  const frameworkProviders =
    frameworkRuntime?.providers ?? activePhpFrameworkProviders;
  const frameworkProviderSignature = frameworkRuntime
    ? phpFrameworkRuntimeProviderSignature(frameworkRuntime)
    : activePhpFrameworkProviderSignature;
  const memberCollectionStrategy = useMemo(
    () =>
      createPhpFrameworkClassMemberCollectionProviderAdapters({
        frameworkRuntime,
        isLaravelFrameworkActive: legacyIsLaravelFrameworkActive,
        resolvePhpDeclaredType,
      }),
    [frameworkRuntime, legacyIsLaravelFrameworkActive, resolvePhpDeclaredType],
  );

  const resetPhpClassMemberCache = useCallback((): void => {
    phpClassMemberCacheRef.current = {};
  }, []);

  const resolvePhpTemplateTypesForGenericReferences = useCallback(
    async (
      source: string,
      targetClassName: string,
      genericReferences: ReturnType<typeof phpDocGenericInheritances>,
      inheritedTemplateTypes: ReadonlyMap<string, string> = new Map(),
    ): Promise<ReadonlyMap<string, string>> => {
      const normalizedTargetClassName = targetClassName
        .trim()
        .replace(/^\\+/, "")
        .toLowerCase();

      if (!normalizedTargetClassName) {
        return new Map();
      }

      for (const genericReference of genericReferences) {
        const resolvedTargetClassName = resolvePhpClassReference(
          source,
          genericReference.className,
        );

        if (
          resolvedTargetClassName?.toLowerCase() !==
          normalizedTargetClassName
        ) {
          continue;
        }

        for (const path of await resolvePhpClassSourcePaths(
          resolvedTargetClassName,
        )) {
          try {
            const targetSource = await readNavigationFileContent(path);
            const templateNames = phpDocTemplateNames(targetSource);
            const templateTypes = new Map<string, string>();

            templateNames.forEach((templateName, index) => {
              const genericType = genericReference.genericTypes[index];
              const inheritedGenericType = genericType
                ? inheritedTemplateTypes.get(genericType.toLowerCase()) ?? null
                : null;
              const resolvedGenericType =
                inheritedGenericType ??
                (genericType ? resolvePhpClassReference(source, genericType) : null);

              if (resolvedGenericType) {
                templateTypes.set(
                  templateName.toLowerCase(),
                  resolvedGenericType,
                );
              }
            });

            if (templateTypes.size > 0) {
              return templateTypes;
            }
          } catch {
            continue;
          }
        }
      }

      return new Map();
    },
    [
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
    ],
  );

  const resolvePhpGenericTemplateTypesForInheritedClass = useCallback(
    async (
      source: string,
      inheritedClassName: string,
      inheritedTemplateTypes: ReadonlyMap<string, string> = new Map(),
    ): Promise<ReadonlyMap<string, string>> =>
      resolvePhpTemplateTypesForGenericReferences(
        source,
        inheritedClassName,
        phpDocGenericInheritances(source),
        inheritedTemplateTypes,
      ),
    [resolvePhpTemplateTypesForGenericReferences],
  );

  const resolvePhpGenericTemplateTypesForMixinClass = useCallback(
    async (
      source: string,
      mixinClassName: string,
      inheritedTemplateTypes: ReadonlyMap<string, string> = new Map(),
    ): Promise<ReadonlyMap<string, string>> =>
      resolvePhpTemplateTypesForGenericReferences(
        source,
        mixinClassName,
        phpDocGenericMixins(source),
        inheritedTemplateTypes,
      ),
    [resolvePhpTemplateTypesForGenericReferences],
  );

  const readPhpClassMembersFromPath = useCallback(
    async (
      path: string,
      className: string,
    ): Promise<PhpClassMemberReadResult> => {
      const content = await readNavigationFileContent(path);
      const sourceSignature = phpSourceSignature(content);
      const { signature: frameworkSourceSignature, workspaceSources } =
        currentPhpFrameworkSourceContext();
      const cacheKey = phpClassMemberCacheKey(
        path,
        className,
        frameworkProviderSignature,
        frameworkSourceSignature,
      );
      const cached = phpClassMemberCacheRef.current[cacheKey];

      if (cached?.sourceSignature === sourceSignature) {
        return {
          content,
          members: cached.members,
        };
      }

      const members = phpMethodCompletionsFromSource(content, className, {
        frameworkProviders,
        frameworkSourceContext:
          workspaceSources.length > 0 ? { workspaceSources } : undefined,
      });
      phpClassMemberCacheRef.current[cacheKey] = {
        members,
        sourceSignature,
      };

      return {
        content,
        members,
      };
    },
    [
      currentPhpFrameworkSourceContext,
      frameworkProviderSignature,
      frameworkProviders,
      readNavigationFileContent,
    ],
  );

  const collectPhpMethodsForClass = useCallback(
    async (className: string): Promise<PhpMethodCompletion[]> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return [];
      }

      const completions = new Map<string, PhpMethodCompletion>();
      const visitedClassNames = new Set<string>();
      const rememberMethods = (
        methods: PhpMethodCompletion[],
        templateTypes: ReadonlyMap<string, string> = new Map(),
      ) => {
        for (const method of methods) {
          const key = `${method.kind ?? "method"}:${method.name.toLowerCase()}`;

          if (completions.has(key)) {
            continue;
          }

          completions.set(
            key,
            phpMethodCompletionWithTemplateReturnType(method, templateTypes),
          );
        }
      };
      const collectMethods = async (
        className: string,
        templateTypes: ReadonlyMap<string, string> = new Map(),
      ): Promise<void> => {
        const normalizedClassName = className.trim().replace(/^\\+/, "");
        const visitedKey = normalizedClassName.toLowerCase();

        if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
          return;
        }

        visitedClassNames.add(visitedKey);

        if (!isRequestedRootActive()) {
          return;
        }

        for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
          if (!isRequestedRootActive()) {
            return;
          }

          try {
            const { content, members } = await readPhpClassMembersFromPath(
              path,
              normalizedClassName,
            );

            if (!isRequestedRootActive()) {
              return;
            }

            rememberMethods(members, templateTypes);

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassName(content, traitName);

              if (resolvedTraitName) {
                const traitTemplateTypes =
                  await resolvePhpGenericTemplateTypesForInheritedClass(
                    content,
                    resolvedTraitName,
                    templateTypes,
                  );

                if (!isRequestedRootActive()) {
                  return;
                }

                await collectMethods(resolvedTraitName, traitTemplateTypes);

                if (!isRequestedRootActive()) {
                  return;
                }
              }
            }

            for (const mixinName of phpMixinClassNames(content)) {
              const resolvedMixinName = resolvePhpClassName(content, mixinName);

              if (resolvedMixinName) {
                const mixinTemplateTypes =
                  await resolvePhpGenericTemplateTypesForMixinClass(
                    content,
                    resolvedMixinName,
                    templateTypes,
                  );

                if (!isRequestedRootActive()) {
                  return;
                }

                await collectMethods(resolvedMixinName, mixinTemplateTypes);

                if (!isRequestedRootActive()) {
                  return;
                }
              }
            }

            for (const superTypeName of phpSuperTypeReferences(content)) {
              const resolvedSuperTypeName = resolvePhpClassName(
                content,
                superTypeName,
              );

              if (resolvedSuperTypeName) {
                const superTypeTemplateTypes =
                  await resolvePhpGenericTemplateTypesForInheritedClass(
                    content,
                    resolvedSuperTypeName,
                    templateTypes,
                  );

                if (!isRequestedRootActive()) {
                  return;
                }

                await collectMethods(
                  resolvedSuperTypeName,
                  superTypeTemplateTypes,
                );

                if (!isRequestedRootActive()) {
                  return;
                }
              }
            }

            return;
          } catch {
            if (!isRequestedRootActive()) {
              return;
            }

            continue;
          }
        }
      };

      await collectMethods(className);

      if (!isRequestedRootActive()) {
        return [];
      }

      const boundConcreteClassName =
        await resolvePhpFrameworkBoundConcrete(className);

      if (!isRequestedRootActive()) {
        return [];
      }

      if (boundConcreteClassName) {
        await collectMethods(boundConcreteClassName);

        if (!isRequestedRootActive()) {
          return [];
        }
      }

      return Array.from(completions.values());
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpFrameworkBoundConcrete,
      resolvePhpGenericTemplateTypesForInheritedClass,
      resolvePhpGenericTemplateTypesForMixinClass,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const collectPhpLaravelDynamicWhereMethodsForClass = useCallback(
    async (
      className: string,
      options: { isStatic?: boolean } = {},
    ): Promise<PhpMethodCompletion[]> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !memberCollectionStrategy.canCollectSyntheticMembers ||
        !requestedRoot ||
        !requestedDescriptor?.php
      ) {
        return [];
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return [];
      }

      const completions = new Map<string, PhpMethodCompletion>();

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return [];
        }

        try {
          const { content } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return [];
          }

          for (const method of memberCollectionStrategy.dynamicWhereMethods({
            className: normalizedClassName,
            options,
            source: content,
          })) {
            if (!isRequestedRootActive()) {
              return [];
            }

            const key = method.name.toLowerCase();

            if (!completions.has(key)) {
              completions.set(key, method);
            }
          }
        } catch {
          if (!isRequestedRootActive()) {
            return [];
          }

          continue;
        }
      }

      if (!isRequestedRootActive()) {
        return [];
      }

      return Array.from(completions.values());
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpClassSourcePaths,
      memberCollectionStrategy,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const collectPhpLaravelRelationCompletionsForClass = useCallback(
    async (className: string): Promise<PhpMethodCompletion[]> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !memberCollectionStrategy.canCollectSyntheticMembers ||
        !requestedRoot ||
        !requestedDescriptor?.php
      ) {
        return [];
      }

      const completions = new Map<string, PhpMethodCompletion>();
      const visitedClassNames = new Set<string>();
      const rememberRelations = (relations: PhpMethodCompletion[]) => {
        for (const relation of relations) {
          const key = relation.name.toLowerCase();

          if (completions.has(key)) {
            continue;
          }

          completions.set(key, {
            ...relation,
            kind: "relation",
          });
        }
      };
      const collectRelations = async (candidateClassName: string): Promise<void> => {
        const normalizedClassName = candidateClassName.trim().replace(/^\\+/, "");
        const visitedKey = normalizedClassName.toLowerCase();

        if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
          return;
        }

        visitedClassNames.add(visitedKey);

        if (!isRequestedRootActive()) {
          return;
        }

        for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
          if (!isRequestedRootActive()) {
            return;
          }

          try {
            const { content } = await readPhpClassMembersFromPath(
              path,
              normalizedClassName,
            );

            if (!isRequestedRootActive()) {
              return;
            }

            rememberRelations(
              memberCollectionStrategy.relationCompletions({
                className: normalizedClassName,
                source: content,
              }),
            );

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassName(content, traitName);

              if (resolvedTraitName) {
                await collectRelations(resolvedTraitName);

                if (!isRequestedRootActive()) {
                  return;
                }
              }
            }

            for (const mixinName of phpMixinClassNames(content)) {
              const resolvedMixinName = resolvePhpClassName(content, mixinName);

              if (resolvedMixinName) {
                await collectRelations(resolvedMixinName);

                if (!isRequestedRootActive()) {
                  return;
                }
              }
            }

            const parentClassName = phpExtendsClassName(content);
            const resolvedParentClassName = parentClassName
              ? resolvePhpClassName(content, parentClassName)
              : null;

            if (resolvedParentClassName) {
              await collectRelations(resolvedParentClassName);

              if (!isRequestedRootActive()) {
                return;
              }
            }

            return;
          } catch {
            if (!isRequestedRootActive()) {
              return;
            }

            continue;
          }
        }
      };

      await collectRelations(className);

      if (!isRequestedRootActive()) {
        return [];
      }

      return Array.from(completions.values());
    },
    [
      readPhpClassMembersFromPath,
      resolvePhpClassSourcePaths,
      memberCollectionStrategy,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  return {
    collectPhpLaravelDynamicWhereMethodsForClass,
    collectPhpLaravelRelationCompletionsForClass,
    collectPhpMethodsForClass,
    readPhpClassMembersFromPath,
    resetPhpClassMemberCache,
    resolvePhpGenericTemplateTypesForInheritedClass,
    resolvePhpGenericTemplateTypesForMixinClass,
  };
}

function phpClassMemberCacheKey(
  path: string,
  className: string,
  frameworkProviderSignature: string,
  migrationSourcesSignature: string,
): string {
  return `${path}#${className.trim().replace(/^\\+/, "").toLowerCase()}#${frameworkProviderSignature}#${migrationSourcesSignature}`;
}

function phpFrameworkRuntimeProviderSignature(
  frameworkRuntime: PhpFrameworkRuntimeContext,
): string {
  return `${frameworkRuntime.profile}:${frameworkRuntime.providers
    .map((provider) => provider.id)
    .join(",")}`;
}

function phpSourceSignature(source: string): string {
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${source.length}:${hash >>> 0}`;
}
