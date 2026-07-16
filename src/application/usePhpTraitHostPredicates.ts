import { useCallback, useRef, type MutableRefObject } from "react";
import { phpExtendsClassName, phpCurrentTypeKind } from "../domain/phpNavigation";
import { phpCurrentClassName } from "../domain/phpSemanticEngine";
import type { TextSearchGateway } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

type PhpClassHierarchyPredicate = (
  className: string,
  memberName: string,
) => Promise<boolean>;

type PhpClassPropertyTypeResolver = (
  className: string,
  propertyName: string,
) => Promise<string | null>;

interface PhpTraitHostLookupOptions {
  classHierarchyHasMember(className: string): Promise<boolean>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  isPhpPath(path: string): boolean;
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassReference(source: string, className: string): string | null;
  searchText: TextSearchGateway["searchText"];
  traitClassName: string;
  workspaceRoot: string;
}

interface PhpTraitHostClassNameResolverOptions {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  isRequestStillCurrent(): boolean;
  isPhpPath(path: string): boolean;
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassReference(source: string, className: string): string | null;
  searchText: TextSearchGateway["searchText"];
  workspaceRoot: string;
}

interface UsePhpTraitHostPredicatesOptions {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  isPhpPath(path: string): boolean;
  phpClassHierarchyHasConstant: PhpClassHierarchyPredicate;
  phpClassHierarchyHasMethod: PhpClassHierarchyPredicate;
  phpClassHierarchyHasProperty: PhpClassHierarchyPredicate;
  readNavigationFileContent(path: string): Promise<string>;
  resolvePhpClassReference(source: string, className: string): string | null;
  resolvePhpClassPropertyOrRelationType: PhpClassPropertyTypeResolver;
  searchText: TextSearchGateway["searchText"];
  workspaceRoot: string | null;
}

