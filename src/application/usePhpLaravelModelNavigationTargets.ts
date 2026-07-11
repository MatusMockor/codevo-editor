import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpLaravelDynamicWhereAttributeTargetFromSource,
  phpLaravelModelAccessorTargetFromSource,
  phpLaravelModelAttributeTargetFromSource,
  phpLaravelModelSourcesForTableName,
} from "../domain/phpFrameworkLaravel";
import {
  phpFrameworkModelNamespacePrefixes,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  type ProjectSymbolSearchGateway,
} from "../domain/projectSymbols";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

interface OpenNavigationOptions {
  readOnly?: boolean;
}

export interface PhpLaravelModelNavigationTargetsDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  isLaravelFrameworkActive?: boolean;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ): Promise<boolean>;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  providers: readonly PhpFrameworkProvider[];
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassSourcePaths(className: string): Promise<readonly string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpLaravelModelNavigationTargets {
  findPhpLaravelValidationRuleModelTargets(
    tableName: string,
  ): Promise<readonly PhpLaravelValidationRuleModelTarget[]>;
  openPhpLaravelDynamicWhereTarget(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  openPhpLaravelModelAttributeTarget(
    className: string,
    attributeName: string,
  ): Promise<boolean>;
}

export interface PhpLaravelValidationRuleModelTarget {
  label: string;
  path: string;
  position: EditorPosition;
}

export function usePhpLaravelModelNavigationTargets({
  currentWorkspaceRootRef,
  frameworkRuntime,
  isLaravelFrameworkActive: legacyIsLaravelFrameworkActive = false,
  openNavigationTarget,
  projectSymbolSearch,
  providers,
  readNavigationFileContent,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: PhpLaravelModelNavigationTargetsDependencies): PhpLaravelModelNavigationTargets {
  const canOpenLaravelModelSourceTargets =
    frameworkRuntime?.isLaravel ?? legacyIsLaravelFrameworkActive;

  const findPhpLaravelValidationRuleModelTargets = useCallback(
    async (
      tableName: string,
    ): Promise<readonly PhpLaravelValidationRuleModelTarget[]> =>
      findLaravelValidationRuleModelTargets({
        canOpenLaravelModelSourceTargets,
        currentWorkspaceRootRef,
        projectSymbolSearch,
        providers,
        readNavigationFileContent,
        resolvePhpClassSourcePaths,
        tableName,
        workspaceDescriptor,
        workspaceRoot,
      }),
    [
      canOpenLaravelModelSourceTargets,
      currentWorkspaceRootRef,
      projectSymbolSearch,
      providers,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const openPhpLaravelDynamicWhereTarget = useCallback(
    async (className: string, methodName: string): Promise<boolean> =>
      openLaravelModelSourceTarget({
        className,
        canOpenLaravelModelSourceTargets,
        currentWorkspaceRootRef,
        openNavigationTarget,
        readNavigationFileContent,
        resolvePhpClassSourcePaths,
        resolveTarget: (source) =>
          phpLaravelDynamicWhereAttributeTargetFromSource(source, methodName),
        workspaceDescriptor,
        workspaceRoot,
      }),
    [
      canOpenLaravelModelSourceTargets,
      currentWorkspaceRootRef,
      openNavigationTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const openPhpLaravelModelAttributeTarget = useCallback(
    async (className: string, attributeName: string): Promise<boolean> =>
      openLaravelModelSourceTarget({
        className,
        canOpenLaravelModelSourceTargets,
        currentWorkspaceRootRef,
        openNavigationTarget,
        readNavigationFileContent,
        resolvePhpClassSourcePaths,
        resolveTarget: (source) =>
          phpLaravelModelAttributeTargetFromSource(source, attributeName) ??
          phpLaravelModelAccessorTargetFromSource(source, attributeName),
        workspaceDescriptor,
        workspaceRoot,
      }),
    [
      canOpenLaravelModelSourceTargets,
      currentWorkspaceRootRef,
      openNavigationTarget,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  return {
    findPhpLaravelValidationRuleModelTargets,
    openPhpLaravelDynamicWhereTarget,
    openPhpLaravelModelAttributeTarget,
  };
}

interface FindLaravelValidationRuleModelTargetsInput {
  canOpenLaravelModelSourceTargets: boolean;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  providers: readonly PhpFrameworkProvider[];
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassSourcePaths(className: string): Promise<readonly string[]>;
  tableName: string;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

async function findLaravelValidationRuleModelTargets({
  canOpenLaravelModelSourceTargets,
  currentWorkspaceRootRef,
  projectSymbolSearch,
  providers,
  readNavigationFileContent,
  resolvePhpClassSourcePaths,
  tableName,
  workspaceDescriptor,
  workspaceRoot,
}: FindLaravelValidationRuleModelTargetsInput): Promise<
  readonly PhpLaravelValidationRuleModelTarget[]
> {
  const requestedRoot = workspaceRoot;
  const requestedDescriptor = workspaceDescriptor;
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

  if (
    !canOpenLaravelModelSourceTargets ||
    !requestedRoot ||
    !requestedDescriptor?.php ||
    !tableName.trim()
  ) {
    return [];
  }

  let symbols;

  try {
    symbols = await projectSymbolSearch.searchProjectSymbols(
      requestedRoot,
      "",
      2000,
    );
  } catch {
    return [];
  }

  if (!isRequestedRootActive()) {
    return [];
  }

  const namespacePrefixes = phpFrameworkModelNamespacePrefixes(
    requestedDescriptor.php,
    providers,
  ).map((prefix) => prefix.toLowerCase());
  const modelSymbols = symbols.filter(
    (symbol) =>
      symbol.kind === "class" &&
      namespacePrefixes.some((prefix) =>
        symbol.fullyQualifiedName.toLowerCase().startsWith(prefix),
      ) &&
      workspaceRelativePath(requestedRoot, symbol.path) !== null,
  );
  const candidates: Array<{
    className: string;
    path: string;
    position: EditorPosition;
    source: string;
  }> = [];
  const seen = new Set<string>();

  for (const symbol of modelSymbols) {
    let paths: readonly string[];

    try {
      paths = await resolvePhpClassSourcePaths(symbol.fullyQualifiedName);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    for (const path of paths) {
      if (
        workspaceRelativePath(requestedRoot, path) === null ||
        seen.has(`${symbol.fullyQualifiedName.toLowerCase()}\0${path}`)
      ) {
        continue;
      }

      seen.add(`${symbol.fullyQualifiedName.toLowerCase()}\0${path}`);

      try {
        const source = await readNavigationFileContent(path);

        if (!isRequestedRootActive()) {
          return [];
        }

        candidates.push({
          className: symbol.fullyQualifiedName,
          path,
          position:
            path === symbol.path
              ? { column: symbol.column, lineNumber: symbol.lineNumber }
              : { column: 1, lineNumber: 1 },
          source,
        });
      } catch {
        if (!isRequestedRootActive()) {
          return [];
        }
      }
    }
  }

  return phpLaravelModelSourcesForTableName(tableName, candidates).map(
    (candidate) => ({
      label: candidate.className,
      path: candidate.path,
      position: candidate.position,
    }),
  );
}

interface LaravelModelSourceTarget {
  attributeName: string;
  position: EditorPosition;
}

interface OpenLaravelModelSourceTargetInput {
  className: string;
  canOpenLaravelModelSourceTargets: boolean;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ): Promise<boolean>;
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassSourcePaths(className: string): Promise<readonly string[]>;
  resolveTarget(source: string): LaravelModelSourceTarget | null;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

async function openLaravelModelSourceTarget({
  className,
  canOpenLaravelModelSourceTargets,
  currentWorkspaceRootRef,
  openNavigationTarget,
  readNavigationFileContent,
  resolvePhpClassSourcePaths,
  resolveTarget,
  workspaceDescriptor,
  workspaceRoot,
}: OpenLaravelModelSourceTargetInput): Promise<boolean> {
  const requestedRoot = workspaceRoot;
  const requestedDescriptor = workspaceDescriptor;
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

  if (
    !canOpenLaravelModelSourceTargets ||
    !requestedRoot ||
    !requestedDescriptor?.php
  ) {
    return false;
  }

  const normalizedClassName = className.trim().replace(/^\\+/, "");

  if (!normalizedClassName) {
    return false;
  }

  for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
    if (!isRequestedRootActive()) {
      return false;
    }

    try {
      const content = await readNavigationFileContent(path);

      if (!isRequestedRootActive()) {
        return false;
      }

      const target = resolveTarget(content);

      if (!target) {
        continue;
      }

      if (!isRequestedRootActive()) {
        return false;
      }

      return openNavigationTarget(path, target.position, target.attributeName);
    } catch {
      if (!isRequestedRootActive()) {
        return false;
      }

      continue;
    }
  }

  return false;
}
