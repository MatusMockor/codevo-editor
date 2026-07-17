import { useCallback } from "react";
import {
  parsePhpClassStructure,
  type PhpClassStructure,
} from "../domain/phpClassStructure";
import { phpMethodSignatureKey } from "../domain/phpCodeGen";
import {
  phpTraitUseInfo,
  type PhpTraitMethodAlias,
} from "../domain/phpMethodCompletions";
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
      const parsedStructures = new Map<
        string,
        { content: string; structure: PhpClassStructure }
      >();

      const applyTraitAliases = (
        traitAliases: PhpTraitMethodAlias[],
        content: string,
        structure: PhpClassStructure,
        normalizedClassName: string,
        includePrivateSatisfied: boolean,
      ): void => {
        for (const alias of traitAliases) {
          const aliasedMethod = structure.methods.find(
            (method) =>
              method.name.toLowerCase() === alias.methodName.toLowerCase(),
          );

          if (!aliasedMethod) {
            continue;
          }

          const targetKey = (
            alias.aliasName ?? aliasedMethod.name
          ).toLowerCase();

          if (aliasedMethod.isAbstract) {
            if (!alias.aliasName) {
              continue;
            }

            const aliasedMember = {
              ...aliasedMethod,
              name: alias.aliasName,
            };
            const existing = abstractMembers.get(targetKey);

            if (
              existing &&
              inheritedSignaturesDisagree(existing, content, aliasedMember)
            ) {
              conflictingNames.add(targetKey);
            }

            if (!existing) {
              abstractMembers.set(targetKey, {
                declaringSource: content,
                declaringTypeName:
                  structure.typeDeclaration?.name ??
                  shortPhpName(normalizedClassName),
                member: aliasedMember,
              });
            }

            continue;
          }

          const effectiveVisibility =
            alias.visibility ?? aliasedMethod.visibility;

          if (!includePrivateSatisfied && effectiveVisibility === "private") {
            continue;
          }

          satisfiedNames.add(targetKey);
        }
      };

      const collectSuperType = async (
        ownerSource: string,
        reference: string,
        includePrivateSatisfied: boolean,
        traitAliases: PhpTraitMethodAlias[] = [],
      ): Promise<boolean> => {
        const resolvedClassName = resolvePhpClassName(ownerSource, reference);

        if (!resolvedClassName) {
          return true;
        }

        const normalizedClassName = resolvedClassName
          .trim()
          .replace(/^\\+/, "");
        const visitedKey = normalizedClassName.toLowerCase();

        if (!normalizedClassName) {
          return true;
        }

        if (visitedClassNames.has(visitedKey)) {
          const cached = parsedStructures.get(visitedKey);

          if (cached) {
            applyTraitAliases(
              traitAliases,
              cached.content,
              cached.structure,
              normalizedClassName,
              includePrivateSatisfied,
            );
          }

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

            parsedStructures.set(visitedKey, { content, structure });

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

            applyTraitAliases(
              traitAliases,
              content,
              structure,
              normalizedClassName,
              includePrivateSatisfied,
            );

            const traitSatisfiedFlag =
              structure.kind === "trait" ? includePrivateSatisfied : false;
            const contentTraitUse = phpTraitUseInfo(content);

            for (const traitReference of contentTraitUse.traitNames) {
              if (
                !(await collectSuperType(
                  content,
                  traitReference,
                  traitSatisfiedFlag,
                  traitAliasesForReference(
                    contentTraitUse.aliases,
                    traitReference,
                  ),
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

      const sourceTraitUse = phpTraitUseInfo(source);

      for (const traitReference of sourceTraitUse.traitNames) {
        if (
          !(await collectSuperType(
            source,
            traitReference,
            true,
            traitAliasesForReference(sourceTraitUse.aliases, traitReference),
          ))
        ) {
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

function traitAliasesForReference(
  aliases: PhpTraitMethodAlias[],
  reference: string,
): PhpTraitMethodAlias[] {
  const normalizedReference = reference.replace(/^\\+/, "").toLowerCase();
  const shortReference = shortPhpName(reference).toLowerCase();

  return aliases.filter((alias) => {
    if (!alias.traitName) {
      return true;
    }

    const normalizedAlias = alias.traitName.replace(/^\\+/, "").toLowerCase();

    return (
      normalizedAlias === normalizedReference ||
      shortPhpName(alias.traitName).toLowerCase() === shortReference
    );
  });
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
