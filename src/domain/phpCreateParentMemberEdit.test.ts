import { describe, expect, it } from "vitest";
import type { MissingThisMember } from "./phpCreateFromUsage";
import {
  buildPhpCreateMemberWorkspaceEdit,
  type PhpCreateMemberWorkspaceEditRequest,
} from "./phpCreateParentMemberEdit";

const PARENT_URI = "file:///project/src/Base.php";

const BASE_SOURCE = [
  "<?php",
  "",
  "namespace App;",
  "",
  "class Base",
  "{",
  "    public function existing(): void",
  "    {",
  "    }",
  "}",
  "",
].join("\n");

function parentMethod(
  overrides: Partial<MissingThisMember> = {},
): MissingThisMember {
  return {
    argTypes: [],
    kind: "method",
    name: "helper",
    parentClass: "Base",
    target: "parent",
    ...overrides,
  };
}

function externalMethod(
  overrides: Partial<MissingThisMember> = {},
): MissingThisMember {
  return {
    argTypes: [],
    isStatic: true,
    kind: "method",
    name: "make",
    target: "external",
    targetClass: "Base",
    ...overrides,
  };
}

function buildEdit(
  member: MissingThisMember,
  targetSource: string,
  overrides: Partial<PhpCreateMemberWorkspaceEditRequest> = {},
) {
  return buildPhpCreateMemberWorkspaceEdit({
    member,
    targetClassName: "Base",
    targetFileUri: PARENT_URI,
    targetSource,
    ...overrides,
  });
}

function editText(
  member: MissingThisMember,
  targetSource: string,
  overrides: Partial<PhpCreateMemberWorkspaceEditRequest> = {},
): string | undefined {
  return buildEdit(member, targetSource, overrides)?.changes[PARENT_URI]?.[0]
    ?.newText;
}

