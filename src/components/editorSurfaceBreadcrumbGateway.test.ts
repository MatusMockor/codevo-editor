import { describe, expect, it, vi } from "vitest";
import { LARGE_SMART_DOCUMENT_LINE_LIMIT } from "../domain/largeDocumentPolicy";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";
import type { EditorDocument } from "../domain/workspace";
import { editorSurfaceBreadcrumbFeaturesGateway } from "./editorSurfaceBreadcrumbGateway";

function documentSymbol(name: string): LanguageServerDocumentSymbol {
  return {
    children: [],
    containerName: null,
    detail: null,
    kind: 12,
    name,
    range: {
      end: { character: 0, line: 1 },
      start: { character: 0, line: 0 },
    },
    selectionRange: {
      end: { character: 1, line: 0 },
      start: { character: 0, line: 0 },
    },
  } as unknown as LanguageServerDocumentSymbol;
}

function editorDocument(overrides: Partial<EditorDocument>): EditorDocument {
  const content = overrides.content ?? "export const user = 1;\n";

  return {
    content,
    language: "typescript",
    name: "user.ts",
    path: "/project/src/user.ts",
    savedContent: content,
    ...overrides,
  };
}

function gateways(
  javaScriptTypeScriptSymbols: LanguageServerDocumentSymbol[],
  phpSymbols: LanguageServerDocumentSymbol[],
) {
  return {
    javaScriptTypeScript: { documentSymbols: vi.fn(async () => javaScriptTypeScriptSymbols) },
    php: { documentSymbols: vi.fn(async () => phpSymbols) },
  };
}

const largeContent = "const value = 1;\n".repeat(LARGE_SMART_DOCUMENT_LINE_LIMIT + 1);

describe("editorSurfaceBreadcrumbFeaturesGateway", () => {
  it("skips the language server for a policy-large TypeScript document and returns an empty trail", async () => {
    const registry = gateways([documentSymbol("processEvent1")], []);
    const gateway = editorSurfaceBreadcrumbFeaturesGateway(
      editorDocument({ content: largeContent }),
      registry,
    );

    expect(gateway).not.toBeNull();
    await expect(gateway?.documentSymbols("/project", "/project/src/user.ts")).resolves.toEqual([]);
    expect(registry.javaScriptTypeScript.documentSymbols).not.toHaveBeenCalled();
    expect(registry.php.documentSymbols).not.toHaveBeenCalled();
  });

  it("forwards an eligible TypeScript document to the JavaScript/TypeScript gateway unchanged", async () => {
    const symbols = [documentSymbol("loadUser")];
    const registry = gateways(symbols, []);
    const gateway = editorSurfaceBreadcrumbFeaturesGateway(editorDocument({}), registry);

    await expect(gateway?.documentSymbols("/project", "/project/src/user.ts")).resolves.toEqual(
      symbols,
    );
    expect(registry.javaScriptTypeScript.documentSymbols).toHaveBeenCalledTimes(1);
    expect(registry.javaScriptTypeScript.documentSymbols).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
    );
  });

  it("re-enables the exact document once it shrinks back inside the policy limits", async () => {
    const symbols = [documentSymbol("loadUser")];
    const registry = gateways(symbols, []);

    const largeGateway = editorSurfaceBreadcrumbFeaturesGateway(
      editorDocument({ content: largeContent }),
      registry,
    );
    await expect(
      largeGateway?.documentSymbols("/project", "/project/src/user.ts"),
    ).resolves.toEqual([]);

    const eligibleGateway = editorSurfaceBreadcrumbFeaturesGateway(editorDocument({}), registry);
    await expect(
      eligibleGateway?.documentSymbols("/project", "/project/src/user.ts"),
    ).resolves.toEqual(symbols);
    expect(registry.javaScriptTypeScript.documentSymbols).toHaveBeenCalledTimes(1);
  });

  it("never lets a policy-large tab disable an eligible tab", async () => {
    const symbols = [documentSymbol("loadUser")];
    const registry = gateways(symbols, []);
    const largeGateway = editorSurfaceBreadcrumbFeaturesGateway(
      editorDocument({
        content: largeContent,
        name: "large-20k.ts",
        path: "/project/src/large-20k.ts",
      }),
      registry,
    );
    const eligibleGateway = editorSurfaceBreadcrumbFeaturesGateway(editorDocument({}), registry);

    await expect(
      largeGateway?.documentSymbols("/project", "/project/src/large-20k.ts"),
    ).resolves.toEqual([]);
    await expect(
      eligibleGateway?.documentSymbols("/project", "/project/src/user.ts"),
    ).resolves.toEqual(symbols);
    await expect(
      largeGateway?.documentSymbols("/project", "/project/src/large-20k.ts"),
    ).resolves.toEqual([]);
    expect(registry.javaScriptTypeScript.documentSymbols).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the requested path is not the gated document", async () => {
    const registry = gateways([documentSymbol("loadUser")], []);
    const gateway = editorSurfaceBreadcrumbFeaturesGateway(editorDocument({}), registry);

    await expect(gateway?.documentSymbols("/project", "/project/src/other.ts")).resolves.toEqual(
      [],
    );
    expect(registry.javaScriptTypeScript.documentSymbols).not.toHaveBeenCalled();
  });

  it("leaves PHP breadcrumbs outside the JavaScript/TypeScript large-document policy", async () => {
    const phpSymbols = [documentSymbol("UserController")];
    const registry = gateways([], phpSymbols);
    const gateway = editorSurfaceBreadcrumbFeaturesGateway(
      editorDocument({
        content: largeContent,
        language: "php",
        name: "User.php",
        path: "/project/src/User.php",
      }),
      registry,
    );

    await expect(gateway?.documentSymbols("/project", "/project/src/User.php")).resolves.toEqual(
      phpSymbols,
    );
    expect(registry.php.documentSymbols).toHaveBeenCalledTimes(1);
  });

  it("returns no gateway for a document without a language server", () => {
    const registry = gateways([], []);

    expect(
      editorSurfaceBreadcrumbFeaturesGateway(
        editorDocument({ language: "plaintext", name: "notes.txt", path: "/project/notes.txt" }),
        registry,
      ),
    ).toBeNull();
  });
});
