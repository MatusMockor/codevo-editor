import {
  detectPhpPresenterLinkAt,
  nettePresenterLinkCompletionContextAt,
} from "./latteLinkNavigation";
import {
  isNetteComponentAccess,
  isNetteTemplateMagicMember,
} from "./netteMagicDiagnostics";
import {
  NETTE_VIEW_DATA_SEARCH_QUERIES,
  netteViewDataEntryFromSource,
} from "./netteViewData";
import type { PhpFrameworkProvider } from "./phpFrameworkProviders";
import type { PhpProjectDescriptor } from "./workspace";

/**
 * Diagnostic `source` label stamped on downgraded Nette framework-magic hints
 * (a call on `$this->template`, a magically-obtained component) so they read as
 * "nette-magic" rather than the shared Laravel marker. See
 * `PhpFrameworkProvider.diagnostics.magicSource`.
 */
export const NETTE_MAGIC_DIAGNOSTIC_SOURCE = "nette-magic";

/**
 * Nette detection mirrors Laravel detection: an exact composer package name
 * match (Composer normalizes package names to lowercase, so no case folding is
 * needed - and staying identical to the Laravel check keeps behavior consistent).
 * `nette/application` (the framework) or `latte/latte` (the template engine)
 * signal a Nette project.
 */
export function isNettePhpProject(php: PhpProjectDescriptor): boolean {
  return php.packages.some(
    (composerPackage) =>
      composerPackage.name === "nette/application" ||
      composerPackage.name === "latte/latte",
  );
}

/**
 * Nette provider. Detection resolves the framework profile + per-workspace
 * exclusivity; the wired capabilities (S5/S6) are:
 *   - `viewData`: presenter/control -> Latte template variables, so the generic
 *     controller view-data loader and the Latte intelligence hook surface
 *     `{$product->}` completions through the SAME provider dispatch Laravel uses
 *     for Blade (no framework-specific branch in the controller).
 *   - `neon`: NEON config navigation/completions are enabled through provider
 *     dispatch instead of direct Nette checks in the application hook.
 *   - `latte`: Latte template navigation/completions are enabled through
 *     provider dispatch instead of direct Nette checks in the application hook.
 *   - `diagnostics`: Nette magic suppression (spec §4.6), labelled
 *     `nette-magic`.
 * Other capabilities (templating references, routes, config) land in later
 * slices; every dispatcher treats an absent capability as a safe no-op via
 * optional chaining, so this provider can never crash a hot path.
 */
export const phpNetteFrameworkProvider: PhpFrameworkProvider = {
  id: "nette",
  appliesTo: (php) => isNettePhpProject(php),
  targetCollections: [
    {
      kind: "viewData",
      searchQueries: NETTE_VIEW_DATA_SEARCH_QUERIES,
    },
  ],
  diagnostics: {
    // Nette magic suppression (spec §4.6): calls/properties on the Latte
    // template object (`$this->template->foo`, `$this->template->foo()`) and
    // calls on magically-obtained components (`$this->getComponent('x')->bar()`,
    // `$this['x']->bar()`) are framework-provided at runtime, so phpactor's
    // "does not exist" is a false positive - downgraded to a soft
    // `nette-magic` hint, never dropped. The predicates default to false
    // whenever the source lacks a presenter/control/component context, so a
    // plain service is untouched. Nette has no static magic to suppress, so
    // `isKnownStaticMethod` is intentionally absent.
    isKnownMemberMethod: ({
      methodName,
      receiverClassName,
      receiverExpression,
      source,
    }) =>
      isNetteComponentAccess(source, { methodName, receiverExpression }) ||
      isNetteTemplateMagicMember(source, {
        memberName: methodName,
        receiverClassName,
        receiverExpression,
      }),
    isKnownMemberProperty: ({
      propertyName,
      receiverClassName,
      receiverExpression,
      source,
    }) =>
      isNetteTemplateMagicMember(source, {
        memberName: propertyName,
        receiverClassName,
        receiverExpression,
      }),
    magicSource: NETTE_MAGIC_DIAGNOSTIC_SOURCE,
  },
  viewData: {
    entryFromSource: ({ source }) => netteViewDataEntryFromSource(source),
    searchQueries: NETTE_VIEW_DATA_SEARCH_QUERIES,
  },
  neon: {
    supportsConfigIntelligence: true,
  },
  latte: {
    supportsPresenterLinkIntelligence: true,
    supportsTemplateIntelligence: true,
  },
  php: {
    presenterLinkAt: ({ offset, source }) =>
      detectPhpPresenterLinkAt(source, offset),
    presenterLinkCompletionAt: ({ offset, source }) =>
      nettePresenterLinkCompletionContextAt(source, offset, "php"),
  },
};
