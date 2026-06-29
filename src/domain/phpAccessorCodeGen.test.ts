import { describe, expect, it } from "vitest";
import type { PhpPropertyMember } from "./phpClassStructure";
import {
  renderAccessors,
  renderGetter,
  renderSetter,
} from "./phpAccessorCodeGen";

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

describe("renderGetter", () => {
  it("renders a getter for a typed property", () => {
    const result = renderGetter(property({ name: "name", type: "string" }));

    expect(result).toBe(
      [
        "public function getName(): string",
        "{",
        "    return $this->name;",
        "}",
      ].join("\n"),
    );
  });

  it("preserves a nullable return type verbatim", () => {
    const result = renderGetter(property({ name: "owner", type: "?User" }));

    expect(result).toBe(
      [
        "public function getOwner(): ?User",
        "{",
        "    return $this->owner;",
        "}",
      ].join("\n"),
    );
  });

  it("preserves a union return type verbatim", () => {
    const result = renderGetter(property({ name: "id", type: "int|string" }));

    expect(result).toContain("public function getId(): int|string");
  });

  it("omits the return type hint when the property is untyped", () => {
    const result = renderGetter(property({ name: "data", type: null }));

    expect(result).toBe(
      [
        "public function getData()",
        "{",
        "    return $this->data;",
        "}",
      ].join("\n"),
    );
  });

  it("falls back to a legal native phpDoc @var type when there is no native type", () => {
    const result = renderGetter(
      property({
        name: "owner",
        type: null,
        phpDoc: { raw: "/** @var User */", varType: "User" },
      }),
    );

    expect(result).toContain("public function getOwner(): User");
  });

  it("preserves an array-shape phpDoc @var as @return instead of a native return type", () => {
    const result = renderGetter(
      property({
        name: "tags",
        type: null,
        phpDoc: { raw: "/** @var string[] */", varType: "string[]" },
      }),
    );

    expect(result).toBe(
      [
        "/**",
        " * @return string[]",
        " */",
        "public function getTags()",
        "{",
        "    return $this->tags;",
        "}",
      ].join("\n"),
    );
  });

  it("keeps generic phpDoc precision while using the legal native array return type", () => {
    const result = renderGetter(
      property({
        name: "users",
        type: "array",
        phpDoc: {
          raw: "/** @var array<int, User> */",
          varType: "array<int, User>",
        },
      }),
    );

    expect(result).toBe(
      [
        "/**",
        " * @return array<int, User>",
        " */",
        "public function getUsers(): array",
        "{",
        "    return $this->users;",
        "}",
      ].join("\n"),
    );
  });

  it("does not emit generic class PHPDoc types as native return types", () => {
    const result = renderGetter(
      property({
        name: "users",
        type: null,
        phpDoc: {
          raw: "/** @var Collection<int, User> */",
          varType: "Collection<int, User>",
        },
      }),
    );

    expect(result).toBe(
      [
        "/**",
        " * @return Collection<int, User>",
        " */",
        "public function getUsers()",
        "{",
        "    return $this->users;",
        "}",
      ].join("\n"),
    );
  });

  it("uses the is-prefix for a bool property (PhpStorm convention)", () => {
    const result = renderGetter(property({ name: "active", type: "bool" }));

    expect(result).toBe(
      [
        "public function isActive(): bool",
        "{",
        "    return $this->active;",
        "}",
      ].join("\n"),
    );
  });

  it("uses the is-prefix for a nullable bool property", () => {
    const result = renderGetter(property({ name: "active", type: "?bool" }));

    expect(result).toContain("public function isActive(): ?bool");
  });

  it("uses the is-prefix for a bool|null union property", () => {
    const result = renderGetter(
      property({ name: "active", type: "bool|null" }),
    );

    expect(result).toContain("public function isActive(): bool|null");
  });

  it("uses the get-prefix for a union that merely contains bool", () => {
    const result = renderGetter(
      property({ name: "value", type: "bool|int" }),
    );

    expect(result).toContain("public function getValue(): bool|int");
  });

  it("uses the is-prefix for an untyped property with a phpDoc bool", () => {
    const result = renderGetter(
      property({
        name: "active",
        type: null,
        phpDoc: { raw: "/** @var bool */", varType: "bool" },
      }),
    );

    expect(result).toContain("public function isActive(): bool");
  });

  it("PascalCases a snake_case property name", () => {
    const result = renderGetter(
      property({ name: "first_name", type: "string" }),
    );

    expect(result).toContain("public function getFirstName(): string");
    expect(result).toContain("return $this->first_name;");
  });

  it("PascalCases a camelCase property name", () => {
    const result = renderGetter(
      property({ name: "firstName", type: "string" }),
    );

    expect(result).toContain("public function getFirstName(): string");
  });

  it("honours a custom indent", () => {
    const result = renderGetter(property({ name: "name", type: "string" }), {
      indent: "  ",
    });

    expect(result).toBe(
      [
        "  public function getName(): string",
        "  {",
        "      return $this->name;",
        "  }",
      ].join("\n"),
    );
  });
});

