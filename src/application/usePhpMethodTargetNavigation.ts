import { useCallback, type MutableRefObject } from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpClassPathCandidates,
  phpDocMethodPositionOrNull,
  phpMethodPosition,
  phpMethodPositionOrNull,
  phpSuperTypeReferences,
  type PhpMethodDefinitionHint,
} from "../domain/phpNavigation";
import {
  phpMixinClassNames,
  phpTraitClassNames,
} from "../domain/phpMethodCompletions";
import type {
  IntelligenceMode,
  WorkspaceDescriptor,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import { editorPositionFromProjectSymbol } from "./projectSymbolNavigation";
import { canNavigate, type NavigationRequest } from "./navigationRequest";

export interface PhpMethodTargetNavigationDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  intelligenceMode: IntelligenceMode;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassReference(source: string, reference: string): string | null;
  resolvePhpClassSourcePaths(className: string): Promise<string[]>;
  resolvePhpFrameworkBoundConcrete(className: string): Promise<string | null>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpMethodTargetNavigation {
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  openPhpMethodHintTarget(
    hint: PhpMethodDefinitionHint,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export function usePhpMethodTargetNavigation({
  currentWorkspaceRootRef,
  intelligenceMode,
  openNavigationTarget,
  projectSymbolSearch,
  readNavigationFileContent,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  resolvePhpFrameworkBoundConcrete,
  workspaceDescriptor,
  workspaceRoot,
}: PhpMethodTargetNavigationDependencies): PhpMethodTargetNavigation {
  const openPhpMethodHintTarget = useCallback(
    async (
      hint: PhpMethodDefinitionHint,
      request?: NavigationRequest,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      for (const path of phpClassPathCandidates(
        requestedRoot,
        requestedDescriptor.php,
        hint.className,
      )) {
        if (!isRequestedRootActive()) {
          return false;
        }

        if (!canNavigate(request)) {
          return false;
        }

        try {
          const content = await readNavigationFileContent(path);

          if (!isRequestedRootActive()) {
            return false;
          }

          if (!canNavigate(request)) {
            return false;
          }

          return openNavigationTarget(
            path,
            phpMethodPosition(content, hint.methodName),
            `${hint.methodName}()`,
          );
        } catch {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (!canNavigate(request)) {
            return false;
          }

          continue;
        }
      }

      return false;
    },
    [
      currentWorkspaceRootRef,
      openNavigationTarget,
      readNavigationFileContent,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const openDirectPhpMethodTarget = useCallback(
    async (
      className: string,
      methodName: string,
      request?: NavigationRequest,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      const normalizedClassName = className.toLowerCase();
      const normalizedMethodName = methodName.toLowerCase();

      if (shouldIndexWorkspace(intelligenceMode)) {
        const symbols = await projectSymbolSearch.searchProjectSymbols(
          requestedRoot,
          methodName,
          50,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (!canNavigate(request)) {
          return false;
        }

        const target = symbols.find(
          (symbol) =>
            symbol.kind === "method" &&
            symbol.name.toLowerCase() === normalizedMethodName &&
            symbol.containerName?.toLowerCase() === normalizedClassName,
        );

        if (target) {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (!canNavigate(request)) {
            return false;
          }

          return openNavigationTarget(
            target.path,
            editorPositionFromProjectSymbol(target),
            `${methodName}()`,
          );
        }
      }

      if (!requestedDescriptor?.php) {
        return false;
      }

      const visitedClassNames = new Set<string>();
      const openMethodInClassHierarchy = async (
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

        if (!canNavigate(request)) {
          return false;
        }

        visitedClassNames.add(visitedKey);

        for (const path of await resolvePhpClassSourcePaths(normalizedCandidate)) {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (!canNavigate(request)) {
            return false;
          }

          try {
            const content = await readNavigationFileContent(path);

            if (!isRequestedRootActive()) {
              return false;
            }

            if (!canNavigate(request)) {
              return false;
            }

            const position =
              phpMethodPositionOrNull(content, methodName) ??
              phpDocMethodPositionOrNull(content, methodName);

            if (position) {
              if (!isRequestedRootActive()) {
                return false;
              }

              if (!canNavigate(request)) {
                return false;
              }

              return openNavigationTarget(path, position, `${methodName}()`);
            }

            for (const traitName of phpTraitClassNames(content)) {
              const resolvedTraitName = resolvePhpClassReference(
                content,
                traitName,
              );

              if (
                resolvedTraitName &&
                (await openMethodInClassHierarchy(resolvedTraitName))
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
                (await openMethodInClassHierarchy(resolvedMixinName))
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
                (await openMethodInClassHierarchy(resolvedSuperTypeName))
              ) {
                return true;
              }
            }
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            if (!canNavigate(request)) {
              return false;
            }

            continue;
          }
        }

        return false;
      };

      if (await openMethodInClassHierarchy(className)) {
        return true;
      }

      const boundConcreteClassName =
        await resolvePhpFrameworkBoundConcrete(className);

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!canNavigate(request)) {
        return false;
      }

      return boundConcreteClassName
        ? openMethodInClassHierarchy(boundConcreteClassName)
        : false;
    },
    [
      currentWorkspaceRootRef,
      intelligenceMode,
      openNavigationTarget,
      projectSymbolSearch,
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      resolvePhpFrameworkBoundConcrete,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  return {
    openDirectPhpMethodTarget,
    openPhpMethodHintTarget,
  };
}
