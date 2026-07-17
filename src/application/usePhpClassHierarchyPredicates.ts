import { useCallback, type MutableRefObject } from "react";
import {
  phpMixinClassNames,
  phpTraitClassNames,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import {
  phpMethodPositionOrNull,
  phpSuperTypeReferences,
} from "../domain/phpNavigation";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

interface PhpClassMemberReadResult {
  content: string;
  members: PhpMethodCompletion[];
}

interface UsePhpClassHierarchyPredicatesOptions {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  readPhpClassMembersFromPath: (
    path: string,
    className: string,
  ) => Promise<PhpClassMemberReadResult>;
  resolvePhpClassReference: (source: string, className: string) => string | null;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function usePhpClassHierarchyPredicates({
  currentWorkspaceRootRef,
  readPhpClassMembersFromPath,
  resolvePhpClassReference,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpClassHierarchyPredicatesOptions) {
  const phpClassHierarchyHasMethod = useCallback(
    async (
      className: string,
      methodName: string,
      visitedClassNames = new Set<string>(),
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const normalizedMethodName = methodName.trim();
      const methodLookup = normalizedMethodName.toLowerCase();
      const visitedKey = normalizedClassName.toLowerCase();

      if (
        !normalizedClassName ||
        !normalizedMethodName ||
        visitedClassNames.has(visitedKey)
      ) {
        return false;
      }

      visitedClassNames.add(visitedKey);

      if (!isRequestedRootActive()) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          if (
            phpMethodPositionOrNull(content, normalizedMethodName) ||
            members.some(
              (member) =>
                member.kind !== "property" &&
                !member.isStatic &&
                member.name.toLowerCase() === methodLookup,
            )
          ) {
            return true;
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(
              content,
              traitName,
            );

            if (
              resolvedTraitName &&
              (await phpClassHierarchyHasMethod(
                resolvedTraitName,
                normalizedMethodName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(
              content,
              mixinName,
            );

            if (
              resolvedMixinName &&
              (await phpClassHierarchyHasMethod(
                resolvedMixinName,
                normalizedMethodName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );

            if (
              resolvedSuperTypeName &&
              (await phpClassHierarchyHasMethod(
                resolvedSuperTypeName,
                normalizedMethodName,
                visitedClassNames,
              ))
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

      if (!isRequestedRootActive()) {
        return false;
      }

      return false;
    },
    [
      currentWorkspaceRootRef,
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const phpClassHierarchyHasStaticMethod = useCallback(
    async (
      className: string,
      methodName: string,
      visitedClassNames = new Set<string>(),
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const normalizedMethodName = methodName.trim().toLowerCase();
      const visitedKey = normalizedClassName.toLowerCase();

      if (
        !normalizedClassName ||
        !normalizedMethodName ||
        visitedClassNames.has(visitedKey)
      ) {
        return false;
      }

      visitedClassNames.add(visitedKey);

      if (!isRequestedRootActive()) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          if (
            members.some(
              (member) =>
                member.isStatic &&
                member.name.toLowerCase() === normalizedMethodName,
            )
          ) {
            return true;
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(
              content,
              traitName,
            );

            if (
              resolvedTraitName &&
              (await phpClassHierarchyHasStaticMethod(
                resolvedTraitName,
                methodName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(
              content,
              mixinName,
            );

            if (
              resolvedMixinName &&
              (await phpClassHierarchyHasStaticMethod(
                resolvedMixinName,
                methodName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );

            if (
              resolvedSuperTypeName &&
              (await phpClassHierarchyHasStaticMethod(
                resolvedSuperTypeName,
                methodName,
                visitedClassNames,
              ))
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

      if (!isRequestedRootActive()) {
        return false;
      }

      return false;
    },
    [
      currentWorkspaceRootRef,
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const phpClassHierarchyHasProperty = useCallback(
    async (
      className: string,
      propertyName: string,
      visitedClassNames = new Set<string>(),
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const normalizedPropertyName = propertyName.trim().replace(/^\$+/, "");
      const visitedKey = normalizedClassName.toLowerCase();

      if (
        !normalizedClassName ||
        !normalizedPropertyName ||
        visitedClassNames.has(visitedKey)
      ) {
        return false;
      }

      visitedClassNames.add(visitedKey);

      if (!isRequestedRootActive()) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const { content, members } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          if (
            phpClassSourceHasDeclaredProperty(content, normalizedPropertyName) ||
            members.some(
              (member) =>
                member.kind === "property" &&
                member.name === normalizedPropertyName,
            )
          ) {
            return true;
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(
              content,
              traitName,
            );

            if (
              resolvedTraitName &&
              (await phpClassHierarchyHasProperty(
                resolvedTraitName,
                normalizedPropertyName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(
              content,
              mixinName,
            );

            if (
              resolvedMixinName &&
              (await phpClassHierarchyHasProperty(
                resolvedMixinName,
                normalizedPropertyName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );

            if (
              resolvedSuperTypeName &&
              (await phpClassHierarchyHasProperty(
                resolvedSuperTypeName,
                normalizedPropertyName,
                visitedClassNames,
              ))
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

      if (!isRequestedRootActive()) {
        return false;
      }

      return false;
    },
    [
      currentWorkspaceRootRef,
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const phpClassHierarchyHasConstant = useCallback(
    async (
      className: string,
      constantName: string,
      visitedClassNames = new Set<string>(),
    ): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !requestedDescriptor?.php) {
        return false;
      }

      const normalizedClassName = className.trim().replace(/^\\+/, "");
      const normalizedConstantName = constantName.trim();
      const visitedKey = normalizedClassName.toLowerCase();

      if (
        !normalizedClassName ||
        !normalizedConstantName ||
        visitedClassNames.has(visitedKey)
      ) {
        return false;
      }

      visitedClassNames.add(visitedKey);

      if (!isRequestedRootActive()) {
        return false;
      }

      for (const path of await resolvePhpClassSourcePaths(normalizedClassName)) {
        if (!isRequestedRootActive()) {
          return false;
        }

        try {
          const { content } = await readPhpClassMembersFromPath(
            path,
            normalizedClassName,
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          if (phpClassSourceHasDeclaredConstant(content, normalizedConstantName)) {
            return true;
          }

          for (const traitName of phpTraitClassNames(content)) {
            const resolvedTraitName = resolvePhpClassReference(
              content,
              traitName,
            );

            if (
              resolvedTraitName &&
              (await phpClassHierarchyHasConstant(
                resolvedTraitName,
                normalizedConstantName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const mixinName of phpMixinClassNames(content)) {
            const resolvedMixinName = resolvePhpClassReference(
              content,
              mixinName,
            );

            if (
              resolvedMixinName &&
              (await phpClassHierarchyHasConstant(
                resolvedMixinName,
                normalizedConstantName,
                visitedClassNames,
              ))
            ) {
              return true;
            }

            if (!isRequestedRootActive()) {
              return false;
            }
          }

          for (const superTypeName of phpSuperTypeReferences(content)) {
            const resolvedSuperTypeName = resolvePhpClassReference(
              content,
              superTypeName,
            );

            if (
              resolvedSuperTypeName &&
              (await phpClassHierarchyHasConstant(
                resolvedSuperTypeName,
                normalizedConstantName,
                visitedClassNames,
              ))
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

      if (!isRequestedRootActive()) {
        return false;
      }

      return false;
    },
    [
      currentWorkspaceRootRef,
      readPhpClassMembersFromPath,
      resolvePhpClassReference,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  return {
    phpClassHierarchyHasConstant,
    phpClassHierarchyHasMethod,
    phpClassHierarchyHasProperty,
    phpClassHierarchyHasStaticMethod,
  };
}

function phpClassSourceHasDeclaredProperty(
  source: string,
  propertyName: string,
): boolean {
  const normalizedPropertyName = propertyName.trim().replace(/^\$+/, "");

  if (!normalizedPropertyName) {
    return false;
  }

  const escapedPropertyName = escapeRegExp(normalizedPropertyName);
  const docPropertyPattern = new RegExp(
    String.raw`@(?:(?:phpstan|psalm)-)?property(?:-read|-write)?\s+[^\r\n*]+?\s+\$${escapedPropertyName}\b`,
  );
  const declaredPropertyPattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:(?:public|protected|private|readonly|static|var)\s+)*(?:\??[\\A-Za-z_][\\A-Za-z0-9_]*(?:\|[\\A-Za-z_][\\A-Za-z0-9_]*)?\s+)?\$${escapedPropertyName}\b`,
  );

  return (
    docPropertyPattern.test(source) || declaredPropertyPattern.test(source)
  );
}

function phpClassSourceHasDeclaredConstant(
  source: string,
  constantName: string,
): boolean {
  const normalizedConstantName = constantName.trim();

  if (!normalizedConstantName) {
    return false;
  }

  const escapedConstantName = escapeRegExp(normalizedConstantName);
  const declaredConstantPattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:(?:final|public|protected|private)\s+)*const\b[^\r\n;]*\b${escapedConstantName}\b`,
    "i",
  );

  return declaredConstantPattern.test(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
