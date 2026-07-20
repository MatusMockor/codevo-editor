import {
  phpLaravelApiResourceCompletionsFromSource,
  phpLaravelMacroCompletionsFromSource,
  phpLaravelModelAttributeCompletionsFromSource,
  phpLaravelRelationPropertyCompletionsFromSource,
  phpLaravelLocalScopeCompletionsFromMethods,
} from "../domain/phpFrameworkLaravel";
import {
  phpMethodCompletionsFromSource,
  phpMethodNamesWithAttributeFromSource,
} from "../domain/phpMethodCompletions";
import type { PhpMemberCompletionContribution } from "./phpMemberCompletionContribution";

export const phpLaravelMemberCompletionContribution: PhpMemberCompletionContribution =
  {
    id: "laravel.member-completions",
    collect: ({ declaringClassName, source, workspaceSources }) => {
      const attributedScopeNames = phpMethodNamesWithAttributeFromSource(
        source,
        "Scope",
      );
      const attributedScopeMethods = phpMethodCompletionsFromSource(
        source,
        declaringClassName,
        { includeNonPublicMembers: true },
      )
        .filter(
          (method) =>
            !method.isStatic &&
            method.visibility !== "private" &&
            attributedScopeNames.has(method.name.toLowerCase()),
        )
        .map((method) => ({ ...method, kind: "scope" as const }));

      return [
        ...phpLaravelLocalScopeCompletionsFromMethods(attributedScopeMethods),
        ...phpLaravelMacroCompletionsFromSource(
          source,
          declaringClassName,
          workspaceSources,
        ),
        ...phpLaravelModelAttributeCompletionsFromSource(
          source,
          declaringClassName,
          workspaceSources,
        ),
        ...phpLaravelRelationPropertyCompletionsFromSource(
          source,
          declaringClassName,
        ),
        ...phpLaravelApiResourceCompletionsFromSource(
          source,
          declaringClassName,
        ),
      ];
    },
    replaces: (existing, replacement, context) => {
      if (replacement.kind !== "scope" || existing.kind) {
        return false;
      }

      if (
        existing.name.toLowerCase() !== replacement.name.toLowerCase() ||
        existing.declaringClassName !== replacement.declaringClassName
      ) {
        return false;
      }

      const attributedScopeNames = phpMethodNamesWithAttributeFromSource(
        context.source,
        "Scope",
      );

      if (!attributedScopeNames.has(existing.name.toLowerCase())) {
        return false;
      }

      const canonicalScope = phpLaravelLocalScopeCompletionsFromMethods([
        { ...existing, kind: "scope" },
      ])[0];

      if (!canonicalScope) {
        return false;
      }

      return (
        canonicalScope.parameters === replacement.parameters &&
        canonicalScope.returnType === replacement.returnType &&
        canonicalScope.isStatic === replacement.isStatic
      );
    },
  };
