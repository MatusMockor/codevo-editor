import type {
  NeonSemanticAliasFact,
  NeonSemanticDeclarationFact,
  NeonSemanticDocumentFacts,
  NeonSemanticReferenceFact,
} from "./neonSemanticFacts";

export type NeonSemanticSnapshotState = "complete" | "incomplete" | "truncated";

/** The effective, immutable NEON include-graph snapshot consumed by all rules. */
export interface NeonSemanticSymbolSnapshot {
  readonly documents: readonly NeonSemanticDocumentFacts[];
  readonly state: NeonSemanticSnapshotState;
}

export type NeonSemanticDiagnosticSeverity = "error" | "warning";

export interface NeonSemanticDiagnostic {
  readonly code:
    | "neon.aliasCycle"
    | "neon.duplicateParameter"
    | "neon.duplicateService"
    | "neon.unresolvedParameter"
    | "neon.unresolvedService";
  readonly message: string;
  readonly path: string;
  readonly severity: NeonSemanticDiagnosticSeverity;
  readonly span: { readonly end: number; readonly start: number };
}

export interface NeonSemanticDiagnosticOptions {
  readonly maxDiagnostics?: number;
}

export interface NeonSemanticDiagnosticRule {
  readonly id: NeonSemanticDiagnostic["code"];
  evaluate(snapshot: NeonSemanticSymbolSnapshot): readonly NeonSemanticDiagnostic[];
}

const DEFAULT_MAX_DIAGNOSTICS = 1_000;
const MAX_DIAGNOSTICS = 10_000;
const EMPTY_DIAGNOSTICS: readonly NeonSemanticDiagnostic[] = Object.freeze([]);

type Located<T> = T & { readonly path: string };

class UnresolvedParameterRule implements NeonSemanticDiagnosticRule {
  readonly id = "neon.unresolvedParameter" as const;

  evaluate(snapshot: NeonSemanticSymbolSnapshot): readonly NeonSemanticDiagnostic[] {
    const declared = new Set(allParameterDeclarations(snapshot).map(({ name }) => name));
    return allParameterReferences(snapshot).flatMap((reference) =>
      declared.has(reference.name)
        ? []
        : [
            diagnostic(
              this.id,
              reference.path,
              reference.span,
              "warning",
              `Unknown Nette parameter '${reference.name}'.`,
            ),
          ],
    );
  }
}

class UnresolvedNamedServiceRule implements NeonSemanticDiagnosticRule {
  readonly id = "neon.unresolvedService" as const;

  evaluate(snapshot: NeonSemanticSymbolSnapshot): readonly NeonSemanticDiagnostic[] {
    const declared = new Set(allServiceDeclarations(snapshot).map(({ name }) => name));
    return allServiceReferences(snapshot).flatMap((reference) =>
      isNamedService(reference.name) && !declared.has(reference.name)
        ? [
            diagnostic(
              this.id,
              reference.path,
              reference.span,
              "warning",
              `Unknown Nette service '${reference.name}'.`,
            ),
          ]
        : [],
    );
  }
}

class DuplicateDeclarationRule implements NeonSemanticDiagnosticRule {
  constructor(
    readonly id: "neon.duplicateParameter" | "neon.duplicateService",
    private readonly kind: "parameter" | "service",
  ) {}

  evaluate(snapshot: NeonSemanticSymbolSnapshot): readonly NeonSemanticDiagnostic[] {
    const declarations =
      this.kind === "parameter"
        ? allParameterDeclarations(snapshot)
        : allServiceDeclarations(snapshot);
    const counts = countLocatedNames(declarations);
    return declarations.flatMap((declaration) =>
      (counts.get(locatedNameKey(declaration)) ?? 0) > 1
        ? [
            diagnostic(
              this.id,
              declaration.path,
              declaration.span,
              "error",
              `${capitalize(this.kind)} '${declaration.name}' is declared more than once in the effective Nette configuration.`,
            ),
          ]
        : [],
    );
  }
}

class AliasCycleRule implements NeonSemanticDiagnosticRule {
  readonly id = "neon.aliasCycle" as const;

  evaluate(snapshot: NeonSemanticSymbolSnapshot): readonly NeonSemanticDiagnostic[] {
    const aliases = allAliases(snapshot);
    const declarationCounts = countNames(allServiceDeclarations(snapshot));
    const uniqueAliases = new Map<string, Located<NeonSemanticAliasFact>>();
    const aliasCounts = countNames(aliases);

    for (const alias of aliases) {
      if (
        aliasCounts.get(alias.name) === 1 &&
        declarationCounts.get(alias.name) === 1 &&
        isNamedService(alias.targetName)
      ) {
        uniqueAliases.set(alias.name, alias);
      }
    }

    const cyclic = new Set<string>();
    for (const start of [...uniqueAliases.keys()].sort()) {
      const positions = new Map<string, number>();
      const chain: string[] = [];
      let current: string | undefined = start;
      while (current !== undefined && uniqueAliases.has(current)) {
        const previous = positions.get(current);
        if (previous !== undefined) {
          for (const name of chain.slice(previous)) cyclic.add(name);
          break;
        }
        positions.set(current, chain.length);
        chain.push(current);
        current = uniqueAliases.get(current)?.targetName;
      }
    }

    return [...cyclic].sort().map((name) => {
      const alias = uniqueAliases.get(name) as Located<NeonSemanticAliasFact>;
      return diagnostic(
        this.id,
        alias.path,
        alias.targetSpan,
        "error",
        `Service alias '${name}' is part of a circular alias chain.`,
      );
    });
  }
}

