import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpPropertyPositionOrNull,
  phpSuperTypeReferences,
} from "../domain/phpNavigation";
import {
  phpMixinClassNames,
  phpTraitClassNames,
} from "../domain/phpMethodCompletions";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface PhpPropertyTargetNavigationDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassReference(source: string, reference: string): string | null;
  resolvePhpClassSourcePaths(className: string): Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpPropertyTargetNavigation {
  openDirectPhpPropertyTarget(
    className: string,
    propertyName: string,
  ): Promise<boolean>;
}

export function usePhpPropertyTargetNavigation({
  currentWorkspaceRootRef,
  openNavigationTarget,
  readNavigationFileContent,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: PhpPropertyTargetNavigationDependencies): PhpPropertyTargetNavigation {
  const openDirectPhpPropertyTarget = useCallback(
    async (className: string, propertyName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const visitedClassNames = new Set<string>();
      const openPropertyInClassHierarchy = async (
        candidateClassName: string,
      ): Promise<boolean> => {
        const normalizedCandidate = candidateClassName.trim().replace(/^\\+/, "");
        const visitedKey = normalizedCandidate.toLowerCase();

        if (!normalizedCandidate || visitedClassNames.has(visitedKey)) {
          return false;
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        visitedClassNames.add(visitedKey);

        for (const path of await resolvePhpClassSourcePaths(normalizedCandidate)) {
          if (!isRequestedRootActive()) {
            return false;
          }

          try {
            const content = await readNavigationFileContent(path);

            if (!isRequestedRootActive()) {
              return false;
            }

            const position = phpPropertyPositionOrNull(content, propertyName);

            if (position) {
              if (!isRequestedRootActive()) {
                return false;
              }

              return openNavigationTarget(path, position, `$${propertyName}`);
            }

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassReference(
                content,
                traitName,
              );

              if (
                resolvedTraitName &&
                (await openPropertyInClassHierarchy(resolvedTraitName))
              ) {
                return true;
              }
            }

            for (const mixinName of phpMixinClassNames(content)) {
              const resolvedMixinName = resolvePhpClassReference(
                content,
                mixinName,
              );

              if (
                resolvedMixinName &&
                (await openPropertyInClassHierarchy(resolvedMixinName))
              ) {
                return true;
              }
            }

            for (const superTypeName of phpSuperTypeReferences(content)) {
              const resolvedSuperTypeName = resolvePhpClassReference(
                content,
                superTypeName,
              );

              if (
                resolvedSuperTypeName &&
                (await openPropertyInClassHierarchy(resolvedSuperTypeName))
              ) {
                return true;
              }
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        return false;
      };

      return openPropertyInClassHierarchy(className);
    },
    [
      currentWorkspaceRootRef,
      openNavigationTarget,
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  return { openDirectPhpPropertyTarget };
}
