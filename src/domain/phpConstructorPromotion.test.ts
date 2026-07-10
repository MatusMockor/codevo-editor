import { describe, expect, it } from "vitest";
import { parsePhpClassStructure } from "./phpClassStructure";
import {
  planPhpConstructorPromotion,
  type PhpConstructorPromotionEdit,
} from "./phpConstructorPromotion";

function applyEdits(
  source: string,
  edits: readonly PhpConstructorPromotionEdit[],
): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, edit) =>
        `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`,
      source,
    );
}

function promoted(source: string): string | null {
  const plan = planPhpConstructorPromotion(
    source,
    parsePhpClassStructure(source),
  );

  return plan ? applyEdits(source, plan.edits) : null;
}

function promotedNamed(source: string, className: string): string | null {
  const plan = planPhpConstructorPromotion(
    source,
    parsePhpClassStructure(source, className),
  );

  return plan ? applyEdits(source, plan.edits) : null;
}

describe("planPhpConstructorPromotion", () => {
  it("removes declaration groups once, leaves statics, and promotes all members", () => {
    const source = `<?php

class Inventory
{
    protected readonly ?Thing $thing;
    public int $a = 1, $b = make([1, 2], pair(3, 4));
    public static int $count = 0;
}
`;
    const structure = parsePhpClassStructure(source);
    const plan = planPhpConstructorPromotion(source, structure);

    expect(plan?.edits).toHaveLength(3);
    expect(promoted(source)).toBe(`<?php

class Inventory
{
    public static int $count = 0;

    public function __construct(
        protected readonly ?Thing $thing,
        public int $a = 1,
        public int $b = make([1, 2], pair(3, 4)),
    ) {}
}
`);
  });

  it("preserves CRLF and tab member indentation", () => {
    const source = [
      "<?php",
      "class Tabs",
      "{",
      "\tprivate string $name;",
      "}",
      "",
    ].join("\r\n");

    expect(promoted(source)).toBe(
      [
        "<?php",
        "class Tabs",
        "{",
        "",
        "\tpublic function __construct(",
        "\t    private string $name,",
        "\t) {}",
        "}",
        "",
      ].join("\r\n"),
    );
  });

  it("does not plan an existing constructor or static-only properties", () => {
    const existing = `<?php class Existing {
    private string $name;
    public function __construct() {}
}`;
    const staticOnly = `<?php class Registry {
    public static array $items = [];
}`;

    expect(promoted(existing)).toBeNull();
    expect(promoted(staticOnly)).toBeNull();
  });

  it("inserts into the named class body in a multi-class source", () => {
    const source = `<?php
class First
{
    public string $first;
}

class Second
{
    private string $second;
}
`;

    expect(promotedNamed(source, "Second")).toBe(`<?php
class First
{
    public string $first;
}

class Second
{

    public function __construct(
        private string $second,
    ) {}
}
`);
  });

  it.each([
    ["block comments", "private /* keep */ string $value;"],
    ["line comments", "private // keep\n    string $value;"],
    [
      "comma-interstitial comments",
      "private string $first, /* keep */ $second;",
    ],
  ])("suppresses declarations containing %s", (_label, declaration) => {
    const source = `<?php
class Commented
{
    ${declaration}
}
`;

    expect(promoted(source)).toBeNull();
  });

  it("does not mistake comment markers inside strings for comments", () => {
    const source = `<?php
class Quoted
{
    private string $value = "/* not a comment */ // still text";
}
`;

    expect(promoted(source)).toContain(
      'private string $value = "/* not a comment */ // still text",',
    );
  });

  it("suppresses an LF multiline quoted default", () => {
    const source = `<?php
class Multiline
{
    private string $value = "first
second";
}
`;

    expect(promoted(source)).toBeNull();
  });

  it("suppresses a CRLF multiline quoted default", () => {
    const source = [
      "<?php",
      "class Multiline",
      "{",
      '    private string $value = "first',
      'second";',
      "}",
      "",
    ].join("\r\n");

    expect(promoted(source)).toBeNull();
  });

  it("suppresses trailing same-line comments and analyzer directives", () => {
    const source = `<?php
class Directed
{
    private string $value; // @phpstan-ignore property.unused
}
`;

    expect(promoted(source)).toBeNull();
  });

  it("suppresses optional-before-required source order", () => {
    const source = `<?php
class Ordered
{
    private ?string $label = null;
    private int $id;
}
`;

    expect(promoted(source)).toBeNull();
  });

  it.each([
    ["PHPDoc", "/** @var string */\n    private string $value;"],
    ["attributes", "#[Sensitive]\n    private string $value;"],
    ["property hooks", "public string $value { get => $this->value; }"],
    ["asymmetric visibility", "public private(set) string $value;"],
    ["var", "var string $value;"],
    ["final", "final public string $value;"],
    ["incomplete declarations", "public string $value = ;"],
  ])("suppresses %s declarations", (_label, declaration) => {
    const source = `<?php
class Unsupported
{
    ${declaration}
}
`;

    expect(promoted(source)).toBeNull();
  });
});
