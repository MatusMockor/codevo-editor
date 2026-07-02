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

/**
 * A loop variable declared by an enclosing `@foreach`/`@forelse` directive, with
 * the collection expression it iterates. The application layer resolves the
 * collection's element type from this so `$item->` completes inside the body,
 * and offers `loopVariableName` in the `$` variable list so the user immediately
 * sees which locals are in scope.
 */
export interface BladeForeachLoopBinding {
  collectionExpression: string;
  loopVariableName: string;
}

/**
 * The structural shape of a `@foreach` collection expression that the
 * application layer can resolve to an element type: the root `$variable` and the
 * chain of `->relation` / `->property` accesses applied to it (empty for a bare
 * variable). CONSERVATIVE: only a plain variable or a pure property/relation
 * chain is accepted - anything with a method call `(...)`, array access `[...]`,
 * or a non-variable receiver yields `null`, so the resolver never guesses.
 */
export interface BladeForeachCollection {
  relationNames: string[];
  rootVariableName: string;
}

const BLADE_FOREACH_COLLECTION =
  /^\$([A-Za-z_][A-Za-z0-9_]*)((?:->[A-Za-z_][A-Za-z0-9_]*)*)$/;

/**
 * Parses a trimmed `@foreach` collection expression into its root variable and
 * relation chain, or `null` when it is not a plain variable / property chain.
 */
export function parseBladeForeachCollection(
  expression: string,
): BladeForeachCollection | null {
  const match = BLADE_FOREACH_COLLECTION.exec(expression.trim());

  if (!match) {
    return null;
  }

  const relationNames = Array.from(
    (match[2] ?? "").matchAll(/->([A-Za-z_][A-Za-z0-9_]*)/g),
    (relation) => relation[1] ?? "",
  );

  return { relationNames, rootVariableName: match[1] ?? "" };
}

const BLADE_FOREACH_OPEN =
  /@(?:foreach|forelse)\s*\(\s*(.+?)\s+as\s+(?:\$[A-Za-z_][A-Za-z0-9_]*\s*=>\s*)?\$([A-Za-z_][A-Za-z0-9_]*)\s*\)/giy;
const BLADE_FOREACH_CLOSE = /@(?:endforeach|endforelse)\b/giy;
// Global (not sticky) so `exec` scans forward to the NEXT loop directive; the
// open/close patterns above stay sticky to match only AT that directive.
const BLADE_DIRECTIVE_SCAN = /@(?:foreach|forelse|endforeach|endforelse)/gi;

/**
 * Returns the loop bindings of every `@foreach`/`@forelse` directive whose body
 * still encloses `offset`, outermost first. Directives closed by
 * `@endforeach`/`@endforelse` before the offset are popped off the scope stack,
 * so only genuinely-enclosing loops remain. A directive whose header is still
 * being typed - its open match starts before `offset` but its closing `)` lies
 * at or past it - does not yet declare a loop variable, so scanning stops there
 * instead of treating it as complete. Pure and scope-aware; the `@empty`
 * separator of `@forelse` does not close the loop (its body still binds the
 * loop variable up to `@endforelse`), so it is intentionally not treated as a
 * close.
 */
export function bladeForeachLoopBindingsAt(
  source: string,
  offset: number,
): BladeForeachLoopBinding[] {
  const stack: BladeForeachLoopBinding[] = [];
  const limit = Math.max(0, Math.min(offset, source.length));
  let index = 0;

  while (index < limit) {
    BLADE_DIRECTIVE_SCAN.lastIndex = index;
    const directive = BLADE_DIRECTIVE_SCAN.exec(source);

    if (!directive || directive.index >= limit) {
      break;
    }

    const open = matchStickyAt(BLADE_FOREACH_OPEN, source, directive.index);

    if (open && directive.index + open[0].length > limit) {
      // The header's closing `)` lies past the offset: it is still being
      // typed, so it does not yet declare a loop variable in scope.
      break;
    }

    if (open) {
      stack.push({
        collectionExpression: open[1].trim(),
        loopVariableName: open[2],
      });
      index = directive.index + open[0].length;
      continue;
    }

    const close = matchStickyAt(BLADE_FOREACH_CLOSE, source, directive.index);

    if (close) {
      stack.pop();
      index = directive.index + close[0].length;
      continue;
    }

    index = directive.index + directive[0].length;
  }

  return stack;
}

function matchStickyAt(
  pattern: RegExp,
  source: string,
  at: number,
): RegExpExecArray | null {
  pattern.lastIndex = at;

  const match = pattern.exec(source);

  return match && match.index === at ? match : null;
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
