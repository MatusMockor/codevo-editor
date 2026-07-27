import { describe, expect, it } from "vitest";
import {
  JsTestDeclarationBudgetError,
  MAX_JS_TEST_DECLARATION_CANDIDATES,
  MAX_JS_TEST_DECLARATION_RETAINED_PARENTHESIS_MATCHES,
  MAX_JS_TEST_DECLARATION_SUITE_PATH_ENTRIES,
  jsTestDeclarations,
  jsTestDeclarationsWithIndexMetricsForTest,
} from "./jsTestDeclarations";

describe("jsTestDeclarations", () => {
  it("provides nested suite ancestry, full names, targets, and source spans", () => {
    const declarations = jsTestDeclarations(`describe("checkout", () => {
  describe.only("card", () => {
    it("charges", () => {});
  });
});
test("top level", () => {});
`);

    expect(
      declarations.map(({ callSpan, filter, fullName, kind, suitePath, target, title }) => ({
        callSpanComplete: callSpan !== null,
        filter,
        fullName,
        kind,
        position: target.position,
        suitePath,
        title,
      })),
    ).toEqual([
      {
        callSpanComplete: true,
        filter: "checkout",
        fullName: "checkout",
        kind: "suite",
        position: { column: 1, lineNumber: 1 },
        suitePath: [],
        title: "checkout",
      },
      {
        callSpanComplete: true,
        filter: "card",
        fullName: "checkout card",
        kind: "suite",
        position: { column: 3, lineNumber: 2 },
        suitePath: ["checkout"],
        title: "card",
      },
      {
        callSpanComplete: true,
        filter: "charges",
        fullName: "checkout card charges",
        kind: "test",
        position: { column: 5, lineNumber: 3 },
        suitePath: ["checkout", "card"],
        title: "charges",
      },
      {
        callSpanComplete: true,
        filter: "top level",
        fullName: "top level",
        kind: "test",
        position: { column: 1, lineNumber: 6 },
        suitePath: [],
        title: "top level",
      },
    ]);
  });

  it("aggregates chained and tagged .each declarations to stable filter prefixes", () => {
    const declarations = jsTestDeclarations(`describe.each([[1]])("group %i", () => {
  it.only.each([[2]])("case %i", () => {});
});
test.each\`
 value
 \${1}
\`("returns $value", () => {});
`);

    expect(
      declarations.map(({ filter, fullName, parameterized, staticTitle, suitePath, title }) => ({
        filter,
        fullName,
        parameterized,
        staticTitle,
        suitePath,
        title,
      })),
    ).toEqual([
      {
        filter: "group",
        fullName: "group",
        parameterized: true,
        staticTitle: "group %i",
        suitePath: [],
        title: "group",
      },
      {
        filter: "case",
        fullName: "group case",
        parameterized: true,
        staticTitle: "case %i",
        suitePath: ["group"],
        title: "case",
      },
      {
        filter: "returns",
        fullName: "returns",
        parameterized: true,
        staticTitle: "returns $value",
        suitePath: [],
        title: "returns",
      },
    ]);
  });

  it("accepts static templates but safely ignores dynamic declarations and their subtree", () => {
    const declarations = jsTestDeclarations(`describe(name, () => {
  it("cannot have reliable ancestry", () => {});
});
it(\`static template\`, () => {});
it(\`dynamic \${name}\`, () => {});
`);

    expect(declarations.map(({ fullName }) => fullName)).toEqual(["static template"]);
  });

  it("preserves malformed-suite fail-closed behavior without suppressing dynamic test siblings", () => {
    const declarations = jsTestDeclarations(`it(dynamicTitle, () => {});
it("visible before malformed suite", () => {});
describe(dynamicSuite, () => {
  it("hidden by malformed suite", () => {});
it("also hidden because containment is unknowable", () => {});
`);

    expect(declarations.map(({ fullName }) => fullName)).toEqual([
      "visible before malformed suite",
    ]);
  });

  it("does not expose a dynamic-suite child after a stray closing parenthesis", () => {
    const declarations = jsTestDeclarations(
      `describe(dynamic,()=>{ ) it("should hide",()=>{}); });`,
    );

    expect(declarations).toEqual([]);
  });

  it("contains empty and placeholder-only invalid suites to their exact subtree", () => {
    const declarations = jsTestDeclarations(`describe("", () => {
  it("hidden by empty suite", () => {});
});
it("visible middle", () => {});
describe.each([[1]])("%i", () => {
  it("hidden by placeholder-only suite", () => {});
});
it("visible last", () => {});
`);

    expect(declarations.map(({ fullName }) => fullName)).toEqual([
      "visible middle",
      "visible last",
    ]);
  });

  it("keeps UTF-16 positions and Unicode titles exact", () => {
    const declarations = jsTestDeclarations(`const prefix = "😀😀";
  it("🧪 works", () => {});
`);

    expect(declarations).toHaveLength(1);
    expect(declarations[0]?.title).toBe("🧪 works");
    expect(declarations[0]?.target.position).toEqual({ column: 3, lineNumber: 2 });
  });

  it("matches a simple structural reference across bounded deterministic generated cases", () => {
    const random = deterministicRandom(0x5eed_1234);

    for (let caseIndex = 0; caseIndex < 80; caseIndex += 1) {
      const nodes = generatedNodes(random, 0, 4 + Math.floor(random() * 18));
      const reference = renderGeneratedReference(nodes);
      const actual = jsTestDeclarations(reference.source).map(
        ({ filter, fullName, kind, parameterized, staticTitle, suitePath, target }) => ({
          filter,
          fullName,
          kind,
          parameterized,
          position: target.position,
          staticTitle,
          suitePath,
        }),
      );

      expect(actual, `generated case ${caseIndex}`).toEqual(reference.declarations);
    }
  });

  it("indexes 20k flat declarations with bounded near-linear candidate work", () => {
    const source = Array.from(
      { length: 20_000 },
      (_, index) => `it("case ${index}", () => {});`,
    ).join("\n");
    const { declarations, metrics } = jsTestDeclarationsWithIndexMetricsForTest(source);

    expect(declarations).toHaveLength(20_000);
    expect(declarations[0]?.fullName).toBe("case 0");
    expect(declarations[declarations.length - 1]?.fullName).toBe("case 19999");
    expect(declarations[declarations.length - 1]?.target.position).toEqual({
      column: 1,
      lineNumber: 20_000,
    });
    expect(metrics).toEqual({
      candidateCount: 20_000,
      indexOperations: 40_000,
      retainedParenthesisMatches: 20_000,
      suitePathEntries: 0,
    });
  });

  it("does not retain unrelated parenthesis pairs when no declaration heads exist", () => {
    const source = "()".repeat(200_000);
    const { declarations, metrics } = jsTestDeclarationsWithIndexMetricsForTest(source);

    expect(declarations).toEqual([]);
    expect(metrics).toEqual({
      candidateCount: 0,
      indexOperations: 0,
      retainedParenthesisMatches: 0,
      suitePathEntries: 0,
    });
  });

  it("fails closed within a bounded ancestry budget instead of materializing quadratic deep paths", () => {
    const depth = 8_000;
    const source = `${'describe("s", () => {'.repeat(depth)}
it("leaf", () => {});
${"});".repeat(depth)}`;

    try {
      jsTestDeclarationsWithIndexMetricsForTest(source);
      throw new Error("Expected deeply nested discovery to exceed its ancestry budget");
    } catch (error) {
      expect(error).toBeInstanceOf(JsTestDeclarationBudgetError);
      const budgetError = error as JsTestDeclarationBudgetError;
      expect(budgetError.message).toContain("no partial results were published");
      expect(budgetError.candidateCount).toBe(depth + 1);
      expect(budgetError.limitKind).toBe("ancestry");
      expect(budgetError.retainedParenthesisMatches).toBe(depth + 1);
      expect(budgetError.suitePathEntries).toBeGreaterThan(
        MAX_JS_TEST_DECLARATION_SUITE_PATH_ENTRIES,
      );
      expect(budgetError.suitePathEntries).toBeLessThan(
        MAX_JS_TEST_DECLARATION_SUITE_PATH_ENTRIES + depth,
      );
      expect(budgetError.indexOperations).toBeLessThan(2_000);
    }
  });

  it("fails closed before retaining an unbounded direct invocation chain", () => {
    const source = `it("x",()=>{})${"()".repeat(200_000)}`;

    try {
      jsTestDeclarationsWithIndexMetricsForTest(source);
      throw new Error("Expected a direct invocation chain to exceed the parenthesis budget");
    } catch (error) {
      expect(error).toBeInstanceOf(JsTestDeclarationBudgetError);
      const budgetError = error as JsTestDeclarationBudgetError;
      expect(budgetError.limitKind).toBe("parentheses");
      expect(budgetError.candidateCount).toBe(1);
      expect(budgetError.indexOperations).toBe(0);
      expect(budgetError.retainedParenthesisMatches).toBe(
        MAX_JS_TEST_DECLARATION_RETAINED_PARENTHESIS_MATCHES + 1,
      );
      expect(budgetError.suitePathEntries).toBe(0);
    }
  });

  it("fails closed before unmatched declaration openings grow parser indexes without bound", () => {
    const source = 'it("x",'.repeat(100_000);

    try {
      jsTestDeclarationsWithIndexMetricsForTest(source);
      throw new Error("Expected unmatched declaration openings to exceed the candidate budget");
    } catch (error) {
      expect(error).toBeInstanceOf(JsTestDeclarationBudgetError);
      const budgetError = error as JsTestDeclarationBudgetError;
      expect(budgetError.limitKind).toBe("candidates");
      expect(budgetError.candidateCount).toBe(MAX_JS_TEST_DECLARATION_CANDIDATES + 1);
      expect(budgetError.indexOperations).toBe(0);
      expect(budgetError.retainedParenthesisMatches).toBe(0);
      expect(budgetError.suitePathEntries).toBe(0);
    }
  });
});

