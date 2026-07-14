import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpLaravelModelSourcesForTableName } from "../domain/phpFrameworkLaravel";
import {
  phpFrameworkModelNamespacePrefixes,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { type ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpFrameworkModelNavigationTargetsDependencies {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  providers: readonly PhpFrameworkProvider[];
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassSourcePaths(className: string): Promise<readonly string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface PhpFrameworkModelNavigationTargets {
  findValidationRuleModelTargets(
    tableName: string,
  ): Promise<readonly PhpFrameworkValidationRuleModelTarget[]>;
}

export interface PhpFrameworkValidationRuleModelTarget {
  label: string;
  path: string;
  position: EditorPosition;
}

export function usePhpFrameworkModelNavigationTargets({
  currentWorkspaceRootRef,
  frameworkRuntime,
  projectSymbolSearch,
  providers,
  readNavigationFileContent,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: PhpFrameworkModelNavigationTargetsDependencies): PhpFrameworkModelNavigationTargets {
  const canFindValidationRuleModelTargets =
    frameworkRuntime.providers.length > 0 && frameworkRuntime.supports("validation");

  const findValidationRuleModelTargets = useCallback(
    async (
      tableName: string,
    ): Promise<readonly PhpFrameworkValidationRuleModelTarget[]> =>
      findFrameworkValidationRuleModelTargets({
        canFindValidationRuleModelTargets,
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
      canFindValidationRuleModelTargets,
      currentWorkspaceRootRef,
      projectSymbolSearch,
      providers,
      readNavigationFileContent,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  return {
    findValidationRuleModelTargets,
  };
}

interface FindFrameworkValidationRuleModelTargetsInput {
  canFindValidationRuleModelTargets: boolean;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  providers: readonly PhpFrameworkProvider[];
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassSourcePaths(className: string): Promise<readonly string[]>;
  tableName: string;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

async function findFrameworkValidationRuleModelTargets({
  canFindValidationRuleModelTargets,
  currentWorkspaceRootRef,
  projectSymbolSearch,
  providers,
  readNavigationFileContent,
  resolvePhpClassSourcePaths,
  tableName,
  workspaceDescriptor,
  workspaceRoot,
}: FindFrameworkValidationRuleModelTargetsInput): Promise<
  readonly PhpFrameworkValidationRuleModelTarget[]
> {
  const requestedRoot = workspaceRoot;
  const requestedDescriptor = workspaceDescriptor;
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

  if (
    !canFindValidationRuleModelTargets ||
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
