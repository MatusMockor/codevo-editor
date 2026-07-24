import { describe, expect, it } from "vitest";
import { jsTestDeclarations } from "./jsTestDeclarations";

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
});