type GeneratedNode =
  | {
      readonly children: readonly GeneratedNode[];
      readonly kind: "suite";
      readonly parameterized: boolean;
      readonly staticTitle: boolean;
      readonly title: string;
    }
  | {
      readonly kind: "test";
      readonly parameterized: boolean;
      readonly staticTitle: boolean;
      readonly title: string;
    };

interface GeneratedReferenceDeclaration {
  readonly filter: string;
  readonly fullName: string;
  readonly kind: "suite" | "test";
  readonly parameterized: boolean;
  readonly position: {
    readonly column: number;
    readonly lineNumber: number;
  };
  readonly staticTitle: string;
  readonly suitePath: readonly string[];
}

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function generatedNodes(random: () => number, depth: number, remaining: number): GeneratedNode[] {
  const nodes: GeneratedNode[] = [];
  let available = remaining;
  while (available > 0) {
    const identifier = `${depth}-${available}-${Math.floor(random() * 10_000)}`;
    const suite = depth < 3 && available > 2 && random() < 0.38;
    const staticTitle = random() >= 0.22;
    const parameterized = staticTitle && random() < 0.28;
    if (!suite) {
      nodes.push({
        kind: "test",
        parameterized,
        staticTitle,
        title: `test ${identifier}`,
      });
      available -= 1;
      continue;
    }

    const childCount = Math.min(available - 1, 1 + Math.floor(random() * 4));
    nodes.push({
      children: generatedNodes(random, depth + 1, childCount),
      kind: "suite",
      parameterized,
      staticTitle,
      title: `suite ${identifier}`,
    });
    available -= childCount + 1;
  }
  return nodes;
}

