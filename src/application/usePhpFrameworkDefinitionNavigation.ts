import { useCallback, type MutableRefObject } from "react";
import {
  detectLaravelRouteModelBindingAt,
  explicitLaravelRouteModelBindingClassName,
  phpModelNamespacePrefixes,
} from "../domain/laravelRouteModelBinding";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpEventServiceProviderClassNames,
  phpLaravelDispatchTargetAt,
  phpLaravelEventListenerMap,
  type PhpLaravelDispatchTarget,
} from "../domain/phpLaravelDispatch";
import {
  phpClassIdentifierNameAt,
  phpMethodPositionOrNull,
  resolvePhpClassName,
} from "../domain/phpNavigation";
import type {
  EditorDocument,
  TextSearchGateway,
  WorkspaceDescriptor,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  resolvePhpFrameworkLiteralNavigationTarget,
  type PhpFrameworkLiteralNavigationDependencies,
} from "./phpFrameworkLiteralNavigation";

interface OpenNavigationOptions {
  readOnly?: boolean;
}

export interface PhpFrameworkDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkLiteralNavigationDependencies: PhpFrameworkLiteralNavigationDependencies;
  isLaravelFrameworkActive: boolean;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ): Promise<boolean>;
  openPhpClassTarget(className: string, label: string): Promise<boolean>;
  providers: Parameters<typeof resolvePhpFrameworkLiteralNavigationTarget>[0]["providers"];
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassSourcePaths(className: string): Promise<readonly string[]>;
  textSearch: TextSearchGateway;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpFrameworkDefinitionNavigation {
  providePhpFrameworkDefinition(source: string, offset: number): Promise<boolean>;
}

