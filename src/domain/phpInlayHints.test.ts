import { describe, expect, it } from "vitest";
import {
  phpCallArgumentInlayContexts,
  phpParameterNameInlayHints,
} from "./phpInlayHints";
import { phpMethodParameters } from "./phpMethodCompletions";

function lineRange(startLine: number, endLine: number) {
  return { endLine, startLine };
}

describe("phpCallArgumentInlayContexts", () => {
  it("captures a free function call with its positional arguments", () => {
    const source = '<?php\nstore(5, "label");\n';

    const contexts = phpCallArgumentInlayContexts(source, lineRange(1, 1));

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      className: null,
      methodName: "store",
      receiverExpression: null,
    });
    expect(contexts[0].arguments).toHaveLength(2);
    expect(contexts[0].arguments[0]).toMatchObject({
      isLiteral: true,
      isNamed: false,
      variableName: null,
    });
    expect(contexts[0].arguments[1]).toMatchObject({
      isLiteral: true,
      isNamed: false,
    });
  });

  it("captures a member method call with the receiver expression", () => {
    const source = "<?php\n$request->get($key, 10);\n";

    const contexts = phpCallArgumentInlayContexts(source, lineRange(1, 1));

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      className: null,
      methodName: "get",
      receiverExpression: "$request",
      variableName: "$request",
    });
    expect(contexts[0].arguments[0]).toMatchObject({
      isLiteral: false,
      variableName: "$key",
    });
    expect(contexts[0].arguments[1]).toMatchObject({ isLiteral: true });
  });

  it("captures a static method call with the class name", () => {
    const source = "<?php\nThing::make(5);\n";

    const contexts = phpCallArgumentInlayContexts(source, lineRange(1, 1));

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      className: "Thing",
      methodName: "make",
      receiverExpression: null,
    });
  });

  it("marks already-named PHP 8 arguments so the caller can skip them", () => {
    const source = "<?php\nstore(count: 5);\n";

    const contexts = phpCallArgumentInlayContexts(source, lineRange(1, 1));

    expect(contexts[0].arguments[0]).toMatchObject({ isNamed: true });
  });

  it("only returns calls whose opening parenthesis sits inside the range", () => {
    const source = "<?php\nfirst(1);\nsecond(2);\nthird(3);\n";

    const contexts = phpCallArgumentInlayContexts(source, lineRange(2, 2));

    expect(contexts.map((context) => context.methodName)).toEqual(["second"]);
  });

  it("ignores control-flow keywords that look like calls", () => {
    const source = "<?php\nif ($ok) {\n    while (true) {}\n}\n";

    const contexts = phpCallArgumentInlayContexts(source, lineRange(1, 4));

    expect(contexts).toHaveLength(0);
  });

  it("ignores language constructs such as die and require that take arguments", () => {
    const source = '<?php\ndie("stop");\nrequire("file.php");\n';

    const contexts = phpCallArgumentInlayContexts(source, lineRange(1, 2));

    expect(contexts).toHaveLength(0);
  });

  it("still captures a static call to a method named like a keyword", () => {
    const source = "<?php\nFactory::make(5);\n";

    const contexts = phpCallArgumentInlayContexts(source, lineRange(1, 1));

    expect(contexts.map((context) => context.methodName)).toEqual(["make"]);
  });

  it("still captures a member call whose method name matches a keyword", () => {
    const source = "<?php\n$collection->list(5);\n";

    const contexts = phpCallArgumentInlayContexts(source, lineRange(1, 1));

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      methodName: "list",
      receiverExpression: "$collection",
    });
  });

  it("ignores calls with no arguments", () => {
    const source = "<?php\nrun();\n";

    const contexts = phpCallArgumentInlayContexts(source, lineRange(1, 1));

    expect(contexts).toHaveLength(0);
  });

  it("reports the argument position at the start of each argument expression", () => {
    const source = "<?php\nstore(5, 10);\n";

    const contexts = phpCallArgumentInlayContexts(source, lineRange(1, 1));

    // `store(` ends at column 7 (1-based) on line 2 -> first arg at character 6.
    expect(contexts[0].arguments[0]).toMatchObject({
      character: 6,
      line: 1,
    });
    // second arg after ", " -> character 9.
    expect(contexts[0].arguments[1]).toMatchObject({
      character: 9,
      line: 1,
    });
  });
});

describe("phpParameterNameInlayHints", () => {
  it("emits a hint for each positional literal argument", () => {
    const source = "<?php\nstore(5, 10);\n";
    const [call] = phpCallArgumentInlayContexts(source, lineRange(1, 1));
    const parameters = phpMethodParameters("int $count, int $limit = 0");

    const hints = phpParameterNameInlayHints(call, parameters);

    expect(hints).toEqual([
      { character: 6, line: 1, name: "count" },
      { character: 9, line: 1, name: "limit" },
    ]);
  });

  it("skips a variable argument whose name already matches the parameter", () => {
    const source = "<?php\nstore($count, 10);\n";
    const [call] = phpCallArgumentInlayContexts(source, lineRange(1, 1));
    const parameters = phpMethodParameters("int $count, int $limit");

    const hints = phpParameterNameInlayHints(call, parameters);

    expect(hints).toEqual([{ name: "limit", character: 14, line: 1 }]);
  });

  it("emits a hint for a variable argument whose name differs", () => {
    const source = "<?php\nstore($total);\n";
    const [call] = phpCallArgumentInlayContexts(source, lineRange(1, 1));
    const parameters = phpMethodParameters("int $count");

    const hints = phpParameterNameInlayHints(call, parameters);

    expect(hints).toEqual([{ name: "count", character: 6, line: 1 }]);
  });

  it("never emits a hint for an already-named argument", () => {
    const source = "<?php\nstore(count: 5);\n";
    const [call] = phpCallArgumentInlayContexts(source, lineRange(1, 1));
    const parameters = phpMethodParameters("int $count");

    expect(phpParameterNameInlayHints(call, parameters)).toEqual([]);
  });

  it("stops emitting once arguments overflow the declared parameters", () => {
    const source = "<?php\nstore(1, 2, 3);\n";
    const [call] = phpCallArgumentInlayContexts(source, lineRange(1, 1));
    const parameters = phpMethodParameters("int $count");

    expect(phpParameterNameInlayHints(call, parameters)).toEqual([
      { name: "count", character: 6, line: 1 },
    ]);
  });

  it("repeats the variadic parameter name for trailing arguments", () => {
    const source = "<?php\nstore(1, 2, 3);\n";
    const [call] = phpCallArgumentInlayContexts(source, lineRange(1, 1));
    const parameters = phpMethodParameters("int ...$values");

    const hints = phpParameterNameInlayHints(call, parameters);

    expect(hints.map((hint) => hint.name)).toEqual([
      "values",
      "values",
      "values",
    ]);
  });
});
