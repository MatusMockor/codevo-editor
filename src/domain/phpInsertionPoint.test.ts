import { describe, expect, it } from "vitest";
import { renderAccessors } from "./phpAccessorCodeGen";
import type { PhpPropertyMember } from "./phpClassStructure";
import {
  detectClassMemberIndent,
  findClassBodyInsertionOffset,
  findUseImportInsertionOffset,
  indentLines,
  offsetToPosition,
} from "./phpInsertionPoint";

function property(
  overrides: Partial<PhpPropertyMember> = {},
): PhpPropertyMember {
  return {
    defaultValue: null,
    isReadonly: false,
    isStatic: false,
    name: "name",
    phpDoc: null,
    type: "string",
    visibility: "private",
    ...overrides,
  };
}

function charAt(source: string, offset: number): string {
  return source.charAt(offset);
}

describe("findClassBodyInsertionOffset", () => {
  it("returns null when there is no class declaration", () => {
    expect(findClassBodyInsertionOffset("<?php $x = 1;")).toBeNull();
  });

  it("locates the offset just before the closing brace of an empty class", () => {
    const source = "<?php\nclass A {}\n";
    const result = findClassBodyInsertionOffset(source);

    expect(result).not.toBeNull();
    // Offset must point at the closing brace of the body.
    expect(charAt(source, result!.offset)).toBe("}");
    expect(result!.needsLeadingBlankLine).toBe(false);
  });

  it("marks a leading blank line for a non-empty class body", () => {
    const source = [
      "<?php",
      "class A",
      "{",
      "    public function foo(): void",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");
    const result = findClassBodyInsertionOffset(source);

    expect(result).not.toBeNull();
    expect(charAt(source, result!.offset)).toBe("}");
    // Inserting after an existing member should be separated by a blank line.
    expect(result!.needsLeadingBlankLine).toBe(true);
    // The body's closing brace is preceded by a newline already.
    expect(source.slice(0, result!.offset).endsWith("\n")).toBe(true);
  });

  it("picks the outer closing brace even with nested braces in method bodies", () => {
    const source = [
      "<?php",
      "class A",
      "{",
      "    public function foo(): void",
      "    {",
      "        if (true) {",
      "            while (false) {",
      "            }",
      "        }",
      "    }",
      "}",
      "",
    ].join("\n");
    const result = findClassBodyInsertionOffset(source);

    expect(result).not.toBeNull();
    // The matched brace must be the LAST one in the source (class body end),
    // not an inner block brace.
    expect(result!.offset).toBe(source.lastIndexOf("}"));
  });

  it("ignores braces inside strings", () => {
    const source = [
      "<?php",
      "class A",
      "{",
      '    public string $s = "}}}{{{";',
      "}",
      "",
    ].join("\n");
    const result = findClassBodyInsertionOffset(source);

    expect(result).not.toBeNull();
    expect(result!.offset).toBe(source.lastIndexOf("}"));
  });

  it("ignores braces inside comments", () => {
    const source = [
      "<?php",
      "class A",
      "{",
      "    // closing } brace in a line comment",
      "    /* another } block } comment */",
      "    public function foo(): void {}",
      "}",
      "",
    ].join("\n");
    const result = findClassBodyInsertionOffset(source);

    expect(result).not.toBeNull();
    expect(result!.offset).toBe(source.lastIndexOf("}"));
  });

  it("ignores braces inside heredoc bodies", () => {
    const source = [
      "<?php",
      "class A",
      "{",
      "    public function foo(): string",
      "    {",
      "        return <<<SQL",
      "        SELECT } FROM t WHERE x = { }",
      "        SQL;",
      "    }",
      "}",
      "",
    ].join("\n");
    const result = findClassBodyInsertionOffset(source);

    expect(result).not.toBeNull();
    expect(result!.offset).toBe(source.lastIndexOf("}"));
  });

  it("does not confuse a trait `use` inside the class with the body end", () => {
    const source = [
      "<?php",
      "class A",
      "{",
      "    use SomeTrait;",
      "",
      "    public function foo(): void {}",
      "}",
      "",
    ].join("\n");
    const result = findClassBodyInsertionOffset(source);

    expect(result).not.toBeNull();
    expect(result!.offset).toBe(source.lastIndexOf("}"));
    expect(result!.needsLeadingBlankLine).toBe(true);
  });

  it("handles a class preceded by attributes", () => {
    const source = [
      "<?php",
      "#[Attribute]",
      "#[Other(['a' => '}'])]",
      "class A",
      "{",
      "    public function foo(): void {}",
      "}",
      "",
    ].join("\n");
    const result = findClassBodyInsertionOffset(source);

    expect(result).not.toBeNull();
    expect(result!.offset).toBe(source.lastIndexOf("}"));
  });

  it("ignores closing tokens inside comments within closure attributes", () => {
    const source = `<?php
class Outer
{
    public function run(): void
    {
        $callback = #[Marker(/* ] } */ 1)] function (): void {
            $this->missing();
        };
    }
}
`;
    const result = findClassBodyInsertionOffset(source);

    expect(result).not.toBeNull();
    expect(result!.offset).toBe(source.lastIndexOf("}"));
  });

  it("targets a specific class by name when several are present", () => {
    const source = [
      "<?php",
      "class A",
      "{",
      "    public function a(): void {}",
      "}",
      "",
      "class B",
      "{",
      "    public function b(): void {}",
      "}",
      "",
    ].join("\n");
    const result = findClassBodyInsertionOffset(source, "B");

    expect(result).not.toBeNull();
    // Offset is the closing brace of B, which is the last brace in the file.
    expect(result!.offset).toBe(source.lastIndexOf("}"));
  });

  it("returns null when braces are unbalanced (conservative)", () => {
    const source = [
      "<?php",
      "class A",
      "{",
      "    public function foo(): void",
      "    {",
      // missing closing braces on purpose
      "",
    ].join("\n");

    expect(findClassBodyInsertionOffset(source)).toBeNull();
  });

  it("computes a sensible trailing-blank-line flag for an inline body", () => {
    const source = "<?php\nclass A { public function foo(): void {} }\n";
    const result = findClassBodyInsertionOffset(source);

    expect(result).not.toBeNull();
    expect(charAt(source, result!.offset)).toBe("}");
    // The closing brace is on the same line as a member, so a trailing
    // blank line is needed to separate generated code from `}`.
    expect(result!.needsTrailingBlankLine).toBe(true);
  });

  it("does not request a trailing blank line when the brace already sits on its own line", () => {
    const source = [
      "<?php",
      "class A",
      "{",
      "    public function foo(): void {}",
      "}",
      "",
    ].join("\n");
    const result = findClassBodyInsertionOffset(source);

    expect(result).not.toBeNull();
    expect(result!.needsTrailingBlankLine).toBe(false);
  });
});

describe("findUseImportInsertionOffset", () => {
  it("inserts after the namespace line when there is no use statement", () => {
    const source = ["<?php", "", "namespace App\\Models;", "", "class A {}", ""].join(
      "\n",
    );
    const result = findUseImportInsertionOffset(source);

    expect(result).not.toBeNull();
    // Offset must land at the start of a line after the namespace statement.
    const before = source.slice(0, result!.offset);
    expect(before).toContain("namespace App\\Models;");
    expect(before).not.toContain("class A");
  });

  it("inserts after the last top-level use statement", () => {
    const source = [
      "<?php",
      "",
      "namespace App\\Models;",
      "",
      "use App\\Foo;",
      "use App\\Bar;",
      "",
      "class A {}",
      "",
    ].join("\n");
    const result = findUseImportInsertionOffset(source);

    expect(result).not.toBeNull();
    const before = source.slice(0, result!.offset);
    expect(before).toContain("use App\\Bar;");
    expect(before).not.toContain("class A");
    // Should sit immediately after the last use line.
    expect(before.endsWith("use App\\Bar;\n")).toBe(true);
  });

  it("handles grouped use imports", () => {
    const source = [
      "<?php",
      "",
      "namespace App;",
      "",
      "use App\\{First, Second};",
      "use App\\Single;",
      "",
      "class A {}",
      "",
    ].join("\n");
    const result = findUseImportInsertionOffset(source);

    expect(result).not.toBeNull();
    const before = source.slice(0, result!.offset);
    expect(before.endsWith("use App\\Single;\n")).toBe(true);
    expect(before).not.toContain("class A");
  });

  it("inserts after the <?php opener when there is no namespace nor use", () => {
    const source = "<?php\n\nclass A {}\n";
    const result = findUseImportInsertionOffset(source);

    expect(result).not.toBeNull();
    const before = source.slice(0, result!.offset);
    expect(before).toContain("<?php");
    expect(before).not.toContain("class A");
  });

  it("ignores a trait `use` inside a class body when choosing the import slot", () => {
    const source = [
      "<?php",
      "",
      "namespace App\\Models;",
      "",
      "use App\\Foo;",
      "",
      "class A",
      "{",
      "    use SomeTrait;",
      "}",
      "",
    ].join("\n");
    const result = findUseImportInsertionOffset(source);

    expect(result).not.toBeNull();
    const before = source.slice(0, result!.offset);
    // Must anchor on the top-level `use App\Foo;`, never the trait use.
    expect(before.endsWith("use App\\Foo;\n")).toBe(true);
    expect(before).not.toContain("class A");
  });

  it("returns null when the source has no PHP open tag", () => {
    expect(findUseImportInsertionOffset("class A {}")).toBeNull();
  });
});

describe("detectClassMemberIndent", () => {
  it("detects a 4-space member indent from the first class member", () => {
    const source = [
      "<?php",
      "class A",
      "{",
      "    private string $name;",
      "}",
      "",
    ].join("\n");

    expect(detectClassMemberIndent(source)).toBe("    ");
  });

  it("detects a tab member indent", () => {
    const source = ["<?php", "class A", "{", "\tprivate string $name;", "}", ""].join(
      "\n",
    );

    expect(detectClassMemberIndent(source)).toBe("\t");
  });

  it("skips a leading docblock and detects the member's own indent", () => {
    const source = [
      "<?php",
      "class A",
      "{",
      "    /** @var list<string> */",
      "    private array $tags = [];",
      "}",
      "",
    ].join("\n");

    expect(detectClassMemberIndent(source)).toBe("    ");
  });

  it("falls back to four spaces for an empty class body", () => {
    expect(detectClassMemberIndent("<?php\nclass A\n{\n}\n")).toBe("    ");
  });

  it("falls back to four spaces when there is no class at all", () => {
    expect(detectClassMemberIndent("<?php $x = 1;")).toBe("    ");
  });

  it("detects the indent of a specific class by name", () => {
    const source = [
      "<?php",
      "class A",
      "{",
      "  private int $a = 1;",
      "}",
      "",
      "class B",
      "{",
      "        private int $b = 2;",
      "}",
      "",
    ].join("\n");

    expect(detectClassMemberIndent(source, "B")).toBe("        ");
  });
});

describe("indentLines", () => {
  it("prefixes the indent to every non-empty line", () => {
    const block = ["public function getName(): string", "{", "    return $this->name;", "}"].join(
      "\n",
    );

    expect(indentLines(block, "    ")).toBe(
      [
        "    public function getName(): string",
        "    {",
        "        return $this->name;",
        "    }",
      ].join("\n"),
    );
  });

  it("leaves blank separator lines untouched", () => {
    const block = ["public function a(): void", "{", "}", "", "public function b(): void", "{", "}"].join(
      "\n",
    );

    expect(indentLines(block, "    ")).toBe(
      [
        "    public function a(): void",
        "    {",
        "    }",
        "",
        "    public function b(): void",
        "    {",
        "    }",
      ].join("\n"),
    );
  });

  it("returns the block unchanged for an empty indent", () => {
    const block = "public function a(): void\n{\n}";

    expect(indentLines(block, "")).toBe(block);
  });

  it("indents an accessor block to the detected 4-space class member level", () => {
    const source = [
      "<?php",
      "class CodevoQaNight",
      "{",
      "    private string $name;",
      "}",
      "",
    ].join("\n");
    const block = renderAccessors([property({ name: "name", type: "string" })]);

    expect(indentLines(block, detectClassMemberIndent(source))).toBe(
      [
        "    public function getName(): string",
        "    {",
        "        return $this->name;",
        "    }",
        "",
        "    public function setName(string $name): void",
        "    {",
        "        $this->name = $name;",
        "    }",
      ].join("\n"),
    );
  });

  it("indents an accessor block under tab-indented class members", () => {
    const source = ["<?php", "class A", "{", "\tprivate string $name;", "}", ""].join(
      "\n",
    );
    const block = renderAccessors([property({ name: "name", type: "string" })], {
      mode: "get",
    });
    const indented = indentLines(block, detectClassMemberIndent(source));

    for (const line of indented.split("\n")) {
      if (line.length === 0) {
        continue;
      }

      expect(line.startsWith("\t")).toBe(true);
    }
  });
});

describe("offsetToPosition", () => {
  it("returns the 0-based line and column for an offset", () => {
    const source = "abc\ndefg\nhi";

    expect(offsetToPosition(source, 0)).toEqual({ line: 0, column: 0 });
    expect(offsetToPosition(source, 2)).toEqual({ line: 0, column: 2 });
    // First char of the second line.
    expect(offsetToPosition(source, 4)).toEqual({ line: 1, column: 0 });
    // Third line.
    expect(offsetToPosition(source, 9)).toEqual({ line: 2, column: 0 });
  });

  it("clamps offsets beyond the source length", () => {
    const source = "ab\ncd";
    const position = offsetToPosition(source, 999);

    expect(position.line).toBe(1);
    expect(position.column).toBe(2);
  });
});
