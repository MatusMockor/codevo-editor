import { useCallback, type MutableRefObject } from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpClassPathCandidates,
  phpNamedTypePosition,
} from "../domain/phpNavigation";
import type {
  EditorDocument,
  IntelligenceMode,
  WorkspaceDescriptor,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import {
  bestIndexedSymbolMatch,
  editorPositionFromProjectSymbol,
} from "./projectSymbolNavigation";
import { canNavigate, type NavigationRequest } from "./navigationRequest";

export interface PhpClassTargetNavigationDependencies {
  activeDocument: EditorDocument | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  intelligenceMode: IntelligenceMode;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: { shouldCommit?: () => boolean },
  ): Promise<boolean>;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readNavigationFileContent(path: string): Promise<string>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpClassTargetNavigation {
  openPhpClassTarget(
    className: string,
    label: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export function usePhpClassTargetNavigation({
  activeDocument,
  currentWorkspaceRootRef,
  intelligenceMode,
  openNavigationTarget,
  projectSymbolSearch,
  readNavigationFileContent,
  workspaceDescriptor,
  workspaceRoot,
}: PhpClassTargetNavigationDependencies): PhpClassTargetNavigation {
  const openPhpClassTarget = useCallback(
    async (
      className: string,
      label: string,
      request?: NavigationRequest,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const requestedSourcePath = activeDocument?.path ?? "";
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      if (shouldIndexWorkspace(intelligenceMode)) {
        const indexedSymbols = await projectSymbolSearch.searchProjectSymbols(
          requestedRoot,
          className,
          25,
        );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (!canNavigate(request)) {
          return false;
        }

        const indexedTarget = bestIndexedSymbolMatch(
          indexedSymbols,
          className,
          requestedSourcePath,
        );

        if (indexedTarget) {
          if (!isRequestedRootActive()) {
            return false;
          }

          if (!canNavigate(request)) {
            return false;
          }

          const opened = await openNavigationTarget(
            indexedTarget.path,
            editorPositionFromProjectSymbol(indexedTarget),
            label,
            {
              shouldCommit: () =>
                isRequestedRootActive() && canNavigate(request),
            },
          );

          return isRequestedRootActive() && canNavigate(request) && opened;
        }
      }

      for (const path of phpClassPathCandidates(
        requestedRoot,
        requestedDescriptor.php,
        className,
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

          const opened = await openNavigationTarget(
            path,
            phpNamedTypePosition(content, shortPhpName(className)),
            label,
            {
              shouldCommit: () =>
                isRequestedRootActive() && canNavigate(request),
            },
          );

          return isRequestedRootActive() && canNavigate(request) && opened;
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
      activeDocument,
      currentWorkspaceRootRef,
      intelligenceMode,
      openNavigationTarget,
      projectSymbolSearch,
      readNavigationFileContent,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  return { openPhpClassTarget };
}

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}
