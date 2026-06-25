import { describe, expect, it } from "vitest";
import type {
  PhpMethodMember,
  PhpStructuredParameter,
} from "./phpClassStructure";
import {
  generatedPhpDocHasContent,
  renderGeneratedPhpDoc,
} from "./phpDocGen";

function parameter(
  overrides: Partial<PhpStructuredParameter> = {},
): PhpStructuredParameter {
  return {
    defaultValue: null,
    isByRef: false,
    isOptional: false,
    isVariadic: false,
    name: "$value",
    type: "string",
    ...overrides,
  };
}

function method(overrides: Partial<PhpMethodMember> = {}): PhpMethodMember {
  return {
    declarationOffset: 0,
    isAbstract: false,
    isFinal: false,
    isStatic: false,
    memberStartOffset: 0,
    name: "doWork",
    parameters: [],
    phpDoc: null,
    returnType: null,
    visibility: "public",
    ...overrides,
  };
}

describe("renderGeneratedPhpDoc", () => {
  it("renders @param and @return from typed signature", () => {
    const result = renderGeneratedPhpDoc(
      method({
        parameters: [
          parameter({ name: "$name", type: "string" }),
          parameter({ name: "$count", type: "int" }),
        ],
        returnType: "bool",
      }),
    );

    expect(result).toBe(
      [
        "/**",
        " * @param string $name",
        " * @param int $count",
        " * @return bool",
        " */",
      ].join("\n"),
    );
  });

  it("falls back to mixed for an untyped parameter", () => {
    const result = renderGeneratedPhpDoc(
      method({
        parameters: [parameter({ name: "$payload", type: null })],
        returnType: "void",
      }),
    );

    expect(result).toContain(" * @param mixed $payload");
  });

  it("omits @return for a void return type", () => {
    const result = renderGeneratedPhpDoc(
      method({
        parameters: [parameter({ name: "$name", type: "string" })],
        returnType: "void",
      }),
    );

    expect(result).not.toContain("@return");
    expect(result).toBe(
      ["/**", " * @param string $name", " */"].join("\n"),
    );
  });

  it("omits @return for a never return type", () => {
    const result = renderGeneratedPhpDoc(
      method({ returnType: "never" }),
    );

    expect(result).not.toContain("@return");
  });

  it("renders @return mixed when the return type is absent", () => {
    const result = renderGeneratedPhpDoc(
      method({
        parameters: [parameter({ name: "$name", type: "string" })],
        returnType: null,
      }),
    );

    expect(result).toContain(" * @return mixed");
  });

  it("renders a return-only docblock for a no-parameter method", () => {
    const result = renderGeneratedPhpDoc(
      method({ parameters: [], returnType: "string" }),
    );

    expect(result).toBe(["/**", " * @return string", " */"].join("\n"));
  });

  it("preserves nullable and union parameter types verbatim", () => {
    const result = renderGeneratedPhpDoc(
      method({
        parameters: [
          parameter({ name: "$owner", type: "?User" }),
          parameter({ name: "$id", type: "int|string" }),
        ],
        returnType: "?int",
      }),
    );

    expect(result).toContain(" * @param ?User $owner");
    expect(result).toContain(" * @param int|string $id");
    expect(result).toContain(" * @return ?int");
  });

  it("indents every docblock line by the supplied method indent", () => {
    const result = renderGeneratedPhpDoc(
      method({
        parameters: [parameter({ name: "$name", type: "string" })],
        returnType: "bool",
      }),
      "    ",
    );

    expect(result).toBe(
      [
        "    /**",
        "     * @param string $name",
        "     * @return bool",
        "     */",
      ].join("\n"),
    );
  });

  it("renders a return-only mixed docblock for a bare untyped method", () => {
    const result = renderGeneratedPhpDoc(
      method({ parameters: [], returnType: null }),
    );

    expect(result).toBe(["/**", " * @return mixed", " */"].join("\n"));
  });

  it("uses the parameter name verbatim including the leading dollar", () => {
    const result = renderGeneratedPhpDoc(
      method({ parameters: [parameter({ name: "$count", type: "int" })] }),
    );

    expect(result).toContain(" * @param int $count");
  });
});

describe("generatedPhpDocHasContent", () => {
  it("is false for a no-parameter void method (empty docblock)", () => {
    expect(
      generatedPhpDocHasContent(
        method({ parameters: [], returnType: "void" }),
      ),
    ).toBe(false);
  });

  it("is false for a no-parameter never method (empty docblock)", () => {
    expect(
      generatedPhpDocHasContent(
        method({ parameters: [], returnType: "never" }),
      ),
    ).toBe(false);
  });

  it("is true when the method has at least one parameter", () => {
    expect(
      generatedPhpDocHasContent(
        method({
          parameters: [parameter({ name: "$id", type: "int" })],
          returnType: "void",
        }),
      ),
    ).toBe(true);
  });

  it("is true when the method has a documentable return type", () => {
    expect(
      generatedPhpDocHasContent(method({ parameters: [], returnType: "bool" })),
    ).toBe(true);
  });

  it("is true when the return type is absent (renders @return mixed)", () => {
    expect(
      generatedPhpDocHasContent(method({ parameters: [], returnType: null })),
    ).toBe(true);
  });
});
