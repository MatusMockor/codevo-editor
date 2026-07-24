import { describe, expect, it } from "vitest";
import {
  NEON_SEMANTIC_DIAGNOSTIC_RULES,
  diagnoseNeonSemanticSnapshot,
  type NeonSemanticDiagnosticRule,
  type NeonSemanticSymbolSnapshot,
} from "./neonSemanticDiagnostics";
import {
  neonSemanticDocumentFactsFromSource,
  type NeonSemanticDocumentFacts,
} from "./neonSemanticFacts";

function complete(...documents: readonly NeonSemanticDocumentFacts[]): NeonSemanticSymbolSnapshot {
  return { documents, state: "complete" };
}

describe("NEON semantic diagnostic facts", () => {
  it("extracts exact static facts while ignoring comments, strings, escapes and dynamic text", () => {
    const source = [
      "parameters:",
      "  known: value",
      "  escaped: 50%%",
      "  quoted: '%insideString%'",
      "services:",
      "  knownService: App\\Known(%known%)",
      "  alias: @knownService",
      "  dynamic: '@insideString'",
      "  dynamicReference: App\\Dynamic(@{$service}, %{$parameter}%)",
      "  # hidden: App\\Hidden(@insideComment)",
    ].join("\n");
    const facts = neonSemanticDocumentFactsFromSource("/app/config.neon", source);

    expect(facts.parameterDeclarations.map(({ name }) => name)).toEqual([
      "known",
      "escaped",
      "quoted",
    ]);
    expect(facts.parameterReferences).toEqual([{ name: "known", span: spanOf(source, "%known%") }]);
    expect(facts.serviceReferences.map(({ name }) => name)).toEqual(["knownService"]);
    expect(facts.aliases).toEqual([
      {
        name: "alias",
        nameSpan: spanOf(source, "alias"),
        targetName: "knownService",
        targetSpan: spanOf(source, "@knownService"),
      },
    ]);
  });

  it("deep-freezes document facts and every exposed token span", () => {
    const source = "parameters:\n  port: 80\nservices:\n  alias: @mailer\n  mailer: App\\Mailer";
    const facts = neonSemanticDocumentFactsFromSource("C:/Workspace/config.neon", source);

    expect(Object.isFrozen(facts)).toBe(true);
    expect(Object.isFrozen(facts.aliases)).toBe(true);
    expect(Object.isFrozen(facts.aliases[0])).toBe(true);
    expect(Object.isFrozen(facts.aliases[0]?.targetSpan)).toBe(true);
    expect(Object.isFrozen(facts.parameterDeclarations)).toBe(true);
    expect(Object.isFrozen(facts.parameterDeclarations[0]?.span)).toBe(true);
    expect(Object.isFrozen(facts.serviceReferences[0]?.span)).toBe(true);
  });
});