describe("renderSetter", () => {
  it("renders a setter for a typed property", () => {
    const result = renderSetter(property({ name: "name", type: "string" }));

    expect(result).toBe(
      [
        "public function setName(string $name): void",
        "{",
        "    $this->name = $name;",
        "}",
      ].join("\n"),
    );
  });

  it("omits the parameter type hint when the property is untyped", () => {
    const result = renderSetter(property({ name: "data", type: null }));

    expect(result).toBe(
      [
        "public function setData($data): void",
        "{",
        "    $this->data = $data;",
        "}",
      ].join("\n"),
    );
  });

  it("renders a fluent setter returning static", () => {
    const result = renderSetter(property({ name: "name", type: "string" }), {
      fluent: true,
    });

    expect(result).toBe(
      [
        "public function setName(string $name): static",
        "{",
        "    $this->name = $name;",
        "",
        "    return $this;",
        "}",
      ].join("\n"),
    );
  });

  it("adds a phpDoc @param for generic property documentation without emitting it natively", () => {
    const result = renderSetter(
      property({
        name: "users",
        type: "array",
        phpDoc: {
          raw: "/** @var array<int, User> */",
          varType: "array<int, User>",
        },
      }),
    );

    expect(result).toBe(
      [
        "/**",
        " * @param array<int, User> $users",
        " */",
        "public function setUsers(array $users): void",
        "{",
        "    $this->users = $users;",
        "}",
      ].join("\n"),
    );
  });

  it("does not use an illegal native property type in the setter signature", () => {
    const result = renderSetter(
      property({
        name: "users",
        type: "Collection<int, User>",
        phpDoc: {
          raw: "/** @var Collection<int, User> */",
          varType: "Collection<int, User>",
        },
      }),
    );

    expect(result).toBe(
      [
        "/**",
        " * @param Collection<int, User> $users",
        " */",
        "public function setUsers($users): void",
        "{",
        "    $this->users = $users;",
        "}",
      ].join("\n"),
    );
  });

  it("PascalCases the method name but keeps the raw property name in the body", () => {
    const result = renderSetter(
      property({ name: "first_name", type: "string" }),
    );

    expect(result).toContain("public function setFirstName(string $first_name)");
    expect(result).toContain("$this->first_name = $first_name;");
  });

  it("returns null for a readonly property (cannot be mutated)", () => {
    const result = renderSetter(
      property({ name: "owner", type: "User", isReadonly: true }),
    );

    expect(result).toBeNull();
  });

  it("honours a custom indent", () => {
    const result = renderSetter(property({ name: "name", type: "string" }), {
      indent: "  ",
    });

    expect(result).toBe(
      [
        "  public function setName(string $name): void",
        "  {",
        "      $this->name = $name;",
        "  }",
      ].join("\n"),
    );
  });
});

describe("renderAccessors", () => {
  it("renders both getter and setter by default, separated by a blank line", () => {
    const result = renderAccessors([property({ name: "name", type: "string" })]);

    expect(result).toBe(
      [
        "public function getName(): string",
        "{",
        "    return $this->name;",
        "}",
        "",
        "public function setName(string $name): void",
        "{",
        "    $this->name = $name;",
        "}",
      ].join("\n"),
    );
  });

  it("renders only getters in get mode", () => {
    const result = renderAccessors(
      [property({ name: "name", type: "string" })],
      { mode: "get" },
    );

    expect(result).toContain("public function getName(): string");
    expect(result).not.toContain("setName");
  });

  it("renders only setters in set mode", () => {
    const result = renderAccessors(
      [property({ name: "name", type: "string" })],
      { mode: "set" },
    );

    expect(result).toContain("public function setName(string $name): void");
    expect(result).not.toContain("getName");
  });

  it("separates accessors of multiple properties with blank lines", () => {
    const result = renderAccessors(
      [
        property({ name: "name", type: "string" }),
        property({ name: "age", type: "int" }),
      ],
      { mode: "get" },
    );

    expect(result).toBe(
      [
        "public function getName(): string",
        "{",
        "    return $this->name;",
        "}",
        "",
        "public function getAge(): int",
        "{",
        "    return $this->age;",
        "}",
      ].join("\n"),
    );
  });

  it("emits only a getter for a readonly property in both mode", () => {
    const result = renderAccessors(
      [property({ name: "owner", type: "User", isReadonly: true })],
      { mode: "both" },
    );

    expect(result).toContain("public function getOwner(): User");
    expect(result).not.toContain("setOwner");
  });

  it("returns an empty string for an empty property list", () => {
    expect(renderAccessors([])).toBe("");
  });

  it("keeps a single blank line between accessors when a readonly property is mixed in", () => {
    const result = renderAccessors(
      [
        property({ name: "name", type: "string" }),
        property({ name: "owner", type: "User", isReadonly: true }),
      ],
      { mode: "both" },
    );

    expect(result).toBe(
      [
        "public function getName(): string",
        "{",
        "    return $this->name;",
        "}",
        "",
        "public function setName(string $name): void",
        "{",
        "    $this->name = $name;",
        "}",
        "",
        "public function getOwner(): User",
        "{",
        "    return $this->owner;",
        "}",
      ].join("\n"),
    );
  });

  it("emits nothing for a readonly property in set mode", () => {
    const result = renderAccessors(
      [property({ name: "owner", type: "User", isReadonly: true })],
      { mode: "set" },
    );

    expect(result).toBe("");
  });

  it("passes the fluent option through to setters", () => {
    const result = renderAccessors(
      [property({ name: "name", type: "string" })],
      { mode: "set", fluent: true },
    );

    expect(result).toContain("public function setName(string $name): static");
    expect(result).toContain("return $this;");
  });

  it("passes a custom indent through to every accessor", () => {
    const result = renderAccessors(
      [property({ name: "name", type: "string" })],
      { mode: "both", indent: "  " },
    );

    expect(result).toContain("  public function getName(): string");
    expect(result).toContain("  public function setName(string $name): void");
  });
});
