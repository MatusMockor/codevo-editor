import { describe, expect, it } from "vitest";
import type { PhpMethodCompletion } from "./phpMethodCompletions";
import {
  phpNamedArgumentCompletionContextAt,
  phpNamedArgumentCompletions,
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

  it("returns null for plain function calls", () => {
    const source = "<?php\nfoo($a, ";
    expect(
      phpNamedArgumentCompletionContextAt(source, positionAfter(source, "$a, ")),
    ).toBeNull();
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

  it("returns null when the current argument is not a bare identifier", () => {
    const source = "<?php\n$this->send($use";
    expect(
      phpNamedArgumentCompletionContextAt(source, positionAfter(source, "$use")),
    ).toBeNull();
  });

  it("returns null when no call is open at the cursor", () => {
    const source = "<?php\n$this->send($a);\n$x = ";
    expect(
      phpNamedArgumentCompletionContextAt(source, positionAfter(source, "$x = ")),
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

    const completions = phpNamedArgumentCompletions(context, constructorMembers);

    expect(completions.map((completion) => completion.name)).toEqual([
      "name:",
      "age:",
      "email:",
    ]);
    expect(completions[0]).toMatchObject({
      completionBehavior: { insertTextMode: "plain", triggerParameterHints: false },
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

    expect(phpNamedArgumentCompletions(context, constructorMembers)).toEqual([]);
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
