import { describe, expect, it } from "vitest";
import {
  jsTestGutterTargets,
  runAllJsTestsTarget,
} from "./jsTestGutterTargets";

describe("jsTestGutterTargets", () => {
  it("emits a class target per describe and a method target per it/test", () => {
    expect(
      jsTestGutterTargets(`describe("math", () => {
  it("adds two numbers", () => {});

  test("subtracts two numbers", function () {});
});
`),
    ).toEqual([
      {
        filter: "math",
        kind: "class",
        label: "Run math",
        match: "description",
        position: { column: 1, lineNumber: 1 },
      },
      {
        filter: "adds two numbers",
        kind: "method",
        label: "Run adds two numbers",
        match: "description",
        position: { column: 3, lineNumber: 2 },
      },
      {
        filter: "subtracts two numbers",
        kind: "method",
        label: "Run subtracts two numbers",
        match: "description",
        position: { column: 3, lineNumber: 4 },
      },
    ]);
  });

  it("emits nested describe blocks as separate class targets", () => {
    const targets = jsTestGutterTargets(`describe("outer", () => {
  describe("inner", () => {
    it("works", () => {});
  });
});
`);

    expect(
      targets.map((target) => [target.kind, target.filter]),
    ).toEqual([
      ["class", "outer"],
      ["class", "inner"],
      ["method", "works"],
    ]);
  });

  it("recognises .only/.skip/.todo/.fails/.concurrent/.sequential modifiers", () => {
    const targets = jsTestGutterTargets(`describe.only("suite", () => {
  it.skip("skipped", () => {});
  it.fails("failing", () => {});
  it.concurrent("concurrent", () => {});
  test.todo("todo");
});
describe.sequential("ordered", () => {});
`);

    expect(targets.map((target) => target.filter)).toEqual([
      "suite",
      "skipped",
      "failing",
      "concurrent",
      "todo",
      "ordered",
    ]);
  });

  it("uses the static title prefix before %-placeholders for .each targets", () => {
    const targets = jsTestGutterTargets(
      `it.each([[1, 2, 3]])("adds %i and %i", (a, b, expected) => {});
`,
    );

    expect(targets).toEqual([
      {
        filter: "adds",
        kind: "method",
        label: "Run adds",
        match: "description",
        position: { column: 1, lineNumber: 1 },
      },
    ]);
  });

  it("uses the static title prefix before $var placeholders for .each targets", () => {
    const targets = jsTestGutterTargets(
      `test.each(cases)("returns $expected for $input", () => {});
`,
    );

    expect(targets.map((target) => target.filter)).toEqual(["returns"]);
  });

  it("supports describe.each and chained modifiers with .each", () => {
    const targets = jsTestGutterTargets(`describe.each([[1]])("group %i", () => {
  it.only.each([[2]])("case %i", () => {});
});
`);

    expect(
      targets.map((target) => [target.kind, target.filter]),
    ).toEqual([
      ["class", "group"],
      ["method", "case"],
    ]);
  });

  it("supports the tagged template table form of .each", () => {
    const targets = jsTestGutterTargets(
      "it.each`\n  a | b\n  ${1} | ${2}\n`(\"adds $a\", () => {});\n",
    );

    expect(targets.map((target) => target.filter)).toEqual(["adds"]);
  });

  it("skips an .each target whose title starts with a placeholder", () => {
    expect(
      jsTestGutterTargets(`it.each([[1]])("%i is odd", () => {});
`),
    ).toEqual([]);
  });

  it("keeps the whole title for an .each target without placeholders", () => {
    const targets = jsTestGutterTargets(
      `it.each([[1]])("static title", () => {});
`,
    );

    expect(targets.map((target) => target.filter)).toEqual(["static title"]);
  });

  it("accepts template literal titles without interpolation", () => {
    const targets = jsTestGutterTargets("it(`works fine`, () => {});\n");

    expect(targets.map((target) => target.filter)).toEqual(["works fine"]);
  });

  it("skips template literal titles with interpolation", () => {
    expect(
      jsTestGutterTargets("it(`works ${name}`, () => {});\n"),
    ).toEqual([]);
  });

  it("unescapes quotes inside titles", () => {
    const targets = jsTestGutterTargets(`it('it\\'s fine', () => {});
test("say \\"hi\\"", () => {});
`);

    expect(targets.map((target) => target.filter)).toEqual([
      "it's fine",
      'say "hi"',
    ]);
  });

  it("ignores describe/it/test occurrences inside comments", () => {
    expect(
      jsTestGutterTargets(`// it("in a line comment", () => {});
/*
describe("in a block comment", () => {});
test("also here", () => {});
*/
`),
    ).toEqual([]);
  });

  it("ignores describe/it/test occurrences inside string literals", () => {
    expect(
      jsTestGutterTargets(`const a = 'it("nope", () => {})';
const b = "describe('nope')(";
const c = \`test("nope")\`;
`),
    ).toEqual([]);
  });

  it("ignores member calls and identifiers that merely contain the names", () => {
    expect(
      jsTestGutterTargets(`runner.it("member call");
xit("prefixed");
testify("suffixed");
`),
    ).toEqual([]);
  });

  it("skips dynamic and empty titles", () => {
    expect(
      jsTestGutterTargets(`it(title, () => {});
it("", () => {});
it(42, () => {});
`),
    ).toEqual([]);
  });

  it("emits targets regardless of arrow or function callbacks", () => {
    const targets = jsTestGutterTargets(`it("arrow", () => {});
it("classic", function () {});
it("async", async () => {});
`);

    expect(targets.map((target) => target.filter)).toEqual([
      "arrow",
      "classic",
      "async",
    ]);
  });
});

describe("runAllJsTestsTarget", () => {
  it("returns the first describe when it wraps every other target", () => {
    const source = `describe("suite", () => {
  describe("inner", () => {
    it("first", () => {});
  });
  it("second", () => {});
});
`;
    const targets = jsTestGutterTargets(source);

    expect(runAllJsTestsTarget(source, targets)).toBe(targets[0]);
  });

  it("returns null when sibling describes exist at the top level", () => {
    const source = `describe("first suite", () => {});
describe("second suite", () => {});
`;

    expect(runAllJsTestsTarget(source, jsTestGutterTargets(source))).toBeNull();
  });

  it("returns null when a top-level test exists outside the describe", () => {
    const source = `it("standalone", () => {});
describe("suite", () => {
  it("inside", () => {});
});
`;

    expect(runAllJsTestsTarget(source, jsTestGutterTargets(source))).toBeNull();
  });

  it("returns null for a file with only top-level tests", () => {
    const source = `it("first", () => {});
test("second", () => {});
`;

    expect(runAllJsTestsTarget(source, jsTestGutterTargets(source))).toBeNull();
  });

  it("returns null when there are no targets", () => {
    expect(runAllJsTestsTarget("const x = 1;\n", [])).toBeNull();
  });

  it("returns null for an unbalanced mid-edit describe call", () => {
    const source = `describe("suite", () => {
  it("inside", () => {});
`;

    expect(runAllJsTestsTarget(source, jsTestGutterTargets(source))).toBeNull();
  });

  it("covers targets inside a describe.each body", () => {
    const source = `describe.each([[1]])("group %i", () => {
  it("case", () => {});
});
`;
    const targets = jsTestGutterTargets(source);

    expect(runAllJsTestsTarget(source, targets)).toBe(targets[0]);
  });
});
