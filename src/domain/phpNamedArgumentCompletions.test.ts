import { describe, expect, it } from "vitest";
import type { PhpMethodCompletion } from "./phpMethodCompletions";
import {
  phpNamedArgumentCallableMembersFromSource,
  phpNamedArgumentCompletionContextAt,
  phpNamedArgumentCompletions,
  phpVersionSupportsNamedArguments,
} from "./phpNamedArgumentCompletions";

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  return positionAt(source, offset + needle.length);
}

function positionAt(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}

function member(
  name: string,
  parameters: string,
  overrides: Partial<PhpMethodCompletion> = {},
): PhpMethodCompletion {
  return {
    declaringClassName: "App\\Models\\User",
    name,
    parameters,
    returnType: null,
    ...overrides,
  };
}

describe("phpNamedArgumentCompletionContextAt", () => {
  it("detects a constructor call context", () => {
    const source = "<?php\n$user = new User(";
    const context = phpNamedArgumentCompletionContextAt(
      source,
      positionAfter(source, "new User("),
    );

    expect(context).toEqual({
      callTarget: { className: "User", kind: "constructor" },
      positionalArgumentCount: 0,
      prefix: "",
      usedArgumentNames: [],
    });
  });

  it("detects a namespaced constructor call context", () => {
    const source = "<?php\n$user = new \\App\\Models\\User(na";
    const context = phpNamedArgumentCompletionContextAt(
      source,
      positionAfter(source, "(na"),
    );

    expect(context).toEqual({
      callTarget: { className: "App\\Models\\User", kind: "constructor" },
      positionalArgumentCount: 0,
      prefix: "na",
      usedArgumentNames: [],
    });
  });

  it("detects a member method call context with typed prefix", () => {
    const source = "<?php\n$this->send($to, su";
    const context = phpNamedArgumentCompletionContextAt(
      source,
      positionAfter(source, "su"),
    );

    expect(context).toEqual({
      callTarget: {
        kind: "member-method",
        methodName: "send",
        receiverExpression: "$this",
      },
      positionalArgumentCount: 1,
      prefix: "su",
      usedArgumentNames: [],
    });
  });

  it("detects a static method call context and collects used named arguments", () => {
    const source = "<?php\nUser::create(name: 'Ada', ";
    const context = phpNamedArgumentCompletionContextAt(
      source,
      positionAfter(source, "'Ada', "),
    );

    expect(context).toEqual({
      callTarget: {
        className: "User",
        kind: "static-method",
        methodName: "create",
      },
      positionalArgumentCount: 0,
      prefix: "",
      usedArgumentNames: ["name"],
    });
  });

  it("detects self static calls", () => {
    const source = "<?php\nself::make(";
    const context = phpNamedArgumentCompletionContextAt(
      source,
      positionAfter(source, "make("),
    );

    expect(context?.callTarget).toEqual({
      className: "self",
      kind: "static-method",
      methodName: "make",
    });
  });

  it("resolves the innermost open call", () => {
    const source = "<?php\n$mail->queue($this->build(";
    const context = phpNamedArgumentCompletionContextAt(
      source,
      positionAfter(source, "build("),
    );

    expect(context?.callTarget).toEqual({
      kind: "member-method",
      methodName: "build",
      receiverExpression: "$this",
    });
  });

  it("detects ordinary function calls", () => {
    const source = "<?php\nfoo($a, ";
    expect(
      phpNamedArgumentCompletionContextAt(
        source,
        positionAfter(source, "$a, "),
      ),
    ).toMatchObject({
      callTarget: { functionName: "foo", kind: "function" },
      positionalArgumentCount: 1,
    });
  });

  it("detects local callable variables", () => {
    const source =
      "<?php\n$format = fn(string $value, int $precision = 2) => '';\n$format(pr";
    expect(
      phpNamedArgumentCompletionContextAt(
        source,
        positionAfter(source, "$format(pr"),
      ),
    ).toMatchObject({
      callTarget: { kind: "local-callable", variableName: "format" },
      prefix: "pr",
    });
  });

  it("returns null for function declarations", () => {
    const source = "<?php\nfunction handle(";
    expect(
      phpNamedArgumentCompletionContextAt(
        source,
        positionAfter(source, "handle("),
      ),
    ).toBeNull();
  });

  it("returns null for method declarations", () => {
    const source = "<?php\nclass A { public function handle(";
    expect(
      phpNamedArgumentCompletionContextAt(
        source,
        positionAfter(source, "handle("),
      ),
    ).toBeNull();
  });

  it("returns null for closure declarations", () => {
    const source = "<?php\n$fn = function (";
    expect(
      phpNamedArgumentCompletionContextAt(
        source,
        positionAfter(source, "function ("),
      ),
    ).toBeNull();
  });

  it("returns null for arrow function declarations", () => {
    const source = "<?php\n$fn = fn(";
    expect(
      phpNamedArgumentCompletionContextAt(source, positionAfter(source, "fn(")),
    ).toBeNull();
  });

  it("returns null for array and list constructs", () => {
    const arraySource = "<?php\n$items = array(";
    const listSource = "<?php\nlist(";

    expect(
      phpNamedArgumentCompletionContextAt(
        arraySource,
        positionAfter(arraySource, "array("),
      ),
    ).toBeNull();
    expect(
      phpNamedArgumentCompletionContextAt(
        listSource,
        positionAfter(listSource, "list("),
      ),
    ).toBeNull();
  });

  it("returns null after argument unpacking", () => {
    const source = "<?php\nfoo(...$arguments, na";
    expect(
      phpNamedArgumentCompletionContextAt(source, positionAfter(source, "na")),
    ).toBeNull();
  });

  it("returns null for first-class callable syntax", () => {
    const source = "<?php\nfoo(...";
    expect(
      phpNamedArgumentCompletionContextAt(source, positionAfter(source, "...")),
    ).toBeNull();
  });

  it("respects PHP version constraints", () => {
    const source = "<?php\nfoo(na";
    const position = positionAfter(source, "na");

    expect(
      phpNamedArgumentCompletionContextAt(source, position, "^7.4"),
    ).toBeNull();
    expect(
      phpNamedArgumentCompletionContextAt(source, position, "^8.1"),
    ).not.toBeNull();
    expect(
      phpNamedArgumentCompletionContextAt(source, position, "^7.4 || ^8.2"),
    ).toBeNull();
  });

  it("returns null for static calls on dynamic class expressions", () => {
    const source = "<?php\n$class::create(";
    expect(
      phpNamedArgumentCompletionContextAt(
        source,
        positionAfter(source, "create("),
      ),
    ).toBeNull();
  });

  it("returns null for anonymous class instantiation", () => {
    const source = "<?php\n$a = new class(";
    expect(
      phpNamedArgumentCompletionContextAt(
        source,
        positionAfter(source, "class("),
      ),
    ).toBeNull();
  });

  it("returns null inside string arguments", () => {
    const source = "<?php\n$this->send('na";
    expect(
      phpNamedArgumentCompletionContextAt(source, positionAfter(source, "'na")),
    ).toBeNull();
  });

  it("returns null inside comments", () => {
    const source = "<?php\n$this->send(/* na";
    expect(
      phpNamedArgumentCompletionContextAt(source, positionAfter(source, "na")),
    ).toBeNull();
  });

  it("returns null inside heredoc and nowdoc bodies", () => {
    for (const source of [
      "<?php\n$text = <<<TEXT\nfoo(na\nTEXT;",
      "<?php\n$text = <<<'TEXT'\nfoo(na\nTEXT;",
    ]) {
      expect(
        phpNamedArgumentCompletionContextAt(
          source,
          positionAfter(source, "foo(na"),
        ),
      ).toBeNull();
    }
  });

  it("returns null when the current argument is not a bare identifier", () => {
    const source = "<?php\n$this->send($use";
    expect(
      phpNamedArgumentCompletionContextAt(
        source,
        positionAfter(source, "$use"),
      ),
    ).toBeNull();
  });

  it("returns null when no call is open at the cursor", () => {
    const source = "<?php\n$this->send($a);\n$x = ";
    expect(
      phpNamedArgumentCompletionContextAt(
        source,
        positionAfter(source, "$x = "),
      ),
    ).toBeNull();
  });

  it("counts array arguments as a single positional argument", () => {
    const source = "<?php\n$this->send([1, 2], ";
    const context = phpNamedArgumentCompletionContextAt(
      source,
      positionAfter(source, "], "),
    );

    expect(context?.positionalArgumentCount).toBe(1);
    expect(context?.usedArgumentNames).toEqual([]);
  });
});

