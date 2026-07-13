import { describe, expect, it } from "vitest";
import type { MissingThisMember } from "./phpCreateFromUsage";
import {
  buildPhpCreateParentMemberEdit,
  type PhpCreateParentMemberEditRequest,
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

function buildEdit(
  member: MissingThisMember,
  parentSource: string,
  overrides: Partial<PhpCreateParentMemberEditRequest> = {},
) {
  return buildPhpCreateParentMemberEdit({
    member,
    parentClassName: "Base",
    parentFileUri: PARENT_URI,
    parentSource,
    ...overrides,
  });
}

function editText(
  member: MissingThisMember,
  parentSource: string,
  overrides: Partial<PhpCreateParentMemberEditRequest> = {},
): string | undefined {
  return buildEdit(member, parentSource, overrides)?.changes[PARENT_URI]?.[0]
    ?.newText;
}

describe("buildPhpCreateParentMemberEdit — success", () => {
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
        { expectedParentNamespace: "App" },
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
        expectedParentNamespace: "App",
      }),
    ).toBe("\n    protected function helper()\n    {\n    }\n");
  });

  it("inserts into a global-namespace parent when expecting the global namespace", () => {
    const source = ["<?php", "", "class Base", "{", "}", ""].join("\n");

    expect(
      editText(parentMethod(), source, { expectedParentNamespace: null }),
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

describe("buildPhpCreateParentMemberEdit — conservative null", () => {
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
        expectedParentNamespace: "Domain",
      }),
    ).toBeNull();
  });

  it("returns null when expecting the global namespace but the parent is namespaced", () => {
    expect(
      buildEdit(parentMethod(), BASE_SOURCE, {
        expectedParentNamespace: null,
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
