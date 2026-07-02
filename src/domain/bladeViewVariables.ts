/**
 * Blade VARIABLE intelligence: the reverse `view name -> controller data`
 * mapping that makes `$invoice->` in `resources/views/invoices/show.blade.php`
 * complete like PhpStorm.
 *
 * The module is pure and filesystem-free. The application layer feeds it the
 * controller sources it discovered (and cached per workspace root); this module
 * extracts each source's view-data bindings once (`bladeViewDataEntryFromSource`)
 * and answers two questions per view:
 *
 *   1. Which variables does ANY controller pass to this view, with a cheap
 *      display type hint? - `bladeViewVariablesForViewFromEntries`.
 *   2. Which sightings (source + variable occurrence) exist for ONE variable,
 *      so the caller can run full expression-type inference per sighting? -
 *      `bladeViewVariableSightingsForView` + `mergeBladeViewVariableResolvedTypes`.
 *
 * CONSERVATIVE by design: when different controllers pass DIFFERENT types for
 * the same variable of the same view, the merged type is `null` (no guessing,
 * no member completions) - agreeing or unknown sightings never veto a resolved
 * type, matching "same type OK, conflict skip".
 */

import {
  phpLaravelViewDataBindings,
  type PhpLaravelViewDataBinding,
  type PhpLaravelViewVariable,
} from "./phpLaravelViewData";

export interface BladeViewDataEntry {
  bindings: PhpLaravelViewDataBinding[];
  source: string;
}

export interface BladeViewVariableSighting {
  source: string;
  variable: PhpLaravelViewVariable;
}

export function bladeViewDataEntryFromSource(source: string): BladeViewDataEntry {
  return { bindings: phpLaravelViewDataBindings(source), source };
}

/**
 * Merges the variables every entry passes to `viewName` into one display list
 * sorted by name. The display `typeHint` is kept only when all hinted
 * sightings agree (unhinted sightings do not veto); a conflict clears it so
 * the completion list never shows a wrong type.
 */
export function bladeViewVariablesForViewFromEntries(
  entries: readonly BladeViewDataEntry[],
  viewName: string,
): PhpLaravelViewVariable[] {
  const merged = new Map<string, PhpLaravelViewVariable>();
  const conflictingHints = new Set<string>();

  for (const sighting of allSightingsForView(entries, viewName)) {
    const key = sighting.variable.name.toLowerCase();
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...sighting.variable });
      continue;
    }

    const nextHint = sighting.variable.typeHint;

    if (!nextHint) {
      continue;
    }

    if (!existing.typeHint) {
      existing.typeHint = nextHint;
      continue;
    }

    if (existing.typeHint !== nextHint) {
      conflictingHints.add(key);
    }
  }

  for (const key of conflictingHints) {
    const variable = merged.get(key);

    if (variable) {
      variable.typeHint = null;
    }
  }

  return Array.from(merged.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

/**
 * Returns every sighting of `variableName` (with `$` prefix, matched
 * case-insensitively) across the entries' bindings for `viewName`, each paired
 * with its declaring source so the caller can resolve the value expression in
 * the correct scope.
 */
export function bladeViewVariableSightingsForView(
  entries: readonly BladeViewDataEntry[],
  viewName: string,
  variableName: string,
): BladeViewVariableSighting[] {
  const normalizedName = variableName.toLowerCase();

  return allSightingsForView(entries, viewName).filter(
    (sighting) => sighting.variable.name.toLowerCase() === normalizedName,
  );
}

/**
 * Conservative reduction of per-sighting resolved types to a single receiver
 * type: `null` entries (unresolvable sightings) are ignored; the remaining
 * types must agree (comparison normalizes leading backslashes and case) or the
 * result is `null` - never a guessed member list.
 */
export function mergeBladeViewVariableResolvedTypes(
  resolvedTypes: readonly (string | null)[],
): string | null {
  let mergedType: string | null = null;

  for (const resolvedType of resolvedTypes) {
    if (!resolvedType) {
      continue;
    }

    if (!mergedType) {
      mergedType = resolvedType;
      continue;
    }

    if (normalizedTypeKey(mergedType) !== normalizedTypeKey(resolvedType)) {
      return null;
    }
  }

  return mergedType;
}

function allSightingsForView(
  entries: readonly BladeViewDataEntry[],
  viewName: string,
): BladeViewVariableSighting[] {
  const sightings: BladeViewVariableSighting[] = [];

  for (const entry of entries) {
    for (const binding of entry.bindings) {
      if (binding.viewName !== viewName) {
        continue;
      }

      for (const variable of binding.variables) {
        sightings.push({ source: entry.source, variable });
      }
    }
  }

  return sightings;
}

function normalizedTypeKey(typeName: string): string {
  return typeName.replace(/^\\+/, "").toLowerCase();
}
