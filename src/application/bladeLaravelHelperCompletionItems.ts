import {
  phpLaravelConfigCompletionInsertText,
  type PhpLaravelConfigTarget,
} from "../domain/phpLaravelConfig";
import type { BladeFrameworkHelperCompletionContext } from "../domain/bladeFrameworkHelperCompletions";
import {
  phpLaravelJsonTranslationCompletionInsertText,
  phpLaravelTranslationCompletionInsertText,
  type PhpLaravelTranslationTarget,
} from "../domain/phpLaravelTranslations";
import type { BladeCompletionItem } from "./bladeIntelligenceContracts";

export interface BladeLaravelNamedRouteCompletionTarget {
  name: string;
  relativePath?: string | null;
}

export interface BladeLaravelHelperCompletionDependencies {
  collectPhpLaravelConfigTargets: () => Promise<PhpLaravelConfigTarget[]>;
  collectPhpLaravelNamedRouteTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<BladeLaravelNamedRouteCompletionTarget[]>;
  collectPhpLaravelTranslationTargets: () => Promise<PhpLaravelTranslationTarget[]>;
  currentDocumentContent: string;
  currentDocumentPath: string;
  isRequestedRootActive: () => boolean;
}

export function bladeLaravelHelperNameCompletions(
  prefix: string,
  range: { replaceEnd: number; replaceStart: number },
): BladeCompletionItem[] {
  const normalizedPrefix = prefix.toLowerCase();

  return BLADE_LARAVEL_HELPERS.filter((helper) =>
    helper.label.toLowerCase().startsWith(normalizedPrefix),
  ).map((helper) => ({
    detail: helper.detail,
    insertText: helper.insertText,
    kind: "helper",
    label: helper.label,
    replaceEnd: range.replaceEnd,
    replaceStart: range.replaceStart,
  }));
}

/**
 * Resolves `route()` / `config()` / `trans()` / `__()` string-literal
 * completions for Blade files by reusing the same target collectors and
 * insert-text formatting the PHP completion path uses.
 */
export async function provideBladeLaravelHelperCompletionItems(
  helperCompletion: BladeFrameworkHelperCompletionContext,
  offset: number,
  dependencies: BladeLaravelHelperCompletionDependencies,
): Promise<BladeCompletionItem[]> {
  const replaceStart = offset - helperCompletion.prefix.length;
  const replaceEnd = offset;
  const normalizedPrefix = helperCompletion.prefix.toLowerCase();

  if (helperCompletion.kind === "route") {
    const routes = await dependencies.collectPhpLaravelNamedRouteTargets(
      dependencies.currentDocumentContent,
      dependencies.currentDocumentPath,
    );

    if (!dependencies.isRequestedRootActive()) {
      return [];
    }

    return routes
      .filter((route) => route.name.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((route) => ({
        detail: route.relativePath ?? undefined,
        insertText: phpNamedRouteCompletionInsertText(
          route.name,
          helperCompletion.prefix,
        ),
        kind: "helper" as const,
        label: route.name,
        replaceEnd,
        replaceStart,
      }));
  }

  if (helperCompletion.kind === "trans") {
    const targets = await dependencies.collectPhpLaravelTranslationTargets();

    if (!dependencies.isRequestedRootActive()) {
      return [];
    }

    return targets
      .filter((target) => target.key.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((target) => ({
        detail: target.relativePath,
        insertText: target.relativePath.endsWith(".json")
          ? phpLaravelJsonTranslationCompletionInsertText(
              target.key,
              helperCompletion.prefix,
            )
          : phpLaravelTranslationCompletionInsertText(
              target.key,
              helperCompletion.prefix,
            ),
        kind: "helper" as const,
        label: target.key,
        replaceEnd,
        replaceStart,
      }));
  }

  const targets = await dependencies.collectPhpLaravelConfigTargets();

  if (!dependencies.isRequestedRootActive()) {
    return [];
  }

  return targets
    .filter((target) => target.key.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, 80)
    .map((target) => ({
      detail: target.relativePath,
      insertText: phpLaravelConfigCompletionInsertText(
        target.key,
        helperCompletion.prefix,
      ),
      kind: "helper" as const,
      label: target.key,
      replaceEnd,
      replaceStart,
    }));
}

const BLADE_LARAVEL_HELPERS = [
  {
    detail: "Laravel helper",
    insertText: "old()",
    label: "old",
  },
  {
    detail: "Laravel helper",
    insertText: "route()",
    label: "route",
  },
  {
    detail: "Laravel helper",
    insertText: "asset()",
    label: "asset",
  },
  {
    detail: "Laravel helper",
    insertText: "config()",
    label: "config",
  },
  {
    detail: "Laravel translation helper",
    insertText: "__()",
    label: "__",
  },
  {
    detail: "Laravel helper",
    insertText: "csrf_field()",
    label: "csrf_field",
  },
] as const;

function phpNamedRouteCompletionInsertText(
  routeName: string,
  prefix: string,
): string {
  const lastDotIndex = prefix.lastIndexOf(".");

  if (lastDotIndex < 0) {
    return routeName;
  }

  return routeName.slice(lastDotIndex + 1);
}