describe("buildPhpCreateMemberWorkspaceEdit — parent success", () => {
  it("inserts a protected method stub before the parent class closing brace", () => {
    expect(buildEdit(parentMethod(), BASE_SOURCE)).toEqual({
      changes: {
        [PARENT_URI]: [
          {
            newText: "\n    protected function helper()\n    {\n    }\n",
            range: {
              end: { character: 0, line: 9 },
              start: { character: 0, line: 9 },
            },
          },
        ],
      },
    });
  });

  it("renders a static method with typed and untyped parameters", () => {
    expect(
      editText(
        parentMethod({ argTypes: ["string", null], isStatic: true }),
        BASE_SOURCE,
      ),
    ).toBe(
      "\n    protected static function helper(string $arg0, $arg1)\n    {\n    }\n",
    );
  });

  it("inserts a protected constant stub", () => {
    expect(
      editText(
        {
          kind: "constant",
          name: "RETRIES",
          parentClass: "Base",
          target: "parent",
        },
        BASE_SOURCE,
      ),
    ).toBe("\n    protected const RETRIES = null;\n");
  });

  it("drops a short class type cross-file even when namespaces match, keeping builtins", () => {
    expect(
      editText(
        parentMethod({ argTypes: ["UserRepository", "int"] }),
        BASE_SOURCE,
        { expectedNamespace: "App" },
      ),
    ).toBe("\n    protected function helper($arg0, int $arg1)\n    {\n    }\n");
  });

  it("keeps a fully-qualified class type cross-file", () => {
    expect(
      editText(
        parentMethod({ argTypes: ["\\Vendor\\UserRepository"] }),
        BASE_SOURCE,
      ),
    ).toBe(
      "\n    protected function helper(\\Vendor\\UserRepository $arg0)\n    {\n    }\n",
    );
  });

  it("inserts when the expected parent namespace matches the located class", () => {
    expect(
      editText(parentMethod(), BASE_SOURCE, {
        expectedNamespace: "App",
      }),
    ).toBe("\n    protected function helper()\n    {\n    }\n");
  });

  it("inserts into a global-namespace parent when expecting the global namespace", () => {
    const source = ["<?php", "", "class Base", "{", "}", ""].join("\n");

    expect(
      editText(parentMethod(), source, { expectedNamespace: null }),
    ).toBe("    protected function helper()\n    {\n    }\n");
  });

  it("omits the leading blank line in an empty parent class body", () => {
    const source = ["<?php", "", "class Base", "{", "}", ""].join("\n");

    expect(buildEdit(parentMethod(), source)).toEqual({
      changes: {
        [PARENT_URI]: [
          {
            newText: "    protected function helper()\n    {\n    }\n",
            range: {
              end: { character: 0, line: 4 },
              start: { character: 0, line: 4 },
            },
          },
        ],
      },
    });
  });

  it("adopts the parent class member indentation style", () => {
    const source = [
      "<?php",
      "",
      "class Base",
      "{",
      "  public function existing(): void",
      "  {",
      "  }",
      "}",
      "",
    ].join("\n");

    expect(editText(parentMethod(), source)).toBe(
      "\n  protected function helper()\n  {\n  }\n",
    );
  });

  it("targets the exact class name, not a longer name sharing the prefix", () => {
    const source = [
      "<?php",
      "",
      "class BaseController",
      "{",
      "}",
      "",
      "class Base",
      "{",
      "}",
      "",
    ].join("\n");

    expect(buildEdit(parentMethod(), source)).toEqual({
      changes: {
        [PARENT_URI]: [
          {
            newText: "    protected function helper()\n    {\n    }\n",
            range: {
              end: { character: 0, line: 8 },
              start: { character: 0, line: 8 },
            },
          },
        ],
      },
    });
  });

  it("ignores a class declaration inside a heredoc next to the real class", () => {
    const source = [
      "<?php",
      "",
      "class Base",
      "{",
      "    public function template(): string",
      "    {",
      "        return <<<'PHP'",
      "class Base",
      "{",
      "}",
      "PHP;",
      "    }",
      "}",
      "",
    ].join("\n");
    const edit = buildEdit(parentMethod(), source);

    expect(edit?.changes[PARENT_URI]?.[0]?.range.start.line).toBe(12);
    expect(edit?.changes[PARENT_URI]?.[0]?.newText).toContain(
      "protected function helper()",
    );
  });
});

