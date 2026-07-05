import { useCallback, type MutableRefObject } from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import {
  phpClassPathCandidates,
  phpExtendsClassName,
  resolvePhpClassName,
} from "../domain/phpNavigation";
import {
  phpCurrentClassName,
} from "../domain/phpSemanticEngine";
import { phpDeclaredTypeCandidate } from "../domain/phpTypeAnalysis";
import {
  phpFrameworkContainerBindingsFromSource,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  isTypeProjectSymbol,
  type ProjectSymbolSearchGateway,
} from "../domain/projectSymbols";
import type {
  FileSearchGateway,
  IntelligenceMode,
  TextSearchGateway,
  WorkspaceDescriptor,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface UsePhpSemanticResolverOptions {
  activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  fileSearch: FileSearchGateway;
  intelligenceMode: IntelligenceMode;
  phpClassSourcePathCacheRef: MutableRefObject<Record<string, string[]>>;
  phpFrameworkBindingCacheRef: MutableRefObject<Record<string, string | null>>;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readNavigationFileContent: (path: string) => Promise<string>;
  textSearch: TextSearchGateway;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function usePhpSemanticResolver({
  activePhpFrameworkProviders,
  currentWorkspaceRootRef,
  fileSearch,
  intelligenceMode,
  phpClassSourcePathCacheRef,
  phpFrameworkBindingCacheRef,
  projectSymbolSearch,
  readNavigationFileContent,
  textSearch,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpSemanticResolverOptions) {
  const resolvePhpClassReference = useCallback(
    (source: string, className: string): string | null => {
      const classReference = className.trim();
      const normalizedClassName = classReference.replace(/^\\+/, "");

      if (!normalizedClassName) {
        return null;
      }

      if (
        normalizedClassName.toLowerCase() === "self" ||
        normalizedClassName.toLowerCase() === "static"
      ) {
        return phpCurrentClassName(source);
      }

      if (normalizedClassName.toLowerCase() === "parent") {
        const parentClassName = phpExtendsClassName(source);
        return parentClassName ? resolvePhpClassName(source, parentClassName) : null;
      }

      return resolvePhpClassName(source, classReference);
    },
    [],
  );

  const isKnownPhpNamespaceRootClassName = useCallback(
    (className: string): boolean => {
      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!workspaceDescriptor?.php || !normalizedClassName.includes("\\")) {
        return false;
      }

      const namespaceRoots = [
        ...workspaceDescriptor.php.psr4Roots,
        ...workspaceDescriptor.php.packages.flatMap((composerPackage) =>
          composerPackage.psr4Roots,
        ),
      ];

      return namespaceRoots.some((root) => {
        const namespace = root.namespace.trim().replace(/^\\+/, "");

        return Boolean(namespace && normalizedClassName.startsWith(namespace));
      });
    },
    [workspaceDescriptor],
  );

  const resolvePhpSemanticTypeReference = useCallback(
    (source: string, typeName: string | null): string | null => {
      const candidate = typeName ? phpDeclaredTypeCandidate(typeName) : null;

      if (!candidate) {
        return null;
      }

      return isKnownPhpNamespaceRootClassName(candidate)
        ? candidate
        : resolvePhpClassReference(source, candidate);
    },
    [isKnownPhpNamespaceRootClassName, resolvePhpClassReference],
  );

  const resolvePhpFrameworkReturnTypeReference = useCallback(
    (source: string, typeName: string | null): string | null => {
      const candidate = typeName ? phpDeclaredTypeCandidate(typeName) : null;

      if (!candidate) {
        return null;
      }

      if (candidate.includes("\\")) {
        return typeName;
      }

      return resolvePhpSemanticTypeReference(source, candidate);
    },
    [resolvePhpSemanticTypeReference],
  );

  const resolvePhpDeclaredType = useCallback(
    (source: string, typeName: string | null): string | null => {
      const rawTypeName = typeName?.trim() ?? "";
      const isFullyQualified = rawTypeName.replace(/^\?/, "").startsWith("\\");
      const candidate = typeName ? phpDeclaredTypeCandidate(typeName) : null;
      return candidate
        ? resolvePhpClassReference(source, isFullyQualified ? `\\${candidate}` : candidate)
        : null;
    },
    [resolvePhpClassReference],
  );

  const resolvePhpMethodDeclaredReturnType = useCallback(
    (
      source: string,
      typeName: string | null,
      lateStaticClassName: string,
      templateTypes: ReadonlyMap<string, string> = new Map(),
    ): string | null => {
      if (phpReturnTypeIncludesLateStatic(typeName)) {
        return lateStaticClassName || null;
      }

      const templateCandidate = typeName
        ? phpDeclaredTypeCandidate(typeName)
        : null;
      const templateType = templateCandidate
        ? templateTypes.get(templateCandidate.toLowerCase()) ?? null
        : null;

      if (templateType) {
        return templateType;
      }

      return resolvePhpDeclaredType(source, typeName);
    },
    [resolvePhpDeclaredType],
  );

  const resolvePhpFrameworkBoundConcrete = useCallback(
    async (className: string): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (
        !activePhpFrameworkProviders.length ||
        !requestedRoot ||
        !isRequestedRootActive()
      ) {
        return null;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return null;
      }

      const cacheKey = normalizedClassName.toLowerCase();

      if (
        Object.prototype.hasOwnProperty.call(
          phpFrameworkBindingCacheRef.current,
          cacheKey,
        )
      ) {
        return phpFrameworkBindingCacheRef.current[cacheKey] ?? null;
      }

      let concreteClassName: string | null = null;
      const shortName = shortPhpName(normalizedClassName);
      const results = await textSearch.searchText(
        requestedRoot,
        `${shortName}::class`,
        200,
      );

      if (!isRequestedRootActive()) {
        return null;
      }

      const visitedPaths = new Set<string>();

      for (const result of results) {
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

          for (const binding of phpFrameworkContainerBindingsFromSource(
            content,
            activePhpFrameworkProviders,
          )) {
            const abstractClassName = resolvePhpClassReference(
              content,
              binding.abstractClassName,
            );

            if (abstractClassName?.toLowerCase() !== cacheKey) {
              continue;
            }

            const resolvedConcreteClassName = resolvePhpClassReference(
              content,
              binding.concreteClassName,
            );

            if (resolvedConcreteClassName) {
              concreteClassName = resolvedConcreteClassName;
              break;
            }
          }
        } catch {
          if (!isRequestedRootActive()) {
            return null;
          }

          continue;
        }

        if (concreteClassName) {
          break;
        }
      }

      if (!isRequestedRootActive()) {
        return null;
      }

      if (concreteClassName) {
        phpFrameworkBindingCacheRef.current[cacheKey] = concreteClassName;
      }

      return concreteClassName;
    },
    [
      activePhpFrameworkProviders,
      currentWorkspaceRootRef,
      phpFrameworkBindingCacheRef,
      readNavigationFileContent,
      resolvePhpClassReference,
      textSearch,
      workspaceRoot,
    ],
  );

  const verifyPhpClassCandidatePaths = useCallback(
    async (
      candidatePaths: string[],
      normalizedClassName: string,
      isRequestedRootActive: () => boolean,
    ): Promise<string[]> => {
      const normalizedLookup = normalizedClassName.toLowerCase();
      const verified: string[] = [];
      const visited = new Set<string>();

      for (const path of candidatePaths) {
        if (!isRequestedRootActive()) {
          return [];
        }

        if (visited.has(path)) {
          continue;
        }

        visited.add(path);

        try {
          const content = await readNavigationFileContent(path);

          if (!isRequestedRootActive()) {
            return [];
          }

          if (
            phpCurrentClassName(content)?.toLowerCase() === normalizedLookup
          ) {
            verified.push(path);
          }
        } catch {
          if (!isRequestedRootActive()) {
            return [];
          }

          continue;
        }
      }

      return verified;
    },
    [readNavigationFileContent],
  );

  const findPhpClassSourcePathsByFileName = useCallback(
    async (className: string): Promise<string[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return [];
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const shortName = shortPhpName(normalizedClassName);
      const fileName = `${shortName}.php`;
      const results = await fileSearch.searchFiles(requestedRoot, fileName, 40);

      if (!isRequestedRootActive()) {
        return [];
      }

      const paths: string[] = [];

      for (const result of results) {
        if (!isRequestedRootActive()) {
          return [];
        }

        if (result.name.toLowerCase() !== fileName.toLowerCase()) {
          continue;
        }

        try {
          const content = await readNavigationFileContent(result.path);

          if (!isRequestedRootActive()) {
            return [];
          }

          const sourceClassName = phpCurrentClassName(content);

          if (sourceClassName?.toLowerCase() !== normalizedClassName.toLowerCase()) {
            continue;
          }

          paths.push(result.path);
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

      return paths;
    },
    [currentWorkspaceRootRef, fileSearch, readNavigationFileContent, workspaceRoot],
  );

  const resolvePhpClassSourcePaths = useCallback(
    async (className: string): Promise<string[]> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return [];
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");

      if (!normalizedClassName) {
        return [];
      }

      const candidatePaths = phpClassPathCandidates(
        requestedRoot,
        requestedDescriptor.php,
        normalizedClassName,
      );
      const paths = new Set(candidatePaths);
      let hasIndexedPath = false;

      if (shouldIndexWorkspace(intelligenceMode)) {
        const indexedSymbols = await projectSymbolSearch.searchProjectSymbols(
          requestedRoot,
          shortPhpName(normalizedClassName),
          50,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        const normalizedLookup = normalizedClassName.toLowerCase();

        for (const symbol of indexedSymbols) {
          if (!isRequestedRootActive()) {
            return [];
          }

          if (!isTypeProjectSymbol(symbol)) {
            continue;
          }

          if (symbol.fullyQualifiedName.toLowerCase() !== normalizedLookup) {
            continue;
          }

          hasIndexedPath = true;
          paths.add(symbol.path);
        }
      }

      if (!hasIndexedPath && candidatePaths.length > 0) {
        if (!isRequestedRootActive()) {
          return [];
        }

        const verifiedCandidates = await verifyPhpClassCandidatePaths(
          candidatePaths,
          normalizedClassName,
          isRequestedRootActive,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        if (verifiedCandidates.length > 0) {
          return verifiedCandidates;
        }
      }

      if (paths.size === 0 || !hasIndexedPath) {
        if (!isRequestedRootActive()) {
          return [];
        }

        const cacheKey = normalizedClassName.toLowerCase();
        const cachedPaths = phpClassSourcePathCacheRef.current[cacheKey];
        const fallbackPaths =
          cachedPaths ??
          (await findPhpClassSourcePathsByFileName(
            normalizedClassName,
          ));

        if (!isRequestedRootActive()) {
          return [];
        }

        if (!cachedPaths && fallbackPaths.length > 0) {
          phpClassSourcePathCacheRef.current[cacheKey] = fallbackPaths;
        }

        for (const path of fallbackPaths) {
          paths.add(path);
        }
      }

      if (!isRequestedRootActive()) {
        return [];
      }

      return [...paths];
    },
    [
      currentWorkspaceRootRef,
      findPhpClassSourcePathsByFileName,
      intelligenceMode,
      phpClassSourcePathCacheRef,
      projectSymbolSearch,
      verifyPhpClassCandidatePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  return {
    resolvePhpClassReference,
    resolvePhpClassSourcePaths,
    resolvePhpDeclaredType,
    resolvePhpFrameworkBoundConcrete,
    resolvePhpFrameworkReturnTypeReference,
    resolvePhpMethodDeclaredReturnType,
    resolvePhpSemanticTypeReference,
  };
}

function isPhpPath(path: string): boolean {
  return path.toLowerCase().endsWith(".php");
}

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}

function phpReturnTypeIncludesLateStatic(typeName: string | null): boolean {
  return Boolean(
    typeName
      ?.trim()
      .replace(/^\?/, "")
      .split(/[|&]/)
      .some((part) => {
        const normalized = part.trim().replace(/^\\+/, "").toLowerCase();

        return normalized === "static" || normalized === "$this";
      }),
  );
}
