import { useCallback } from "react";
import {
  parsePhpClassStructure,
} from "../domain/phpClassStructure";
import {
  phpExtendsClassName,
  phpSuperTypeReferences,
  resolvePhpClassName,
} from "../domain/phpNavigation";
import {
  type IntelligenceMode,
  type WorkspaceDescriptor,
} from "../domain/workspace";
import { type ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import {
  isPhpOverridableParentMethod,
  usePhpCodeActions,
  type AbstractMemberToImplement,
  type UsePhpCodeActionsResult,
} from "./usePhpCodeActions";

interface UsePhpCodeActionProviderOptions {
  activeDocumentPath: string | null;
  collectPhpLaravelViewTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  currentWorkspaceRootRef: { readonly current: string | null };
  intelligenceMode: IntelligenceMode;
  isLaravelFrameworkActive: boolean;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readNavigationFileContent: (path: string) => Promise<string>;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export function usePhpCodeActionProvider({
  activeDocumentPath,
  collectPhpLaravelViewTargets,
  currentWorkspaceRootRef,
  intelligenceMode,
  isLaravelFrameworkActive,
  projectSymbolSearch,
  readNavigationFileContent,
  readTestFileIfExists,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpCodeActionProviderOptions): UsePhpCodeActionsResult {
  const collectPhpAbstractMembersToImplement = useCallback(
    async (
      source: string,
      isRequestedRootActive: () => boolean,
    ): Promise<{
      abstractMembers: Map<string, AbstractMemberToImplement>;
      satisfiedNames: Set<string>;
    } | null> => {
      const abstractMembers = new Map<string, AbstractMemberToImplement>();
      const satisfiedNames = new Set<string>();
      const visitedClassNames = new Set<string>();

      const collectSuperType = async (
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

              if (method.isAbstract) {
                if (!abstractMembers.has(memberKey)) {
                  abstractMembers.set(memberKey, {
                    declaringSource: content,
                    member: method,
                  });
                }

                continue;
              }

              satisfiedNames.add(memberKey);
            }

            for (const superTypeReference of phpSuperTypeReferences(content)) {
              if (!(await collectSuperType(content, superTypeReference))) {
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

      for (const reference of phpSuperTypeReferences(source)) {
        if (!(await collectSuperType(source, reference))) {
          return null;
        }
      }

      return { abstractMembers, satisfiedNames };
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

  return usePhpCodeActions({
    activeDocumentPath,
    collectPhpAbstractMembersToImplement,
    collectPhpLaravelViewTargets,
    collectPhpOverridableParentMethods,
    currentWorkspaceRootRef,
    intelligenceMode,
    isLaravelFrameworkActive,
    projectSymbolSearch,
    readTestFileIfExists,
    resolvePhpClassSourcePaths,
    workspaceDescriptor,
    workspaceRoot,
  });
}

function shortPhpName(className: string): string {
  const normalized = className.replace(/^\\+/, "");
  const separator = normalized.lastIndexOf("\\");

  return separator >= 0 ? normalized.slice(separator + 1) : normalized;
}
