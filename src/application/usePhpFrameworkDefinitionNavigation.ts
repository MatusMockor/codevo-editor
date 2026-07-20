import { useCallback, useEffect, useMemo, type MutableRefObject } from "react";
import {
  phpFrameworkDispatchTargetAt,
  phpFrameworkEventListenerMapFromSource,
  phpFrameworkEventServiceProviderClassNames,
  phpFrameworkExplicitRouteModelBindingClassName,
  phpFrameworkExplicitRouteModelBindingSearchQueries,
  phpFrameworkModelNamespacePrefixes,
  phpFrameworkRouteModelBindingAt,
  type PhpFrameworkDispatchTarget,
} from "../domain/phpFrameworkProviders";
import type { EditorPosition } from "../domain/languageServerFeatures";
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
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { canNavigate, type NavigationRequest } from "./navigationRequest";
import { createPhpFrameworkDefinitionNavigationContributionCatalog } from "./phpFrameworkDefinitionNavigationContributionCatalog";
import {
  PhpFrameworkActivationScope,
  type PhpFrameworkActivationContext,
} from "./phpFrameworkExtensionRegistry";

interface OpenNavigationOptions {
  readOnly?: boolean;
  shouldCommit?: () => boolean;
}

export interface PhpFrameworkDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  frameworkActivation: PhpFrameworkActivationContext;
  frameworkLiteralNavigationDependencies: PhpFrameworkLiteralNavigationDependencies;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ): Promise<boolean>;
  openPhpClassTarget(
    className: string,
    label: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolvePhpClassSourcePaths(className: string): Promise<readonly string[]>;
  textSearch: TextSearchGateway;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpFrameworkDefinitionNavigation {
  providePhpFrameworkDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export function usePhpFrameworkDefinitionNavigation({
  activeDocument,
  currentWorkspaceRootRef,
  frameworkRuntime,
  frameworkActivation,
  frameworkLiteralNavigationDependencies,
  openNavigationTarget,
  openPhpClassTarget,
  readNavigationFileContent,
  resolvePhpExpressionType,
  resolvePhpClassSourcePaths,
  textSearch,
  workspaceDescriptor,
  workspaceRoot,
}: PhpFrameworkDefinitionNavigationDependencies): PhpFrameworkDefinitionNavigation {
  const activePhpFrameworkProviders = frameworkRuntime.providers;
  const supportsFrameworkRouteDefinitionNavigation =
    frameworkRuntime.supports("routes");
  const supportsFrameworkDispatchDefinitionNavigation =
    frameworkRuntime.supports("dispatch");
  const supportsFrameworkStringLiteralDefinitionNavigation =
    frameworkRuntime.supports("stringLiterals");
  const phpFrameworkNavigationActivationScope = useMemo(
    () => new PhpFrameworkActivationScope(frameworkActivation),
    [frameworkActivation],
  );
  const phpFrameworkDefinitionNavigationContributions = useMemo(() => {
    return createPhpFrameworkDefinitionNavigationContributionCatalog({
      activation: frameworkActivation,
      frameworkRuntime,
      openPhpClassTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      resolvePhpExpressionType,
    });
  }, [
    currentWorkspaceRootRef,
    frameworkActivation,
    frameworkRuntime,
    openPhpClassTarget,
    readNavigationFileContent,
    resolvePhpClassSourcePaths,
    resolvePhpExpressionType,
    workspaceRoot,
  ]);
  useEffect(
    () => () => phpFrameworkNavigationActivationScope.abort(),
    [phpFrameworkNavigationActivationScope],
  );
  useEffect(
    () => () => phpFrameworkDefinitionNavigationContributions.abort?.(),
    [phpFrameworkDefinitionNavigationContributions],
  );

  const openPhpFrameworkHandlerTarget = useCallback(
    async (
      className: string,
      shortName: string,
      request: NavigationRequest,
    ): Promise<boolean> => {
      if (!canNavigate(request)) {
        return false;
      }

      const paths = await resolvePhpClassSourcePaths(className);

      if (!canNavigate(request)) {
        return false;
      }

      for (const path of paths) {
        let content: string;

        try {
          content = await readNavigationFileContent(path);
        } catch {
          if (!canNavigate(request)) {
            return false;
          }

          continue;
        }

        if (!canNavigate(request)) {
          return false;
        }

        const methodPosition =
          phpMethodPositionOrNull(content, "handle") ??
          phpMethodPositionOrNull(content, "__invoke");

        if (!methodPosition) {
          continue;
        }

        if (!canNavigate(request)) {
          return false;
        }

        const opened = await openNavigationTarget(
          path,
          methodPosition,
          `${shortName}`,
          { shouldCommit: request.canNavigate },
        );

        return canNavigate(request) && opened;
      }

      if (!canNavigate(request)) {
        return false;
      }

      const opened = await openPhpClassTarget(className, shortName, request);
      return canNavigate(request) && opened;
    },
    [
      openNavigationTarget,
      openPhpClassTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
    ],
  );

  const goToPhpFrameworkEventListenerDefinition = useCallback(
    async (
      eventClassName: string,
      request: NavigationRequest,
    ): Promise<boolean> => {
      const requestedDescriptor = workspaceDescriptor;

      if (!requestedDescriptor?.php || !canNavigate(request)) {
        return false;
      }

      const normalizedEventClassName = eventClassName.toLowerCase();
      const listenerClassNames: string[] = [];

      for (const providerClassName of phpFrameworkEventServiceProviderClassNames(
        requestedDescriptor.php,
        activePhpFrameworkProviders,
      )) {
        if (!canNavigate(request)) {
          return false;
        }

        const paths = await resolvePhpClassSourcePaths(providerClassName);

        if (!canNavigate(request)) {
          return false;
        }

        for (const path of paths) {

          let providerSource: string;

          try {
            providerSource = await readNavigationFileContent(path);
          } catch {
            if (!canNavigate(request)) {
              return false;
            }

            continue;
          }

          if (!canNavigate(request)) {
            return false;
          }

          const listenerMap = phpFrameworkEventListenerMapFromSource(
            providerSource,
            activePhpFrameworkProviders,
          );

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
        if (!canNavigate(request)) {
          return false;
        }

        const opened = await openPhpFrameworkHandlerTarget(
          listenerClassName,
          shortPhpName(listenerClassName),
          request,
        );

        if (!canNavigate(request)) {
          return false;
        }

        if (opened) {
          return true;
        }
      }

      return false;
    },
    [
      activePhpFrameworkProviders,
      openPhpFrameworkHandlerTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
    ],
  );

  const goToPhpFrameworkDispatchDefinition = useCallback(
    async (
      source: string,
      target: PhpFrameworkDispatchTarget,
      request: NavigationRequest,
    ): Promise<boolean> => {
      const resolvedClassName = resolvePhpClassName(source, target.className);

      if (!resolvedClassName) {
        return false;
      }

      const shortName = shortPhpName(resolvedClassName);

      if (target.kind === "event") {
        if (!canNavigate(request)) {
          return false;
        }

        const opened = await goToPhpFrameworkEventListenerDefinition(
          resolvedClassName,
          request,
        );
        return canNavigate(request) && opened;
      }

      if (target.kind === "job") {
        if (!canNavigate(request)) {
          return false;
        }

        const opened = await openPhpFrameworkHandlerTarget(
          resolvedClassName,
          shortName,
          request,
        );
        return canNavigate(request) && opened;
      }

      if (!canNavigate(request)) {
        return false;
      }

      const openedListener =
        await goToPhpFrameworkEventListenerDefinition(resolvedClassName, request);

      if (!canNavigate(request)) {
        return false;
      }

      if (openedListener) {
        return true;
      }

      const opened = await openPhpFrameworkHandlerTarget(
        resolvedClassName,
        shortName,
        request,
      );
      return canNavigate(request) && opened;
    },
    [goToPhpFrameworkEventListenerDefinition, openPhpFrameworkHandlerTarget],
  );

  const resolvePhpFrameworkExplicitRouteModelBindingClassName = useCallback(
    async (
      currentSource: string,
      currentPath: string | null,
      parameterName: string,
      request: NavigationRequest,
    ): Promise<string | null> => {
      const localClassName = phpFrameworkExplicitRouteModelBindingClassName(
        currentSource,
        parameterName,
        activePhpFrameworkProviders,
      );

      if (localClassName) {
        return canNavigate(request)
          ? resolvePhpClassName(currentSource, localClassName)
          : null;
      }

      const requestedRoot = workspaceRoot;

      if (!requestedRoot || !canNavigate(request)) {
        return null;
      }

      const searchQueries = phpFrameworkExplicitRouteModelBindingSearchQueries(
        activePhpFrameworkProviders,
      );

      if (searchQueries.length === 0) {
        return null;
      }

      const searchResults = await Promise.all(
        searchQueries.map((query) =>
          textSearch.searchText(requestedRoot, query, 100),
        ),
      );

      if (!canNavigate(request)) {
        return null;
      }

      const visitedPaths = new Set(currentPath ? [currentPath] : []);

      for (const result of searchResults.flat()) {
        if (!canNavigate(request)) {
          return null;
        }

        if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
          continue;
        }

        visitedPaths.add(result.path);

        try {
          const content = await readNavigationFileContent(result.path);

          if (!canNavigate(request)) {
            return null;
          }

          const className = phpFrameworkExplicitRouteModelBindingClassName(
            content,
            parameterName,
            activePhpFrameworkProviders,
          );
          const resolvedClassName = className
            ? resolvePhpClassName(content, className)
            : null;

          if (resolvedClassName) {
            return resolvedClassName;
          }
        } catch {
          if (!canNavigate(request)) {
            return null;
          }

          continue;
        }
      }

      return null;
    },
    [
      activePhpFrameworkProviders,
      readNavigationFileContent,
      textSearch,
      workspaceRoot,
    ],
  );

  const providePhpFrameworkDefinition = useCallback(
    async (
      source: string,
      offset: number,
      request?: NavigationRequest,
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;

      if (!requestedRoot) {
        return false;
      }

      const executionScope =
        phpFrameworkNavigationActivationScope.executionScope({
          generation: frameworkActivation.generation,
          ownerKey: frameworkActivation.ownerKey,
          rootPath: frameworkActivation.rootPath,
        });

      if (!executionScope) {
        return false;
      }

      const fencedRequest: NavigationRequest = {
        canNavigate: () =>
          executionScope.canCommit() &&
          workspaceRootKeysEqual(requestedRoot, executionScope.rootPath) &&
          workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            executionScope.rootPath,
          ) &&
          canNavigate(request),
      };

      if (!canNavigate(fencedRequest)) {
        return false;
      }

      const routeBinding = supportsFrameworkRouteDefinitionNavigation
        ? phpFrameworkRouteModelBindingAt(
            source,
            offset,
            activePhpFrameworkProviders,
          )
        : null;

      if (routeBinding) {
        const resolvedExplicitClassName =
          await resolvePhpFrameworkExplicitRouteModelBindingClassName(
            source,
            activeDocument?.path ?? null,
            routeBinding.parameterName,
            fencedRequest,
          );

        if (!canNavigate(fencedRequest)) {
          return false;
        }

        if (resolvedExplicitClassName) {
          const handled = await openPhpClassTarget(
            resolvedExplicitClassName,
            shortPhpName(resolvedExplicitClassName),
            fencedRequest,
          );

          if (!canNavigate(fencedRequest)) {
            return false;
          }

          if (handled) {
            return true;
          }
        }

        const modelNamespaces = phpFrameworkModelNamespacePrefixes(
          workspaceDescriptor?.php,
          activePhpFrameworkProviders,
        );

        for (const namespace of modelNamespaces) {
          if (!canNavigate(fencedRequest)) {
            return false;
          }

          const handled = await openPhpClassTarget(
            `${namespace}${routeBinding.modelShortName}`,
            routeBinding.modelShortName,
            fencedRequest,
          );

          if (!canNavigate(fencedRequest)) {
            return false;
          }

          if (handled) {
            return true;
          }
        }

        return false;
      }

      const dispatchTarget = supportsFrameworkDispatchDefinitionNavigation
        ? phpFrameworkDispatchTargetAt(
            source,
            offset,
            activePhpFrameworkProviders,
          )
        : null;

      if (dispatchTarget) {
        if (!canNavigate(fencedRequest)) {
          return false;
        }

        const handled = await goToPhpFrameworkDispatchDefinition(
          source,
          dispatchTarget,
          fencedRequest,
        );
        return canNavigate(fencedRequest) && handled;
      }

      const classIdentifierName = phpClassIdentifierNameAt(source, offset);

      if (classIdentifierName) {
        const resolvedClassName = resolvePhpClassName(
          source,
          classIdentifierName,
        );

        if (resolvedClassName) {
          if (!canNavigate(fencedRequest)) {
            return false;
          }

          const handledClassTarget = await openPhpClassTarget(
            resolvedClassName,
            classIdentifierName,
            fencedRequest,
          );

          if (!canNavigate(fencedRequest)) {
            return false;
          }

          if (handledClassTarget) {
            return true;
          }
        }
      }

      const handledContributionTarget =
        await phpFrameworkDefinitionNavigationContributions.provideDefinition(
          source,
          offset,
          fencedRequest,
        );

      if (!canNavigate(fencedRequest)) {
        return false;
      }

      if (handledContributionTarget) {
        return true;
      }

      const literalTarget = await resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: activeDocument
            ? { content: activeDocument.content, path: activeDocument.path }
            : null,
          offset,
          position: editorPositionAtOffset(source, offset),
          providers: activePhpFrameworkProviders,
          source,
          supportsStringLiterals:
            supportsFrameworkStringLiteralDefinitionNavigation,
        },
        frameworkLiteralNavigationDependencies,
      );

      if (!canNavigate(fencedRequest)) {
        return false;
      }

      if (!literalTarget) {
        return false;
      }

      const opened = await openNavigationTarget(
        literalTarget.path,
        literalTarget.position,
        literalTarget.label,
        { shouldCommit: fencedRequest.canNavigate },
      );

      return canNavigate(fencedRequest) && opened;
    },
    [
      activeDocument,
      currentWorkspaceRootRef,
      frameworkActivation.generation,
      frameworkActivation.ownerKey,
      frameworkActivation.rootPath,
      frameworkLiteralNavigationDependencies,
      goToPhpFrameworkDispatchDefinition,
      openNavigationTarget,
      openPhpClassTarget,
      phpFrameworkDefinitionNavigationContributions,
      phpFrameworkNavigationActivationScope,
      activePhpFrameworkProviders,
      resolvePhpFrameworkExplicitRouteModelBindingClassName,
      supportsFrameworkDispatchDefinitionNavigation,
      supportsFrameworkRouteDefinitionNavigation,
      supportsFrameworkStringLiteralDefinitionNavigation,
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