describe("phpNamedArgumentCompletions", () => {
  const constructorMembers = [
    member("__construct", "string $name, int $age, ?string $email = null"),
    member("save", "bool $quietly = false"),
  ];

  it("offers all constructor parameters as named arguments", () => {
    const context = {
      callTarget: { className: "User", kind: "constructor" as const },
      positionalArgumentCount: 0,
      prefix: "",
      usedArgumentNames: [],
    };

    const completions = phpNamedArgumentCompletions(
      context,
      constructorMembers,
    );

    expect(completions.map((completion) => completion.name)).toEqual([
      "name:",
      "age:",
      "email:",
    ]);
    expect(completions[0]).toMatchObject({
      completionBehavior: {
        insertTextMode: "plain",
        triggerParameterHints: false,
      },
      declaringClassName: "App\\Models\\User",
      insertText: "name: ",
      kind: "property",
      returnType: "string",
    });
  });

  it("skips parameters consumed by positional arguments before the cursor", () => {
    const context = {
      callTarget: { className: "User", kind: "constructor" as const },
      positionalArgumentCount: 1,
      prefix: "",
      usedArgumentNames: [],
    };

    expect(
      phpNamedArgumentCompletions(context, constructorMembers).map(
        (completion) => completion.name,
      ),
    ).toEqual(["age:", "email:"]);
  });

  it("skips already used named arguments", () => {
    const context = {
      callTarget: { className: "User", kind: "constructor" as const },
      positionalArgumentCount: 0,
      prefix: "",
      usedArgumentNames: ["age"],
    };

    expect(
      phpNamedArgumentCompletions(context, constructorMembers).map(
        (completion) => completion.name,
      ),
    ).toEqual(["name:", "email:"]);
  });

  it("filters parameters by the typed prefix", () => {
    const context = {
      callTarget: { className: "User", kind: "constructor" as const },
      positionalArgumentCount: 0,
      prefix: "em",
      usedArgumentNames: [],
    };

    expect(
      phpNamedArgumentCompletions(context, constructorMembers).map(
        (completion) => completion.name,
      ),
    ).toEqual(["email:"]);
  });

  it("resolves method targets by name", () => {
    const context = {
      callTarget: {
        kind: "member-method" as const,
        methodName: "save",
        receiverExpression: "$user",
      },
      positionalArgumentCount: 0,
      prefix: "",
      usedArgumentNames: [],
    };

    expect(
      phpNamedArgumentCompletions(context, constructorMembers).map(
        (completion) => completion.name,
      ),
    ).toEqual(["quietly:"]);
  });

  it("skips variadic parameters", () => {
    const context = {
      callTarget: {
        kind: "member-method" as const,
        methodName: "push",
        receiverExpression: "$queue",
      },
      positionalArgumentCount: 0,
      prefix: "",
      usedArgumentNames: [],
    };

    expect(
      phpNamedArgumentCompletions(context, [
        member("push", "string $channel, mixed ...$payload"),
      ]).map((completion) => completion.name),
    ).toEqual(["channel:"]);
  });

  it("returns nothing when the target method is unknown", () => {
    const context = {
      callTarget: {
        kind: "member-method" as const,
        methodName: "unknown",
        receiverExpression: "$user",
      },
      positionalArgumentCount: 0,
      prefix: "",
      usedArgumentNames: [],
    };

    expect(phpNamedArgumentCompletions(context, constructorMembers)).toEqual(
      [],
    );
  });

  it("returns nothing for property kind members with a matching name", () => {
    const context = {
      callTarget: {
        kind: "member-method" as const,
        methodName: "items",
        receiverExpression: "$user",
      },
      positionalArgumentCount: 0,
      prefix: "",
      usedArgumentNames: [],
    };

    expect(
      phpNamedArgumentCompletions(context, [
        member("items", "", { kind: "property" }),
      ]),
    ).toEqual([]);
  });
});