export function usePhpTraitHostPredicates({
  currentWorkspaceRootRef,
  isPhpPath,
  phpClassHierarchyHasConstant,
  phpClassHierarchyHasMethod,
  phpClassHierarchyHasProperty,
  readNavigationFileContent,
  resolvePhpClassReference,
  resolvePhpClassPropertyOrRelationType,
  searchText,
  workspaceRoot,
}: UsePhpTraitHostPredicatesOptions) {
  const phpTraitHostClassNamesCacheRef = useRef<Record<string, string[]>>({});
  const phpTraitHostClassNamesInFlightRef = useRef<
    Record<string, Promise<string[]>>
  >({});
  const phpTraitHostGenerationByRootRef = useRef<Record<string, number>>({});
  const invalidatePhpTraitHostClassNames = useCallback(
    (root: string | null = workspaceRoot): void => {
      if (!root) {
        return;
      }

      const rootPrefix = `${root}\0`;
      phpTraitHostGenerationByRootRef.current[root] =
        (phpTraitHostGenerationByRootRef.current[root] ?? 0) + 1;

      for (const cacheKey of Object.keys(phpTraitHostClassNamesCacheRef.current)) {
        if (cacheKey.startsWith(rootPrefix)) {
          delete phpTraitHostClassNamesCacheRef.current[cacheKey];
        }
      }
    },
    [workspaceRoot],
  );
  const resolvePhpTraitHostClassNames = useCallback(
    async (traitClassName: string): Promise<string[]> => {
      const normalizedTraitClassName = traitClassName
        .trim()
        .replace(/^\\+/, "");

      if (!workspaceRoot || !normalizedTraitClassName) {
        return [];
      }

      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot) &&
        (phpTraitHostGenerationByRootRef.current[workspaceRoot] ?? 0) ===
          generation;
      const generation =
        phpTraitHostGenerationByRootRef.current[workspaceRoot] ?? 0;

      if (!isRequestedRootActive()) {
        return [];
      }

      const cacheKey = `${workspaceRoot}\0${generation}\0${normalizedTraitClassName.toLowerCase()}`;
      const cached = phpTraitHostClassNamesCacheRef.current[cacheKey];

      if (cached) {
        return isRequestedRootActive() ? cached : [];
      }

      const inFlight = phpTraitHostClassNamesInFlightRef.current[cacheKey];

      if (inFlight) {
        const classNames = await inFlight;
        return isRequestedRootActive() ? classNames : [];
      }

      const request = collectPhpTraitHostClassNames({
        currentWorkspaceRootRef,
        isRequestStillCurrent: isRequestedRootActive,
        isPhpPath,
        readNavigationFileContent,
        resolvePhpClassReference,
        searchText,
        traitClassName: normalizedTraitClassName,
        workspaceRoot,
      }).then((classNames) => {
        if (!isRequestedRootActive()) {
          return [];
        }

        phpTraitHostClassNamesCacheRef.current[cacheKey] = classNames;
        return classNames;
      });

      phpTraitHostClassNamesInFlightRef.current[cacheKey] = request;

      try {
        return await request;
      } finally {
        if (phpTraitHostClassNamesInFlightRef.current[cacheKey] === request) {
          delete phpTraitHostClassNamesInFlightRef.current[cacheKey];
        }
      }
    },
    [
      currentWorkspaceRootRef,
      isPhpPath,
      readNavigationFileContent,
      resolvePhpClassReference,
      searchText,
      workspaceRoot,
    ],
  );

  const phpTraitHostMethodExists = useCallback(
    async (traitClassName: string, methodName: string): Promise<boolean> => {
      const normalizedMethodName = methodName.trim();

      if (!workspaceRoot || !normalizedMethodName) {
        return false;
      }

      return traitHostHierarchyHasMember({
        classHierarchyHasMember: (className) =>
          phpClassHierarchyHasMethod(className, normalizedMethodName),
        currentWorkspaceRootRef,
        isPhpPath,
        readNavigationFileContent,
        resolvePhpClassReference,
        searchText,
        traitClassName,
        workspaceRoot,
        resolvePhpTraitHostClassNames,
      });
    },
    [
      currentWorkspaceRootRef,
      isPhpPath,
      phpClassHierarchyHasMethod,
      readNavigationFileContent,
      resolvePhpClassReference,
      searchText,
      workspaceRoot,
      resolvePhpTraitHostClassNames,
    ],
  );

  const phpTraitHostPropertyExists = useCallback(
    async (traitClassName: string, propertyName: string): Promise<boolean> => {
      const normalizedPropertyName = propertyName.trim().replace(/^\$+/, "");

      if (!workspaceRoot || !normalizedPropertyName) {
        return false;
      }

      return traitHostHierarchyHasMember({
        classHierarchyHasMember: (className) =>
          phpClassHierarchyHasProperty(className, normalizedPropertyName),
        currentWorkspaceRootRef,
        isPhpPath,
        readNavigationFileContent,
        resolvePhpClassReference,
        searchText,
        traitClassName,
        workspaceRoot,
        resolvePhpTraitHostClassNames,
      });
    },
    [
      currentWorkspaceRootRef,
      isPhpPath,
      phpClassHierarchyHasProperty,
      readNavigationFileContent,
      resolvePhpClassReference,
      searchText,
      workspaceRoot,
      resolvePhpTraitHostClassNames,
    ],
  );

  const phpTraitHostPropertyMethodExists = useCallback(
    async (
      traitClassName: string,
      propertyName: string,
      methodName: string,
    ): Promise<boolean> => {
      const normalizedPropertyName = propertyName.trim().replace(/^\$+/, "");
      const normalizedMethodName = methodName.trim();

      if (!workspaceRoot || !normalizedPropertyName || !normalizedMethodName) {
        return false;
      }

      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot);

      return traitHostHierarchyHasMember({
        classHierarchyHasMember: async (className) => {
          const propertyType = await resolvePhpClassPropertyOrRelationType(
            className,
            normalizedPropertyName,
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          if (!propertyType) {
            return false;
          }

          const hasMethod = await phpClassHierarchyHasMethod(
            propertyType,
            normalizedMethodName,
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          return hasMethod;
        },
        currentWorkspaceRootRef,
        isPhpPath,
        readNavigationFileContent,
        resolvePhpClassReference,
        searchText,
        traitClassName,
        workspaceRoot,
        resolvePhpTraitHostClassNames,
      });
    },
    [
      currentWorkspaceRootRef,
      isPhpPath,
      phpClassHierarchyHasMethod,
      readNavigationFileContent,
      resolvePhpClassPropertyOrRelationType,
      resolvePhpClassReference,
      searchText,
      workspaceRoot,
      resolvePhpTraitHostClassNames,
    ],
  );

  const phpTraitHostConstantExists = useCallback(
    async (traitClassName: string, constantName: string): Promise<boolean> => {
      const normalizedConstantName = constantName.trim();

      if (!workspaceRoot || !normalizedConstantName) {
        return false;
      }

      return traitHostHierarchyHasMember({
        classHierarchyHasMember: (className) =>
          phpClassHierarchyHasConstant(className, normalizedConstantName),
        currentWorkspaceRootRef,
        isPhpPath,
        readNavigationFileContent,
        resolvePhpClassReference,
        searchText,
        traitClassName,
        workspaceRoot,
        resolvePhpTraitHostClassNames,
      });
    },
    [
      currentWorkspaceRootRef,
      isPhpPath,
      phpClassHierarchyHasConstant,
      readNavigationFileContent,
      resolvePhpClassReference,
      searchText,
      workspaceRoot,
      resolvePhpTraitHostClassNames,
    ],
  );

  return {
    invalidatePhpTraitHostClassNames,
    phpTraitHostConstantExists,
    phpTraitHostMethodExists,
    phpTraitHostPropertyExists,
    phpTraitHostPropertyMethodExists,
    resolvePhpTraitHostClassNames,
  };
}