function renderGeneratedReference(nodes: readonly GeneratedNode[]): {
  readonly declarations: readonly GeneratedReferenceDeclaration[];
  readonly source: string;
} {
  const declarations: GeneratedReferenceDeclaration[] = [];
  const lines: string[] = [];

  const render = (
    currentNodes: readonly GeneratedNode[],
    depth: number,
    suitePath: readonly string[],
    blockedByDynamicSuite: boolean,
  ): void => {
    for (const node of currentNodes) {
      const indentation = "  ".repeat(depth);
      const staticTitle = node.parameterized ? `${node.title} %i` : node.title;
      const filter = node.title;
      const callName = node.kind === "suite" ? "describe" : "it";
      const callHead = node.parameterized ? `${callName}.each([[1]])` : callName;
      const titleExpression = node.staticTitle
        ? JSON.stringify(staticTitle)
        : `dynamic_${depth}_${lines.length}`;
      const lineNumber = lines.length + 1;
      lines.push(
        node.kind === "suite"
          ? `${indentation}${callHead}(${titleExpression}, () => {`
          : `${indentation}${callHead}(${titleExpression}, () => {});`,
      );

      const admitted = node.staticTitle && !blockedByDynamicSuite;
      if (admitted) {
        declarations.push({
          filter,
          fullName: [...suitePath, filter].join(" "),
          kind: node.kind,
          parameterized: node.parameterized,
          position: { column: indentation.length + 1, lineNumber },
          staticTitle,
          suitePath,
        });
      }

      if (node.kind === "suite") {
        render(
          node.children,
          depth + 1,
          admitted ? [...suitePath, filter] : suitePath,
          blockedByDynamicSuite || !node.staticTitle,
        );
        lines.push(`${indentation}});`);
      }
    }
  };

  render(nodes, 0, [], false);
  return { declarations, source: `${lines.join("\n")}\n` };
}