export function usePhpFrameworkDefinitionNavigation({
  activeDocument,
  currentWorkspaceRootRef,
  frameworkLiteralNavigationDependencies,
  isLaravelFrameworkActive,
  openNavigationTarget,
  openPhpClassTarget,
  providers,
  readNavigationFileContent,
  resolvePhpClassSourcePaths,
  textSearch,
  workspaceDescriptor,
  workspaceRoot,
}: PhpFrameworkDefinitionNavigationDependencies): PhpFrameworkDefinitionNavigation {
  const openPhpLaravelHandlerTarget = useCallback(
    async (className: string, shortName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(className)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        let content: string;

        try {
          content = await readNavigationFileContent(path);
        } catch {
          if (!isRequestedRootActive()) {
            return false;
          }

          continue;
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        const methodPosition =
          phpMethodPositionOrNull(content, "handle") ??
          phpMethodPositionOrNull(content, "__invoke");

        if (!methodPosition) {
          continue;
        }

        return openNavigationTarget(path, methodPosition, `${shortName}`);
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      return openPhpClassTarget(className, shortName);
    },
    [
      currentWorkspaceRootRef,
      openNavigationTarget,
      openPhpClassTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelEventListenerDefinition = useCallback(
    async (eventClassName: string): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const normalizedEventClassName = eventClassName.toLowerCase();
      const listenerClassNames: string[] = [];

      for (const providerClassName of phpEventServiceProviderClassNames(
        requestedDescriptor.php,
      )) {
        if (!isRequestedRootActive()) {
          return false;
        }

        for (const path of await resolvePhpClassSourcePaths(providerClassName)) {
          if (!isRequestedRootActive()) {
            return false;
          }

          let providerSource: string;

          try {
            providerSource = await readNavigationFileContent(path);
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }

          if (!isRequestedRootActive()) {
            return false;
          }

          const listenerMap = phpLaravelEventListenerMap(providerSource);

          for (const [mappedEvent, listeners] of listenerMap) {
            const resolvedMappedEvent = resolvePhpClassName(
              providerSource,
              mappedEvent,
            );

            if (
              resolvedMappedEvent?.toLowerCase() !== normalizedEventClassName
            ) {
              continue;
            }

            for (const listener of listeners) {
              const resolvedListener = resolvePhpClassName(
                providerSource,
                listener,
              );

              if (resolvedListener) {
                listenerClassNames.push(resolvedListener);
              }
            }
          }
        }

        if (listenerClassNames.length > 0) {
          break;
        }
      }

      for (const listenerClassName of listenerClassNames) {
        if (!isRequestedRootActive()) {
          return false;
        }

        if (
          await openPhpLaravelHandlerTarget(
            listenerClassName,
            shortPhpName(listenerClassName),
          )
        ) {
          return true;
        }
      }

      return false;
    },
    [
      currentWorkspaceRootRef,
      openPhpLaravelHandlerTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelDispatchDefinition = useCallback(
    async (
      source: string,
      target: PhpLaravelDispatchTarget,
    ): Promise<boolean> => {
      const resolvedClassName = resolvePhpClassName(source, target.className);

      if (!resolvedClassName) {
        return false;
      }

      const shortName = shortPhpName(resolvedClassName);

      if (target.kind === "event") {
        return goToPhpLaravelEventListenerDefinition(resolvedClassName);
      }

      if (target.kind === "job") {
        return openPhpLaravelHandlerTarget(resolvedClassName, shortName);
      }

      if (await goToPhpLaravelEventListenerDefinition(resolvedClassName)) {
        return true;
      }

      return openPhpLaravelHandlerTarget(resolvedClassName, shortName);
    },
    [goToPhpLaravelEventListenerDefinition, openPhpLaravelHandlerTarget],
  );

  const resolvePhpLaravelExplicitRouteModelBindingClassName = useCallback(
    async (
      currentSource: string,
      currentPath: string | null,
      parameterName: string,
    ): Promise<string | null> => {
      const localClassName = explicitLaravelRouteModelBindingClassName(
        currentSource,
        parameterName,
      );

      if (localClassName) {
        return resolvePhpClassName(currentSource, localClassName);
      }

      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !isRequestedRootActive()) {
        return null;
      }

      const searchResults = await Promise.all(
        ["Route::model", "Route::bind"].map((query) =>
          textSearch.searchText(requestedRoot, query, 100),
        ),
      );

      if (!isRequestedRootActive()) {
        return null;
      }

      const visitedPaths = new Set(currentPath ? [currentPath] : []);

      for (const result of searchResults.flat()) {
        if (!isRequestedRootActive()) {
          return null;
        }

        if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
          continue;
        }

        visitedPaths.add(result.path);

        try {
          const content = await readNavigationFileContent(result.path);

          if (!isRequestedRootActive()) {
            return null;
          }

          const className = explicitLaravelRouteModelBindingClassName(
            content,
            parameterName,
          );
          const resolvedClassName = className
            ? resolvePhpClassName(content, className)
            : null;

          if (resolvedClassName) {
            return resolvedClassName;
          }
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }

          continue;
        }
      }

      return null;
    },
    [
      currentWorkspaceRootRef,
      readNavigationFileContent,
      textSearch,
      workspaceRoot,
    ],
  );

  const providePhpFrameworkDefinition = useCallback(
    async (source: string, offset: number): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      const routeBinding = isLaravelFrameworkActive
        ? detectLaravelRouteModelBindingAt(source, offset)
        : null;

      if (routeBinding) {
        const resolvedExplicitClassName =
          await resolvePhpLaravelExplicitRouteModelBindingClassName(
            source,
            activeDocument?.path ?? null,
            routeBinding.parameterName,
          );

        if (resolvedExplicitClassName) {
          if (!isRequestedRootActive()) {
            return false;
          }

          const handled = await openPhpClassTarget(
            resolvedExplicitClassName,
            shortPhpName(resolvedExplicitClassName),
          );

          if (handled) {
            return true;
          }
        }

        const modelNamespaces = phpModelNamespacePrefixes(
          workspaceDescriptor?.php,
        );

        for (const namespace of modelNamespaces) {
          if (!isRequestedRootActive()) {
            return false;
          }

          const handled = await openPhpClassTarget(
            `${namespace}${routeBinding.modelShortName}`,
            routeBinding.modelShortName,
          );

          if (handled) {
            return true;
          }
        }

        return false;
      }

      const dispatchTarget = isLaravelFrameworkActive
        ? phpLaravelDispatchTargetAt(source, offset)
        : null;

      if (dispatchTarget) {
        if (!isRequestedRootActive()) {
          return false;
        }

        return goToPhpLaravelDispatchDefinition(source, dispatchTarget);
      }

      const classIdentifierName = phpClassIdentifierNameAt(source, offset);

      if (classIdentifierName) {
        const resolvedClassName = resolvePhpClassName(
          source,
          classIdentifierName,
        );

        if (resolvedClassName) {
          const handledClassTarget = await openPhpClassTarget(
            resolvedClassName,
            classIdentifierName,
          );

          if (handledClassTarget) {
            return true;
          }
        }
      }

      const literalTarget = await resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: activeDocument
            ? { content: activeDocument.content, path: activeDocument.path }
            : null,
          offset,
          position: editorPositionAtOffset(source, offset),
          providers,
          source,
        },
        frameworkLiteralNavigationDependencies,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      return literalTarget
        ? openNavigationTarget(
            literalTarget.path,
            literalTarget.position,
            literalTarget.label,
          )
        : false;
    },
    [
      activeDocument,
      currentWorkspaceRootRef,
      frameworkLiteralNavigationDependencies,
      goToPhpLaravelDispatchDefinition,
      isLaravelFrameworkActive,
      openNavigationTarget,
      openPhpClassTarget,
      providers,
      resolvePhpLaravelExplicitRouteModelBindingClassName,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  return { providePhpFrameworkDefinition };
}

function isPhpPath(path: string): boolean {
  return path.toLowerCase().endsWith(".php");
}

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clampedOffset = Math.max(0, Math.min(offset, source.length));
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < clampedOffset; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      lineStart = index + 1;
    }
  }

  return {
    column: clampedOffset - lineStart + 1,
    lineNumber,
  };
}