describe("phpNamedArgumentCallableMembersFromSource", () => {
  it("reads a local named function signature without guessing", () => {
    const source =
      "<?php\nfunction render(string $view, array $data = []): string { return ''; }\nrender(da";
    const context = phpNamedArgumentCompletionContextAt(
      source,
      positionAfter(source, "render(da"),
    );

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCompletions(
        context!,
        phpNamedArgumentCallableMembersFromSource(source, context!),
      ).map((completion) => completion.name),
    ).toEqual(["data:"]);
  });

  it("reads the latest statically assigned closure signature", () => {
    const source = [
      "<?php",
      "$format = static function (string $value, int $precision = 2): string { return ''; };",
      "$format(pre",
    ].join("\n");
    const context = phpNamedArgumentCompletionContextAt(
      source,
      positionAfter(source, "$format(pre"),
    );

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCompletions(
        context!,
        phpNamedArgumentCallableMembersFromSource(source, context!),
      ).map((completion) => completion.name),
    ).toEqual(["precision:"]);
  });

  it("does not invent a signature for an unresolved callable", () => {
    const source = "<?php\n$callback(na";
    const context = phpNamedArgumentCompletionContextAt(
      source,
      positionAfter(source, "na"),
    );

    expect(context).not.toBeNull();
    expect(phpNamedArgumentCallableMembersFromSource(source, context!)).toEqual(
      [],
    );
  });

  it("does not confuse a class method with an ordinary function", () => {
    const source =
      "<?php\nclass Service { public function render(string $view): void {} }\nrender(vi";
    const position = positionAfter(source, "render(vi");
    const context = phpNamedArgumentCompletionContextAt(source, position);

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCallableMembersFromSource(source, context!, position),
    ).toEqual([]);
  });

  it("does not resolve a differently namespaced function by short name", () => {
    const source = [
      "<?php namespace App;",
      "function render(string $view): void {}",
      "Other\\render(vi",
    ].join("\n");
    const position = positionAfter(source, "Other\\render(vi");
    const context = phpNamedArgumentCompletionContextAt(source, position);

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCallableMembersFromSource(source, context!, position),
    ).toEqual([]);
  });

  it("resolves the function from the namespace active at the call site", () => {
    const source = [
      "<?php",
      "namespace First { function render(string $wrong): void {} }",
      "namespace Second { function render(string $right): void {} render(ri",
      "}",
    ].join("\n");
    const position = positionAfter(source, "render(ri");
    const context = phpNamedArgumentCompletionContextAt(source, position);

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCompletions(
        context!,
        phpNamedArgumentCallableMembersFromSource(source, context!, position),
      ).map((completion) => completion.name),
    ).toEqual(["right:"]);
  });

  it("resolves a safely imported local function alias", () => {
    const source = [
      "<?php",
      "namespace Library { function render(string $view): void {} }",
      "namespace App { use function Library\\render as output; output(vi",
      "}",
    ].join("\n");
    const position = positionAfter(source, "output(vi");
    const context = phpNamedArgumentCompletionContextAt(source, position);

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCompletions(
        context!,
        phpNamedArgumentCallableMembersFromSource(source, context!, position),
      ).map((completion) => completion.name),
    ).toEqual(["view:"]);
  });

  it("does not use a function declaration after the call site", () => {
    const source = "<?php\nrender(vi);\nfunction render(string $view): void {}";
    const position = positionAfter(source, "render(vi");
    const context = phpNamedArgumentCompletionContextAt(source, position);

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCallableMembersFromSource(source, context!, position),
    ).toEqual([]);
  });

  it("ignores fake function and callable declarations inside heredoc", () => {
    const source = [
      "<?php",
      "$text = <<<TEXT",
      "function render(string $fake): void {}",
      "$format = fn(string $fake) => '';",
      "TEXT;",
      "render(fa);",
      "$format(fa",
    ].join("\n");
    const position = positionAfter(source, "$format(fa");
    const context = phpNamedArgumentCompletionContextAt(source, position);

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCallableMembersFromSource(source, context!, position),
    ).toEqual([]);
  });

  it("does not treat heredoc-like text inside a string as a heredoc opener", () => {
    const source = [
      "<?php",
      "function render(string $view): void {}",
      '$text = "<<<TEXT\\nnot a heredoc";',
      "render(vi",
    ].join("\n");
    const position = positionAfter(source, "render(vi");
    const context = phpNamedArgumentCompletionContextAt(source, position);

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCompletions(
        context!,
        phpNamedArgumentCallableMembersFromSource(source, context!, position),
      ).map((completion) => completion.name),
    ).toEqual(["view:"]);
  });

  it("ignores a callable assignment that occurs after the call", () => {
    const source = "$format(pre\n$format = fn(int $precision) => '';";
    const position = positionAfter(source, "$format(pre");
    const context = phpNamedArgumentCompletionContextAt(source, position);

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCallableMembersFromSource(source, context!, position),
    ).toEqual([]);
  });

  it("invalidates a closure signature after a later dynamic reassignment", () => {
    const source = [
      "$format = fn(int $precision) => '';",
      "$format = $runtimeCallable;",
      "$format(pre",
    ].join("\n");
    const position = positionAfter(source, "$format(pre");
    const context = phpNamedArgumentCompletionContextAt(source, position);

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCallableMembersFromSource(source, context!, position),
    ).toEqual([]);
  });

  it("does not leak callable assignments between methods with the same variable name", () => {
    const source = [
      "<?php",
      "class Formatter {",
      "  public function first(): void {",
      "    $format = fn(string $wrong) => '';",
      "  }",
      "  public function second(): void {",
      "    $format = fn(int $right) => '';",
      "    $format(ri",
      "  }",
      "}",
    ].join("\n");
    const position = positionAfter(source, "$format(ri");
    const context = phpNamedArgumentCompletionContextAt(source, position);

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCompletions(
        context!,
        phpNamedArgumentCallableMembersFromSource(source, context!, position),
      ).map((completion) => completion.name),
    ).toEqual(["right:"]);
  });

  it("does not use a callable assigned in another method", () => {
    const source = [
      "<?php",
      "class Formatter {",
      "  public function first(): void {",
      "    $format = fn(string $wrong) => '';",
      "  }",
      "  public function second(): void {",
      "    $format(wr",
      "  }",
      "}",
    ].join("\n");
    const position = positionAfter(source, "$format(wr");
    const context = phpNamedArgumentCompletionContextAt(source, position);

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCallableMembersFromSource(source, context!, position),
    ).toEqual([]);
  });

  it("does not leak a callable from a method into top-level code", () => {
    const source = [
      "<?php",
      "class Formatter {",
      "  public function configure(): void {",
      "    $format = fn(string $wrong) => '';",
      "  }",
      "}",
      "$format(wr",
    ].join("\n");
    const position = positionAfter(source, "$format(wr");
    const context = phpNamedArgumentCompletionContextAt(source, position);

    expect(context).not.toBeNull();
    expect(
      phpNamedArgumentCallableMembersFromSource(source, context!, position),
    ).toEqual([]);
  });
});

describe("phpVersionSupportsNamedArguments", () => {
  it.each([
    [null, true],
    ["^8.0", true],
    [">=8.1 <9.0", true],
    ["^7.4", false],
    ["^7.4 || ^8.2", false],
  ])("evaluates %s conservatively", (constraint, expected) => {
    expect(phpVersionSupportsNamedArguments(constraint)).toBe(expected);
  });
});
