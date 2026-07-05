import { useCallback, type MutableRefObject } from "react";
import { phpTraitClassNames } from "../domain/phpMethodCompletions";
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
    ],
  );

  return {
    phpTraitHostConstantExists,
    phpTraitHostMethodExists,
    phpTraitHostPropertyExists,
    phpTraitHostPropertyMethodExists,
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
}: PhpTraitHostLookupOptions): Promise<boolean> {
  const normalizedTraitClassName = traitClassName.trim().replace(/^\\+/, "");
  const isRequestedRootActive = () =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, workspaceRoot);

  if (!normalizedTraitClassName) {
    return false;
  }

  const sourceUsesTrait = (
    source: string,
    targetTraitClassName: string,
  ): boolean => {
    const targetLookup = targetTraitClassName.toLowerCase();

    return phpTraitClassNames(source).some((candidateTraitName) => {
      const resolvedTraitName = resolvePhpClassReference(
        source,
        candidateTraitName,
      );

      return resolvedTraitName?.toLowerCase() === targetLookup;
    });
  };

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

  const traitConcreteUserHierarchyHasMember = async (
    targetTraitClassName: string,
    visitedTraitClassNames = new Set<string>(),
  ): Promise<boolean> => {
    const normalizedTargetTraitClassName = targetTraitClassName
      .trim()
      .replace(/^\\+/, "");
    const traitLookup = normalizedTargetTraitClassName.toLowerCase();

    if (
      !normalizedTargetTraitClassName ||
      visitedTraitClassNames.has(traitLookup) ||
      visitedTraitClassNames.size >= 200
    ) {
      return false;
    }

    visitedTraitClassNames.add(traitLookup);

    const results = await searchText(
      workspaceRoot,
      shortPhpName(normalizedTargetTraitClassName),
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

        if (!sourceUsesTrait(content, normalizedTargetTraitClassName)) {
          continue;
        }

        const userTypeKind = phpCurrentTypeKind(content);
        const userClassName = phpCurrentClassName(content);

        if (!userTypeKind || !userClassName) {
          continue;
        }

        if (userTypeKind === "trait") {
          const nestedTraitHierarchyHasMember =
            await traitConcreteUserHierarchyHasMember(
              userClassName,
              visitedTraitClassNames,
            );

          if (!isRequestedRootActive()) {
            return false;
          }

          if (nestedTraitHierarchyHasMember) {
            return true;
          }

          continue;
        }

        if (userTypeKind !== "class" && userTypeKind !== "enum") {
          continue;
        }

        const directHierarchyHasMember =
          await classHierarchyHasMember(userClassName);

        if (!isRequestedRootActive()) {
          return false;
        }

        if (directHierarchyHasMember) {
          return true;
        }

        if (userTypeKind !== "class") {
          continue;
        }

        const descendantHierarchyHasMember =
          await descendantClassHierarchyHasMember(
            userClassName,
            new Set<string>(),
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

  const exists = await traitConcreteUserHierarchyHasMember(
    normalizedTraitClassName,
  );

  if (!isRequestedRootActive()) {
    return false;
  }

  return exists;
}

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}