describe("diagnoseNeonSemanticSnapshot", () => {
  it("reports unresolved parameters and named services at exact token ranges", () => {
    const source = "services:\n  consumer: App\\Consumer(%missing%, @unknown)";
    const diagnostics = diagnoseNeonSemanticSnapshot(
      complete(neonSemanticDocumentFactsFromSource("/app/config.neon", source)),
    );

    expect(diagnostics).toEqual([
      {
        code: "neon.unresolvedParameter",
        message: "Unknown Nette parameter 'missing'.",
        path: "/app/config.neon",
        severity: "warning",
        span: spanOf(source, "%missing%"),
      },
      {
        code: "neon.unresolvedService",
        message: "Unknown Nette service 'unknown'.",
        path: "/app/config.neon",
        severity: "warning",
        span: spanOf(source, "@unknown"),
      },
    ]);
  });

  it("resolves references against every document in the effective snapshot", () => {
    const declarations = [
      "parameters:",
      "  mail:",
      "    host: localhost",
      "services:",
      "  mailer: App\\Mailer",
    ].join("\n");
    const consumer = "services:\n  consumer: App\\Consumer(%mail.host%, @mailer)";

    expect(
      diagnoseNeonSemanticSnapshot(
        complete(
          neonSemanticDocumentFactsFromSource("/app/base.neon", declarations),
          neonSemanticDocumentFactsFromSource("/app/config.neon", consumer),
        ),
      ),
    ).toEqual([]);
  });

  it("does not diagnose class-shaped service references", () => {
    const source = [
      "services:",
      "  one: App\\One(@\\App\\Contracts\\Mailer)",
      "  two: App\\Two(@App\\Contracts\\Logger)",
    ].join("\n");

    expect(
      diagnoseNeonSemanticSnapshot(
        complete(neonSemanticDocumentFactsFromSource("/app/config.neon", source)),
      ),
    ).toEqual([]);
  });

  it("does not diagnose generated anonymous service identifiers", () => {
    const source = "services:\n  consumer: App\\Consumer(@01, @099)";
    expect(
      diagnoseNeonSemanticSnapshot(
        complete(neonSemanticDocumentFactsFromSource("/app/config.neon", source)),
      ),
    ).toEqual([]);
  });

  it("reports every true same-document duplicate declaration", () => {
    const source = [
      "parameters:",
      "  port: 80",
      "  port: 81",
      "services:",
      "  api: App\\First",
      "  api: App\\Second",
    ].join("\n");
    const diagnostics = diagnoseNeonSemanticSnapshot(
      complete(neonSemanticDocumentFactsFromSource("/config.neon", source)),
    );

    expect(diagnostics).toEqual([
      {
        code: "neon.duplicateParameter",
        message:
          "Parameter 'port' is declared more than once in the effective Nette configuration.",
        path: "/config.neon",
        severity: "error",
        span: spanOf(source, "port"),
      },
      {
        code: "neon.duplicateParameter",
        message:
          "Parameter 'port' is declared more than once in the effective Nette configuration.",
        path: "/config.neon",
        severity: "error",
        span: spanOf(source, "port", 2),
      },
      {
        code: "neon.duplicateService",
        message: "Service 'api' is declared more than once in the effective Nette configuration.",
        path: "/config.neon",
        severity: "error",
        span: spanOf(source, "api"),
      },
      {
        code: "neon.duplicateService",
        message: "Service 'api' is declared more than once in the effective Nette configuration.",
        path: "/config.neon",
        severity: "error",
        span: spanOf(source, "api", 2),
      },
    ]);
  });

  it("does not mislabel deterministic cross-document overrides as duplicates", () => {
    const first = "parameters:\n  port: 80\nservices:\n  api: App\\First";
    const override = "parameters:\n  port: 81\nservices:\n  api: App\\Second";
    expect(
      diagnoseNeonSemanticSnapshot(
        complete(
          neonSemanticDocumentFactsFromSource("/base.neon", first),
          neonSemanticDocumentFactsFromSource("/override.neon", override),
        ),
      ),
    ).toEqual([]);
  });

  it("reports each precisely proven alias-cycle edge once", () => {
    const first = "services:\n  alpha: @beta\n  stable: App\\Stable";
    const second = "services:\n  beta: @gamma\n  gamma: @alpha";
    const diagnostics = diagnoseNeonSemanticSnapshot(
      complete(
        neonSemanticDocumentFactsFromSource("/a.neon", first),
        neonSemanticDocumentFactsFromSource("/b.neon", second),
      ),
    );

    expect(diagnostics).toEqual([
      {
        code: "neon.aliasCycle",
        message: "Service alias 'alpha' is part of a circular alias chain.",
        path: "/a.neon",
        severity: "error",
        span: spanOf(first, "@beta"),
      },
      {
        code: "neon.aliasCycle",
        message: "Service alias 'beta' is part of a circular alias chain.",
        path: "/b.neon",
        severity: "error",
        span: spanOf(second, "@gamma"),
      },
      {
        code: "neon.aliasCycle",
        message: "Service alias 'gamma' is part of a circular alias chain.",
        path: "/b.neon",
        severity: "error",
        span: spanOf(second, "@alpha"),
      },
    ]);
  });

  it("reports a unique self-alias cycle exactly once", () => {
    const source = "services:\n  loop: @loop";
    expect(
      diagnoseNeonSemanticSnapshot(
        complete(neonSemanticDocumentFactsFromSource("/self.neon", source)),
      ),
    ).toEqual([
      {
        code: "neon.aliasCycle",
        message: "Service alias 'loop' is part of a circular alias chain.",
        path: "/self.neon",
        severity: "error",
        span: spanOf(source, "@loop"),
      },
    ]);
  });

  it("does not claim an alias cycle when an alias declaration is ambiguous", () => {
    const source = [
      "services:",
      "  alpha: @beta",
      "  alpha: @other",
      "  beta: @alpha",
      "  other: App\\Other",
    ].join("\n");
    const diagnostics = diagnoseNeonSemanticSnapshot(
      complete(neonSemanticDocumentFactsFromSource("/config.neon", source)),
    );

    expect(diagnostics.some(({ code }) => code === "neon.aliasCycle")).toBe(false);
    expect(diagnostics.filter(({ code }) => code === "neon.duplicateService")).toHaveLength(2);
  });

  it.each(["incomplete", "truncated"] as const)(
    "fails closed for a %s effective snapshot",
    (state) => {
      const source = "services:\n  consumer: App\\Consumer(%missing%, @unknown)";
      const diagnostics = diagnoseNeonSemanticSnapshot({
        documents: [neonSemanticDocumentFactsFromSource("/config.neon", source)],
        state,
      });
      expect(diagnostics).toEqual([]);
      expect(Object.isFrozen(diagnostics)).toBe(true);
    },
  );

  it("sorts, deduplicates and caps diagnostics deterministically", () => {
    const source = "services:\n  z: App\\Z(@missingZ)\n  a: App\\A(@missingA)";
    const snapshot = complete(neonSemanticDocumentFactsFromSource("/config.neon", source));
    const duplicateRule: NeonSemanticDiagnosticRule = {
      id: "neon.unresolvedService",
      evaluate: () => [
        {
          code: "neon.unresolvedService",
          message: "duplicate",
          path: "/config.neon",
          severity: "warning",
          span: spanOf(source, "@missingZ"),
        },
      ],
    };

    const diagnostics = diagnoseNeonSemanticSnapshot(snapshot, { maxDiagnostics: 1 }, [
      ...NEON_SEMANTIC_DIAGNOSTIC_RULES,
      duplicateRule,
    ]);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.span).toEqual(spanOf(source, "@missingZ"));
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(Object.isFrozen(diagnostics[0])).toBe(true);
    expect(Object.isFrozen(diagnostics[0]?.span)).toBe(true);
  });

  it("supports disabling diagnostics with a zero cap", () => {
    const source = "services:\n  consumer: App\\Consumer(@unknown)";
    expect(
      diagnoseNeonSemanticSnapshot(
        complete(neonSemanticDocumentFactsFromSource("/config.neon", source)),
        { maxDiagnostics: 0 },
      ),
    ).toEqual([]);
  });

  it("freezes diagnostics returned by injected pure rules", () => {
    const source = "services:\n  x: App\\X";
    const diagnostics = diagnoseNeonSemanticSnapshot(
      complete(neonSemanticDocumentFactsFromSource("C:/Workspace/config.neon", source)),
      undefined,
      [
        {
          id: "neon.unresolvedService",
          evaluate: () => [
            {
              code: "neon.unresolvedService",
              message: "injected",
              path: "C:/Workspace/config.neon",
              severity: "warning",
              span: spanOf(source, "x"),
            },
          ],
        },
      ],
    );

    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(Object.isFrozen(diagnostics[0])).toBe(true);
    expect(Object.isFrozen(diagnostics[0]?.span)).toBe(true);
  });
});

function spanOf(
  source: string,
  needle: string,
  occurrence = 1,
): { readonly end: number; readonly start: number } {
  let start = -1;
  for (let index = 0; index < occurrence; index += 1) start = source.indexOf(needle, start + 1);
  if (start < 0) throw new Error(`Missing test token: ${needle}`);
  return { start, end: start + needle.length };
}