async function traitHostHierarchyHasMember({
  classHierarchyHasMember,
  currentWorkspaceRootRef,
  isPhpPath,
  readNavigationFileContent,
  resolvePhpClassReference,
  searchText,
  traitClassName,
  workspaceRoot,
  resolvePhpTraitHostClassNames,
}: PhpTraitHostLookupOptions & {
  resolvePhpTraitHostClassNames(traitClassName: string): Promise<string[]>;
}): Promise<boolean> {
  const normalizedTraitClassName = traitClassName.trim().replace(/^\\+/, "");
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot);

  if (!normalizedTraitClassName) {
    return false;
  }

  const descendantClassHierarchyHasMember = async (
    className: string,
    visitedClassNames = new Set<string>(),
  ): Promise<boolean> => {
    const normalizedClassName = className.trim().replace(/^\\+/, "");
    const classLookup = normalizedClassName.toLowerCase();

    if (
      !normalizedClassName ||
      visitedClassNames.has(classLookup) ||
      visitedClassNames.size >= 200
    ) {
      return false;
    }

    visitedClassNames.add(classLookup);

    const results = await searchText(
      workspaceRoot,
      shortPhpName(normalizedClassName),
      200,
    );

    if (!isRequestedRootActive()) {
      return false;
    }

    const visitedPaths = new Set<string>();

    for (const result of results) {
      if (!isRequestedRootActive()) {
        return false;
      }

      if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
        continue;
      }

      visitedPaths.add(result.path);

      try {
        const content = await readNavigationFileContent(result.path);

        if (!isRequestedRootActive()) {
          return false;
        }

        if (phpCurrentTypeKind(content) !== "class") {
          continue;
        }

        const candidateClassName = phpCurrentClassName(content);
        const parentClassName = phpExtendsClassName(content);
        const resolvedParentClassName = parentClassName
          ? resolvePhpClassReference(content, parentClassName)
          : null;

        if (
          !candidateClassName ||
          resolvedParentClassName?.toLowerCase() !== classLookup
        ) {
          continue;
        }

        const directHierarchyHasMember =
          await classHierarchyHasMember(candidateClassName);

        if (!isRequestedRootActive()) {
          return false;
        }

        if (directHierarchyHasMember) {
          return true;
        }

        const descendantHierarchyHasMember =
          await descendantClassHierarchyHasMember(
            candidateClassName,
            visitedClassNames,
          );

        if (!isRequestedRootActive()) {
          return false;
        }

        if (descendantHierarchyHasMember) {
          return true;
        }
      } catch {
        if (!isRequestedRootActive()) {
          return false;
        }

        continue;
      }
    }

    if (!isRequestedRootActive()) {
      return false;
    }

    return false;
  };

  const hostClassNames = await resolvePhpTraitHostClassNames(
    normalizedTraitClassName,
  );

  if (!isRequestedRootActive()) {
    return false;
  }

  for (const hostClassName of hostClassNames) {
    const directHierarchyHasMember = await classHierarchyHasMember(hostClassName);

    if (!isRequestedRootActive()) {
      return false;
    }

    if (directHierarchyHasMember) {
      return true;
    }

    const descendantHierarchyHasMember = await descendantClassHierarchyHasMember(
      hostClassName,
      new Set<string>(),
    );

    if (!isRequestedRootActive()) {
      return false;
    }

    if (descendantHierarchyHasMember) {
      return true;
    }
  }

  return false;
}

