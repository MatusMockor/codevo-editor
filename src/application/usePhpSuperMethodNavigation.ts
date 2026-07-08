import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpDocMethodPositionOrNull,
  phpEnclosingMethodNameAt,
  phpMethodPositionOrNull,
} from "../domain/phpNavigation";
import type { EditorDocument, WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { phpSuperMethodHierarchyReferences } from "./usePhpCodeActions";

export interface PhpSuperMethodNavigationDependencies {
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassReference(source: string, reference: string): string | null;
  resolvePhpClassSourcePaths(className: string): Promise<string[]>;
  setMessage(message: string | null): void;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpSuperMethodNavigation {
  goToSuperMethod(): Promise<boolean>;
}

export function usePhpSuperMethodNavigation({
  activeDocument,
  activeEditorPositionRef,
  currentWorkspaceRootRef,
  openNavigationTarget,
  readNavigationFileContent,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  setMessage,
  workspaceDescriptor,
  workspaceRoot,
}: PhpSuperMethodNavigationDependencies): PhpSuperMethodNavigation {
  const goToSuperMethod = useCallback(async (): Promise<boolean> => {
    if (!activeDocument || activeDocument.language !== "php") {
      return false;
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      return false;
    }

    const source = activeDocument.content;
    const methodName = phpEnclosingMethodNameAt(source, editorPosition);

    if (!methodName) {
      return false;
    }

    const requestedRoot = workspaceRoot;
    const requestedDescriptor = workspaceDescriptor;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

    if (!requestedRoot || !requestedDescriptor?.php) {
      return false;
    }

    const visitedClassNames = new Set<string>();
    const openSuperMethodInHierarchy = async (
      candidateClassName: string,
    ): Promise<boolean> => {
      const normalizedCandidate = candidateClassName.trim().replace(/^\\+/, "");
      const visitedKey = normalizedCandidate.toLowerCase();

      if (!normalizedCandidate || visitedClassNames.has(visitedKey)) {
        return false;
      }

      visitedClassNames.add(visitedKey);

      if (!isRequestedRootActive()) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedCandidate)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const content = await readNavigationFileContent(path);

          if (!isRequestedRootActive()) {
            return false;
          }

          const position =
            phpMethodPositionOrNull(content, methodName) ??
            phpDocMethodPositionOrNull(content, methodName);

          if (position) {
            if (!isRequestedRootActive()) {
              return false;
            }

            return openNavigationTarget(path, position, `${methodName}()`);
          }

          for (const superReference of phpSuperMethodHierarchyReferences(
            content,
          )) {
            const resolvedReference = resolvePhpClassReference(
              content,
              superReference,
            );

            if (
              resolvedReference &&
              (await openSuperMethodInHierarchy(resolvedReference))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
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

    for (const superReference of phpSuperMethodHierarchyReferences(source)) {
      const resolvedReference = resolvePhpClassReference(source, superReference);

      if (
        resolvedReference &&
        (await openSuperMethodInHierarchy(resolvedReference))
      ) {
        return true;
      }

      if (!isRequestedRootActive()) {
        return false;
      }
    }

    if (!isRequestedRootActive()) {
      return false;
    }

    setMessage(`No super method found for ${methodName}().`);
    return false;
  }, [
    activeDocument,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    openNavigationTarget,
    readNavigationFileContent,
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    setMessage,
    workspaceDescriptor,
    workspaceRoot,
  ]);

  return { goToSuperMethod };
}
