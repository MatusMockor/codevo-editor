import { useCallback } from "react";
import { parsePhpClassStructure } from "../domain/phpClassStructure";
import { phpMethodSignatureKey } from "../domain/phpCodeGen";
import { phpTraitClassNames } from "../domain/phpMethodCompletions";
import {
  phpExtendsClassName,
  phpSuperTypeReferences,
  resolvePhpClassName,
} from "../domain/phpNavigation";
import {
  isPhpOverridableParentMethod,
  type AbstractMemberToImplement,
} from "./phpInheritedMemberCodeActions";
import type {
  PhpAbstractMembersCollector,
  PhpOverridableParentMethodsCollector,
} from "./phpInheritedMemberCodeActions";

export interface UsePhpInheritedMemberCollectorOptions {
  readNavigationFileContent: (path: string) => Promise<string>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
}

export interface PhpInheritedMemberCollectors {
  collectPhpAbstractMembersToImplement: PhpAbstractMembersCollector;
  collectPhpOverridableParentMethods: PhpOverridableParentMethodsCollector;
}

export function usePhpInheritedMemberCollector({
  readNavigationFileContent,
  resolvePhpClassSourcePaths,
}: UsePhpInheritedMemberCollectorOptions): PhpInheritedMemberCollectors {
  const collectPhpAbstractMembersToImplement = useCallback(
    async (
      source: string,
      isRequestedRootActive: () => boolean,
    ): Promise<{
      abstractMembers: Map<string, AbstractMemberToImplement>;
      conflictingNames: Set<string>;
      satisfiedNames: Set<string>;
    } | null> => {
      const abstractMembers = new Map<string, AbstractMemberToImplement>();
      const conflictingNames = new Set<string>();
      const satisfiedNames = new Set<string>();
      const visitedClassNames = new Set<string>();

      const collectSuperType = async (
        ownerSource: string,
        reference: string,
        includePrivateSatisfied: boolean,
      ): Promise<boolean> => {
        const resolvedClassName = resolvePhpClassName(ownerSource, reference);

        if (!resolvedClassName) {
          return true;
        }

        const normalizedClassName = resolvedClassName
          .trim()
          .replace(/^\\+/, "");
        const visitedKey = normalizedClassName.toLowerCase();

        if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
          return true;
        }

        visitedClassNames.add(visitedKey);

        if (!isRequestedRootActive()) {
          return false;
        }

        for (const path of await resolvePhpClassSourcePaths(
          normalizedClassName,
        )) {
          if (!isRequestedRootActive()) {
            return false;
          }

          try {
            const content = await readNavigationFileContent(path);

            if (!isRequestedRootActive()) {
              return false;
            }

            const structure = parsePhpClassStructure(
              content,
              shortPhpName(normalizedClassName),
            );

            for (const method of structure.methods) {
              const memberKey = method.name.toLowerCase();

              if (method.isAbstract) {
                const existing = abstractMembers.get(memberKey);

                if (
                  existing &&
                  inheritedSignaturesDisagree(existing, content, method)
                ) {
                  conflictingNames.add(memberKey);
                }

                if (!existing) {
                  abstractMembers.set(memberKey, {
                    declaringSource: content,
                    declaringTypeName:
                      structure.typeDeclaration?.name ??
                      shortPhpName(normalizedClassName),
                    member: method,
                  });
                }

                continue;
              }

              if (
                !includePrivateSatisfied &&
                method.visibility === "private"
              ) {
                continue;
              }

              satisfiedNames.add(memberKey);
            }

            const traitSatisfiedFlag =
              structure.kind === "trait" ? includePrivateSatisfied : false;

            for (const traitReference of phpTraitClassNames(content)) {
              if (
                !(await collectSuperType(
                  content,
                  traitReference,
                  traitSatisfiedFlag,
                ))
              ) {
                return false;
              }
            }

            for (const superTypeReference of phpSuperTypeReferences(content)) {
              if (
                !(await collectSuperType(content, superTypeReference, true))
              ) {
                return false;
              }
            }

            return true;
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        return true;
      };

      for (const traitReference of phpTraitClassNames(source)) {
        if (!(await collectSuperType(source, traitReference, true))) {
          return null;
        }
      }

      for (const reference of phpSuperTypeReferences(source)) {
        if (!(await collectSuperType(source, reference, true))) {
          return null;
        }
      }

      return { abstractMembers, conflictingNames, satisfiedNames };
    },
    [readNavigationFileContent, resolvePhpClassSourcePaths],
  );

  const collectPhpOverridableParentMethods = useCallback(
    async (
      source: string,
      isRequestedRootActive: () => boolean,
    ): Promise<Map<string, AbstractMemberToImplement> | null> => {
      const overridableMembers = new Map<string, AbstractMemberToImplement>();
      const seenMemberNames = new Set<string>();
      const visitedClassNames = new Set<string>();

      const collectParent = async (
        ownerSource: string,
        reference: string,
      ): Promise<boolean> => {
        const resolvedClassName = resolvePhpClassName(ownerSource, reference);

        if (!resolvedClassName) {
          return true;
        }

        const normalizedClassName = resolvedClassName
          .trim()
          .replace(/^\\+/, "");
        const visitedKey = normalizedClassName.toLowerCase();

        if (!normalizedClassName || visitedClassNames.has(visitedKey)) {
          return true;
        }

        visitedClassNames.add(visitedKey);

        if (!isRequestedRootActive()) {
          return false;
        }

        for (const path of await resolvePhpClassSourcePaths(
          normalizedClassName,
        )) {
          if (!isRequestedRootActive()) {
            return false;
          }

          try {
            const content = await readNavigationFileContent(path);

            if (!isRequestedRootActive()) {
              return false;
            }

            const structure = parsePhpClassStructure(
              content,
              shortPhpName(normalizedClassName),
            );

            for (const method of structure.methods) {
              const memberKey = method.name.toLowerCase();

              if (seenMemberNames.has(memberKey)) {
                continue;
              }

              seenMemberNames.add(memberKey);

              if (!isPhpOverridableParentMethod(method)) {
                continue;
              }

              overridableMembers.set(memberKey, {
                declaringSource: content,
                declaringTypeName:
                  structure.typeDeclaration?.name ??
                  shortPhpName(normalizedClassName),
                member: method,
              });
            }

            const parentReference = phpExtendsClassName(content);

            if (parentReference) {
              return collectParent(content, parentReference);
            }

            return true;
          } catch {
            if (!isRequestedRootActive()) {
              return false;
            }

            continue;
          }
        }

        return true;
      };

      const parentReference = phpExtendsClassName(source);

      if (!parentReference) {
        return overridableMembers;
      }

      if (!(await collectParent(source, parentReference))) {
        return null;
      }

      return overridableMembers;
    },
    [readNavigationFileContent, resolvePhpClassSourcePaths],
  );

  return {
    collectPhpAbstractMembersToImplement,
    collectPhpOverridableParentMethods,
  };
}

function shortPhpName(className: string): string {
  const normalized = className.replace(/^\\+/, "");
  const separator = normalized.lastIndexOf("\\");

  return separator >= 0 ? normalized.slice(separator + 1) : normalized;
}

function inheritedSignaturesDisagree(
  existing: AbstractMemberToImplement,
  declaringSource: string,
  member: AbstractMemberToImplement["member"],
): boolean {
  return (
    phpMethodSignatureKey(
      existing.member,
      (type) => inheritedTypeComparisonKey(existing.declaringSource, type),
      () => "<optional>",
    ) !==
    phpMethodSignatureKey(
      member,
      (type) => inheritedTypeComparisonKey(declaringSource, type),
      () => "<optional>",
    )
  );
}

function inheritedTypeComparisonKey(source: string, type: string): string {
  let resolved = type
    .replace(/\\?[A-Za-z_][A-Za-z0-9_\\]*/g, (token) => {
      if (PHP_BUILTIN_TYPE_NAMES.has(token.toLowerCase())) {
        return token.toLowerCase();
      }

      return (resolvePhpClassName(source, token) ?? token)
        .replace(/^\\+/, "")
        .toLowerCase();
    })
    .replace(/\s+/g, "");

  if (resolved.startsWith("?")) {
    resolved = `${resolved.slice(1)}|null`;
  }

  if (/[()]/.test(resolved)) {
    return resolved;
  }

  return resolved
    .split("|")
    .map((unionPart) => unionPart.split("&").sort().join("&"))
    .sort()
    .join("|");
}

const PHP_BUILTIN_TYPE_NAMES = new Set([
  "array",
  "bool",
  "callable",
  "false",
  "float",
  "int",
  "iterable",
  "mixed",
  "never",
  "null",
  "object",
  "parent",
  "self",
  "static",
  "string",
  "true",
  "void",
]);