async function collectPhpTraitHostClassNames({
  currentWorkspaceRootRef,
  isRequestStillCurrent,
  isPhpPath,
  readNavigationFileContent,
  resolvePhpClassReference,
  searchText,
  traitClassName,
  workspaceRoot,
}: PhpTraitHostClassNameResolverOptions & {
  traitClassName: string;
}): Promise<string[]> {
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot) &&
    isRequestStillCurrent();
  const hostClassNames = new Map<string, string>();
  const visitedTraitClassNames = new Set<string>();

  const collectConcreteUsers = async (
    targetTraitClassName: string,
  ): Promise<void> => {
    const normalizedTraitClassName = targetTraitClassName
      .trim()
      .replace(/^\\+/, "");
    const traitLookup = normalizedTraitClassName.toLowerCase();

    if (
      !normalizedTraitClassName ||
      visitedTraitClassNames.has(traitLookup) ||
      visitedTraitClassNames.size >= 200
    ) {
      return;
    }

    visitedTraitClassNames.add(traitLookup);
    const results = await searchText(
      workspaceRoot,
      shortPhpName(normalizedTraitClassName),
      200,
    );

    if (!isRequestedRootActive()) {
      return;
    }

    const visitedPaths = new Set<string>();

    for (const result of results) {
      if (!isRequestedRootActive()) {
        return;
      }

      if (visitedPaths.has(result.path) || !isPhpPath(result.path)) {
        continue;
      }

      visitedPaths.add(result.path);

      try {
        const content = await readNavigationFileContent(result.path);

        if (!isRequestedRootActive()) {
          return;
        }

        if (
          !phpSourceUsesTrait(
            content,
            normalizedTraitClassName,
            resolvePhpClassReference,
          )
        ) {
          continue;
        }

        const userTypeKind = phpCurrentTypeKind(content);
        const userClassName = phpCurrentClassName(content);

        if (!userTypeKind || !userClassName) {
          continue;
        }

        if (userTypeKind === "trait") {
          await collectConcreteUsers(userClassName);

          if (!isRequestedRootActive()) {
            return;
          }

          continue;
        }

        if (userTypeKind !== "class" && userTypeKind !== "enum") {
          continue;
        }

        hostClassNames.set(userClassName.toLowerCase(), userClassName);
      } catch {
        if (!isRequestedRootActive()) {
          return;
        }
      }
    }
  };

  await collectConcreteUsers(traitClassName);

  if (!isRequestedRootActive()) {
    return [];
  }

  return Array.from(hostClassNames.values()).sort((left, right) =>
    left.localeCompare(right),
  );
}

function phpSourceUsesTrait(
  source: string,
  traitClassName: string,
  resolvePhpClassReference: (
    source: string,
    className: string,
  ) => string | null,
): boolean {
  const traitLookup = traitClassName.toLowerCase();
  const declaringClassName = phpCurrentClassName(source);
  const declaringTypeKind = phpCurrentTypeKind(source);

  if (!declaringClassName || !declaringTypeKind) {
    return false;
  }

  const directBody = phpDirectNamedTypeBody(
    source,
    shortPhpName(declaringClassName),
    declaringTypeKind,
  );

  if (!directBody) {
    return false;
  }

  for (const match of directBody.matchAll(/(?:^|\n)\s*use\s+([^;{]+)\s*(?:;|\{)/g)) {
    for (const candidateTraitName of (match[1] ?? "").split(",")) {
      const resolvedTraitName = resolvePhpClassReference(
        source,
        candidateTraitName.trim(),
      );

      if (resolvedTraitName?.toLowerCase() === traitLookup) {
        return true;
      }
    }
  }

  return false;
}

function phpDirectNamedTypeBody(
  source: string,
  typeName: string,
  typeKind: "class" | "enum" | "interface" | "trait",
): string | null {
  const masked = maskPhpStringsAndComments(source);
  const pattern = new RegExp(
    `\\b${typeKind}\\s+${escapeRegExp(typeName)}\\b`,
    "g",
  );
  const declaration = pattern.exec(masked);

  if (!declaration) {
    return null;
  }

  const bodyStart = masked.indexOf("{", declaration.index + declaration[0].length);

  if (bodyStart < 0) {
    return null;
  }

  const bodyEnd = phpMatchingBraceOffset(masked, bodyStart);

  if (bodyEnd === null) {
    return null;
  }

  const body = source.slice(bodyStart + 1, bodyEnd);
  const maskedBody = masked.slice(bodyStart + 1, bodyEnd);
  let depth = 0;
  let directBody = "";

  for (let index = 0; index < body.length; index += 1) {
    const character = maskedBody[index] ?? "";

    if (character === "{") {
      if (depth === 0) {
        directBody += body[index] ?? "";
      }

      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        directBody += body[index] ?? "";
      }

      continue;
    }

    directBody += depth === 0 ? body[index] ?? "" : character === "\n" ? "\n" : " ";
  }

  return directBody;
}

function phpMatchingBraceOffset(source: string, openOffset: number): number | null {
  let depth = 0;

  for (let index = openOffset; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
      continue;
    }

    if (source[index] !== "}") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function maskPhpStringsAndComments(source: string): string {
  let masked = "";
  let quote: "'" | '"' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const nextCharacter = source[index + 1] ?? "";

    if (lineComment) {
      lineComment = character !== "\n";
      masked += character === "\n" ? "\n" : " ";
      continue;
    }

    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        masked += "  ";
        index += 1;
        blockComment = false;
        continue;
      }

      masked += character === "\n" ? "\n" : " ";
      continue;
    }

    if (quote) {
      if (character === "\\") {
        masked += "  ";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      masked += " ";
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      masked += "  ";
      index += 1;
      lineComment = true;
      continue;
    }

    if (character === "#") {
      masked += " ";
      lineComment = true;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      masked += "  ";
      index += 1;
      blockComment = true;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      masked += " ";
      continue;
    }

    masked += character;
  }

  return masked;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}
