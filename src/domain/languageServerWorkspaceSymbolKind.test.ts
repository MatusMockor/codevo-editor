import { describe, expect, it } from "vitest";
import { projectSymbolKindFromLanguageServerSymbolKind } from "./languageServerWorkspaceSymbolKind";

describe("language server workspace symbol kind", () => {
  it("maps every LSP SymbolKind 1 through 26 without dropping valid symbols", () => {
    expect(
      Array.from({ length: 26 }, (_, index) =>
        projectSymbolKindFromLanguageServerSymbolKind(index + 1),
      ),
    ).toEqual([
      "file",
      "module",
      "namespace",
      "package",
      "class",
      "method",
      "property",
      "field",
      "constructor",
      "enum",
      "interface",
      "function",
      "variable",
      "constant",
      "string",
      "number",
      "boolean",
      "array",
      "object",
      "key",
      "null",
      "enumMember",
      "struct",
      "event",
      "operator",
      "typeParameter",
    ]);
  });

  it("fails closed for unsupported kinds", () => {
    expect(projectSymbolKindFromLanguageServerSymbolKind(0)).toBeNull();
    expect(projectSymbolKindFromLanguageServerSymbolKind(27)).toBeNull();
  });
});