describe("buildPhpCreateMemberWorkspaceEdit — conservative null", () => {
  it("returns null for a member that does not target the parent class", () => {
    expect(
      buildEdit({ kind: "method", name: "helper" }, BASE_SOURCE),
    ).toBeNull();
  });

  it("returns null for an unsupported member kind", () => {
    expect(
      buildEdit(
        { kind: "property", name: "value", parentClass: "Base", target: "parent" },
        BASE_SOURCE,
      ),
    ).toBeNull();
  });

  it("returns null when no class in the parent source matches the name", () => {
    const source = ["<?php", "", "class BaseController", "{", "}", ""].join(
      "\n",
    );

    expect(buildEdit(parentMethod(), source)).toBeNull();
  });

  it("returns null when the parent source declares the class name twice", () => {
    const source = [
      "<?php",
      "",
      "namespace A {",
      "    class Base",
      "    {",
      "    }",
      "}",
      "",
      "namespace B {",
      "    class Base",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(buildEdit(parentMethod(), source)).toBeNull();
  });

  it("returns null when the matching declaration is a trait", () => {
    const source = ["<?php", "", "trait Base", "{", "}", ""].join("\n");

    expect(buildEdit(parentMethod(), source)).toBeNull();
  });

  it("returns null when the matching declaration is an interface", () => {
    const source = ["<?php", "", "interface Base", "{", "}", ""].join("\n");

    expect(buildEdit(parentMethod(), source)).toBeNull();
  });

  it("returns null for a readonly parent class", () => {
    const source = ["<?php", "", "readonly class Base", "{", "}", ""].join(
      "\n",
    );

    expect(buildEdit(parentMethod(), source)).toBeNull();
  });

  it("returns null when the parent already declares the method", () => {
    const source = [
      "<?php",
      "",
      "class Base",
      "{",
      "    protected function helper(): void",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(buildEdit(parentMethod(), source)).toBeNull();
  });

  it("returns null when the parent already declares the constant", () => {
    const source = [
      "<?php",
      "",
      "class Base",
      "{",
      "    public const RETRIES = 3;",
      "}",
      "",
    ].join("\n");

    expect(
      buildEdit(
        {
          kind: "constant",
          name: "RETRIES",
          parentClass: "Base",
          target: "parent",
        },
        source,
      ),
    ).toBeNull();
  });

  it("returns null when the class name only appears inside a heredoc", () => {
    const source = [
      "<?php",
      "",
      "class Logger",
      "{",
      "    public function template(): string",
      "    {",
      "        return <<<'PHP'",
      "class Base",
      "{",
      "}",
      "PHP;",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(buildEdit(parentMethod(), source)).toBeNull();
  });

  it("returns null when the expected parent namespace does not match", () => {
    expect(
      buildEdit(parentMethod(), BASE_SOURCE, {
        expectedNamespace: "Domain",
      }),
    ).toBeNull();
  });

  it("returns null when expecting the global namespace but the parent is namespaced", () => {
    expect(
      buildEdit(parentMethod(), BASE_SOURCE, {
        expectedNamespace: null,
      }),
    ).toBeNull();
  });

  it("returns null when the parent class body braces are unbalanced", () => {
    const source = [
      "<?php",
      "",
      "class Base",
      "{",
      "    public function existing(): void",
      "    {",
      "",
    ].join("\n");

    expect(buildEdit(parentMethod(), source)).toBeNull();
  });
});

describe("buildPhpCreateMemberWorkspaceEdit — external instance targets", () => {
  it("inserts a public instance method stub when the member is not static", () => {
    const text = editText(
      {
        argTypes: ["string"],
        kind: "method",
        name: "make",
        target: "external",
        targetClass: "Base",
      },
      BASE_SOURCE,
    );

    expect(text).toContain("public function make(string $arg0)");
    expect(text).not.toContain("static");
  });

  it("returns null for an external instance property", () => {
    expect(
      buildEdit(
        {
          kind: "property",
          name: "profile",
          target: "external",
          targetClass: "Base",
        },
        BASE_SOURCE,
      ),
    ).toBeNull();
  });

  it("returns null for an instance method when the external class extends another class", () => {
    const source = BASE_SOURCE.replace(
      "class Base",
      "class Base extends Ancestor",
    );

    expect(
      buildEdit(
        {
          argTypes: [],
          kind: "method",
          name: "make",
          target: "external",
          targetClass: "Base",
        },
        source,
      ),
    ).toBeNull();
  });

  it("returns null for an instance method when the external class declares __call", () => {
    const source = BASE_SOURCE.replace(
      "    public function existing(): void",
      "    public function __call($name, $arguments)\n    {\n    }\n\n    public function existing(): void",
    );

    expect(
      buildEdit(
        {
          argTypes: [],
          kind: "method",
          name: "make",
          target: "external",
          targetClass: "Base",
        },
        source,
      ),
    ).toBeNull();
  });
});

describe("buildPhpCreateMemberWorkspaceEdit — external targets", () => {
  it("inserts a public static method stub into the external class", () => {
    expect(buildEdit(externalMethod(), BASE_SOURCE)).toEqual({
      changes: {
        [PARENT_URI]: [
          {
            newText: "\n    public static function make()\n    {\n    }\n",
            range: {
              end: { character: 0, line: 9 },
              start: { character: 0, line: 9 },
            },
          },
        ],
      },
    });
  });

  it("inserts a public constant stub into the external class", () => {
    expect(
      editText(
        {
          kind: "constant",
          name: "RETRIES",
          target: "external",
          targetClass: "Base",
        },
        BASE_SOURCE,
      ),
    ).toBe("\n    public const RETRIES = null;\n");
  });

  it("drops a short class type for an external target, keeping builtins", () => {
    expect(
      editText(
        externalMethod({ argTypes: ["UserRepository", "int"] }),
        BASE_SOURCE,
        { expectedNamespace: "App" },
      ),
    ).toBe(
      "\n    public static function make($arg0, int $arg1)\n    {\n    }\n",
    );
  });

  it("keeps a fully-qualified class type for an external target", () => {
    expect(
      editText(externalMethod({ argTypes: ["\\Vendor\\UserRepository"] }), BASE_SOURCE),
    ).toBe(
      "\n    public static function make(\\Vendor\\UserRepository $arg0)\n    {\n    }\n",
    );
  });

  it("returns null for an external target on a readonly class", () => {
    const source = ["<?php", "", "readonly class Base", "{", "}", ""].join(
      "\n",
    );

    expect(buildEdit(externalMethod(), source)).toBeNull();
  });

  it("returns null when the external class already declares the method", () => {
    const source = BASE_SOURCE.replace("function existing", "function make");

    expect(buildEdit(externalMethod(), source)).toBeNull();
  });

  it("returns null when the expected namespace does not match the external class", () => {
    expect(
      buildEdit(externalMethod(), BASE_SOURCE, {
        expectedNamespace: "Domain",
      }),
    ).toBeNull();
  });

  it("returns null when the external class extends another class", () => {
    const source = [
      "<?php",
      "",
      "namespace App;",
      "",
      "class Base extends Model",
      "{",
      "}",
      "",
    ].join("\n");

    expect(buildEdit(externalMethod(), source)).toBeNull();
  });

  it("returns null when the external class declares __callStatic", () => {
    const source = [
      "<?php",
      "",
      "namespace App;",
      "",
      "class Base",
      "{",
      "    public static function __callStatic(string $name, array $args): mixed",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(buildEdit(externalMethod(), source)).toBeNull();
  });

  it("returns null when the external class declares __call", () => {
    const source = [
      "<?php",
      "",
      "namespace App;",
      "",
      "class Base",
      "{",
      "    public function __call(string $name, array $args): mixed",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(buildEdit(externalMethod(), source)).toBeNull();
  });

  it("ignores an extends keyword that only appears inside a string literal", () => {
    const source = [
      "<?php",
      "",
      "namespace App;",
      "",
      "class Base",
      "{",
      "    public string $note = 'extends Model';",
      "}",
      "",
    ].join("\n");

    expect(editText(externalMethod(), source)).toBe(
      "\n    public static function make()\n    {\n    }\n",
    );
  });

  it("still inserts into a parent class that itself extends another class", () => {
    const source = [
      "<?php",
      "",
      "namespace App;",
      "",
      "class Base extends Model",
      "{",
      "}",
      "",
    ].join("\n");

    expect(editText(parentMethod(), source)).toBe(
      "    protected function helper()\n    {\n    }\n",
    );
  });
});

describe("buildPhpCreateMemberWorkspaceEdit — member-name casing", () => {
  it("returns null when the target declares the method with different casing", () => {
    const source = [
      "<?php",
      "",
      "class Base",
      "{",
      "    protected function helper(): void",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(buildEdit(parentMethod({ name: "HELPER" }), source)).toBeNull();
  });

  it("returns null when the external target declares __CALL with different casing", () => {
    const source = [
      "<?php",
      "",
      "class Base",
      "{",
      "    public function __CALL($name, $arguments)",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(buildEdit(externalMethod(), source)).toBeNull();
  });

  it("still inserts a constant whose name differs from an existing one only by case", () => {
    const source = [
      "<?php",
      "",
      "class Base",
      "{",
      "    public const RETRIES = 3;",
      "}",
      "",
    ].join("\n");

    expect(
      editText(
        {
          kind: "constant",
          name: "retries",
          parentClass: "Base",
          target: "parent",
        },
        source,
      ),
    ).toBe("\n    protected const retries = null;\n");
  });
});