export const NEON_SEMANTIC_DIAGNOSTIC_RULES: readonly NeonSemanticDiagnosticRule[] = [
  new UnresolvedParameterRule(),
  new UnresolvedNamedServiceRule(),
  new DuplicateDeclarationRule("neon.duplicateParameter", "parameter"),
  new DuplicateDeclarationRule("neon.duplicateService", "service"),
  new AliasCycleRule(),
];

/** Runs the rule specifications only when the supplied effective snapshot is complete. */
export function diagnoseNeonSemanticSnapshot(
  snapshot: NeonSemanticSymbolSnapshot,
  options: NeonSemanticDiagnosticOptions = {},
  rules: readonly NeonSemanticDiagnosticRule[] = NEON_SEMANTIC_DIAGNOSTIC_RULES,
): readonly NeonSemanticDiagnostic[] {
  if (snapshot.state !== "complete") return EMPTY_DIAGNOSTICS;
  const limit = boundedLimit(options.maxDiagnostics);
  if (limit === 0) return EMPTY_DIAGNOSTICS;
  const diagnostics = rules.flatMap((rule) => rule.evaluate(snapshot));
  return Object.freeze(dedupeAndSort(diagnostics).slice(0, limit));
}

function allParameterDeclarations(
  snapshot: NeonSemanticSymbolSnapshot,
): Located<NeonSemanticDeclarationFact>[] {
  return snapshot.documents.flatMap(({ parameterDeclarations, path }) =>
    parameterDeclarations.map((fact) => ({ ...fact, path })),
  );
}

function allServiceDeclarations(
  snapshot: NeonSemanticSymbolSnapshot,
): Located<NeonSemanticDeclarationFact>[] {
  return snapshot.documents.flatMap(({ path, serviceDeclarations }) =>
    serviceDeclarations.map((fact) => ({ ...fact, path })),
  );
}

function allParameterReferences(
  snapshot: NeonSemanticSymbolSnapshot,
): Located<NeonSemanticReferenceFact>[] {
  return snapshot.documents.flatMap(({ parameterReferences, path }) =>
    parameterReferences.map((fact) => ({ ...fact, path })),
  );
}

function allServiceReferences(
  snapshot: NeonSemanticSymbolSnapshot,
): Located<NeonSemanticReferenceFact>[] {
  return snapshot.documents.flatMap(({ path, serviceReferences }) =>
    serviceReferences.map((fact) => ({ ...fact, path })),
  );
}

function allAliases(snapshot: NeonSemanticSymbolSnapshot): Located<NeonSemanticAliasFact>[] {
  return snapshot.documents.flatMap(({ aliases, path }) =>
    aliases.map((fact) => ({ ...fact, path })),
  );
}

function countNames(facts: readonly { readonly name: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { name } of facts) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}

function countLocatedNames(
  facts: readonly { readonly name: string; readonly path: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const fact of facts) {
    const key = locatedNameKey(fact);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function locatedNameKey(fact: { readonly name: string; readonly path: string }): string {
  return `${fact.path}\0${fact.name}`;
}

function isNamedService(name: string): boolean {
  return !name.includes("\\") && !/^0[1-9][0-9]*$/.test(name);
}

function diagnostic(
  code: NeonSemanticDiagnostic["code"],
  path: string,
  span: NeonSemanticDiagnostic["span"],
  severity: NeonSemanticDiagnosticSeverity,
  message: string,
): NeonSemanticDiagnostic {
  return Object.freeze({
    code,
    message,
    path,
    severity,
    span: Object.freeze({ ...span }),
  });
}

function dedupeAndSort(diagnostics: readonly NeonSemanticDiagnostic[]): NeonSemanticDiagnostic[] {
  const unique = new Map<string, NeonSemanticDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.path}\0${diagnostic.span.start}\0${diagnostic.span.end}\0${diagnostic.code}`;
    if (!unique.has(key)) {
      unique.set(
        key,
        Object.freeze({ ...diagnostic, span: Object.freeze({ ...diagnostic.span }) }),
      );
    }
  }
  return [...unique.values()].sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      left.span.start - right.span.start ||
      left.span.end - right.span.end ||
      compareText(left.code, right.code),
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_DIAGNOSTICS;
  return Math.max(0, Math.min(MAX_DIAGNOSTICS, Math.floor(value)));
}

function capitalize(value: string): string {
  return value[0]?.toUpperCase() + value.slice(1);
}
