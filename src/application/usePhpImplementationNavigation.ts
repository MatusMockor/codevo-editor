import { useCallback, type MutableRefObject } from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import {
  implementationChooserTitle,
  implementationTargetFromProjectSymbol,
  type ImplementationTarget,
} from "../domain/implementationTargets";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpImplementationDeclarationContextAt,
  phpSuperTypeReferences,
} from "../domain/phpNavigation";
import { phpCurrentClassName } from "../domain/phpSemanticEngine";
import type { ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import type { EditorDocument, IntelligenceMode } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { ImplementationChooserState } from "./useWorkbenchLanguageNavigation";

export interface PhpImplementationNavigationDependencies {
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  identifierAtEditorPosition(
    source: string,
    position: EditorPosition,
  ): string | null;
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
  setImplementationChooser(chooser: ImplementationChooserState | null): void;
  workspaceRoot: string | null;
}

export interface PhpImplementationNavigation {
  goToIndexedPhpImplementation(
    requestedPosition?: EditorPosition,
  ): Promise<boolean>;
  indexedPhpImplementationTargets(
    editorPosition: EditorPosition,
  ): Promise<ImplementationTarget[]>;
}

export function usePhpImplementationNavigation({
  activeDocument,
  activeEditorPositionRef,
  currentWorkspaceRootRef,
  identifierAtEditorPosition,
  intelligenceMode,
  openNavigationTarget,
  projectSymbolSearch,
  readNavigationFileContent,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  setImplementationChooser,
  workspaceRoot,
}: PhpImplementationNavigationDependencies): PhpImplementationNavigation {
  const phpSourceInheritsOrImplementsType = useCallback(
    async (
      source: string,
      targetClassName: string,
      visitedClassNames = new Set<string>(),
    ): Promise<boolean> => {
      const normalizedTargetClassName = targetClassName
        .trim()
        .replace(/^\\+/, "")
        .toLowerCase();

      if (!normalizedTargetClassName) {
        return false;
      }

      const currentClassName = phpCurrentClassName(source);
      const currentKey = currentClassName?.toLowerCase() ?? "";

      if (currentKey && visitedClassNames.has(currentKey)) {
        return false;
      }

      if (currentKey) {
        visitedClassNames.add(currentKey);
      }

      for (const reference of phpSuperTypeReferences(source)) {
        const resolvedClassName = resolvePhpClassReference(source, reference);
        const resolvedKey = resolvedClassName?.toLowerCase();

        if (!resolvedClassName || !resolvedKey) {
          continue;
        }

        if (resolvedKey === normalizedTargetClassName) {
          return true;
        }

        for (const path of await resolvePhpClassSourcePaths(resolvedClassName)) {
          try {
            if (
              await phpSourceInheritsOrImplementsType(
                await readNavigationFileContent(path),
                targetClassName,
                visitedClassNames,
              )
            ) {
              return true;
            }
          } catch {
            continue;
          }
        }
      }

      return false;
    },
    [
      readNavigationFileContent,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
    ],
  );

  const indexedPhpImplementationTargets = useCallback(
    async (
      editorPosition: EditorPosition,
    ): Promise<ImplementationTarget[]> => {
      const document = activeDocument;
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !document ||
        document.language !== "php" ||
        !requestedRoot ||
        !shouldIndexWorkspace(intelligenceMode)
      ) {
        return [];
      }

      const declarationContext = phpImplementationDeclarationContextAt(
        document.content,
        editorPosition,
      );
      const targetClassName = phpCurrentClassName(document.content);

      if (!declarationContext || !targetClassName) {
        return [];
      }

      const { methodName } = declarationContext;
      const normalizedMethodName = methodName.toLowerCase();
      const normalizedTargetClassName = targetClassName.toLowerCase();
      const symbols = await projectSymbolSearch.searchProjectSymbols(
        requestedRoot,
        methodName,
        200,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      const targets = new Map<string, ImplementationTarget>();

      for (const symbol of symbols) {
        if (
          symbol.kind !== "method" ||
          symbol.path === document.path ||
          symbol.name.toLowerCase() !== normalizedMethodName
        ) {
          continue;
        }

        try {
          if (!isRequestedRootActive()) {
            return [];
          }

          const source = await readNavigationFileContent(symbol.path);

          if (!isRequestedRootActive()) {
            return [];
          }

          const candidateClassName =
            symbol.containerName ?? phpCurrentClassName(source);

          if (
            !candidateClassName ||
            candidateClassName.toLowerCase() === normalizedTargetClassName
          ) {
            continue;
          }

          if (
            !(await phpSourceInheritsOrImplementsType(
              source,
              targetClassName,
            ))
          ) {
            continue;
          }

          if (!isRequestedRootActive()) {
            return [];
          }

          const target = implementationTargetFromProjectSymbol(symbol);
          targets.set(target.id, target);
        } catch {
          continue;
        }
      }

      return [...targets.values()];
    },
    [
      activeDocument,
      currentWorkspaceRootRef,
      intelligenceMode,
      phpSourceInheritsOrImplementsType,
      projectSymbolSearch,
      readNavigationFileContent,
      workspaceRoot,
    ],
  );

  const goToIndexedPhpImplementation = useCallback(
    async (requestedPosition?: EditorPosition): Promise<boolean> => {
      const document = activeDocument;
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const editorPosition = requestedPosition ?? activeEditorPositionRef.current;

      if (!document || !requestedRoot || !editorPosition) {
        return false;
      }

      const targets = await indexedPhpImplementationTargets(editorPosition);

      if (!isRequestedRootActive()) {
        return false;
      }

      if (targets.length === 0) {
        return false;
      }

      const symbolName = identifierAtEditorPosition(
        document.content,
        editorPosition,
      );

      if (targets.length > 1) {
        setImplementationChooser({
          targets,
          title: implementationChooserTitle(symbolName),
        });
        return true;
      }

      const [target] = targets;

      if (!target) {
        return false;
      }

      setImplementationChooser(null);
      if (!isRequestedRootActive()) {
        return false;
      }

      await openNavigationTarget(target.path, target.position, target.label);
      return true;
    },
    [
      activeDocument,
      activeEditorPositionRef,
      currentWorkspaceRootRef,
      identifierAtEditorPosition,
      indexedPhpImplementationTargets,
      openNavigationTarget,
      setImplementationChooser,
      workspaceRoot,
    ],
  );

  return {
    goToIndexedPhpImplementation,
    indexedPhpImplementationTargets,
  };
}
