import { describe, expect, it, vi } from "vitest";
import { parsePhpClassStructure } from "../domain/phpClassStructure";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import {
  collectPhpWorkspaceCodeActions,
  type PhpWorkspaceCodeActionCollectorOptions,
} from "./phpCodeActionWorkspaceCollector";

const ROOT = "/workspace";

function baseOptions(
  overrides: Partial<PhpWorkspaceCodeActionCollectorOptions> = {},
): PhpWorkspaceCodeActionCollectorOptions {
  return {
    activeDocumentPath: `${ROOT}/src/Example.php`,
    collectPhpAbstractMembersToImplement: vi.fn(async () => null),
    collectPhpOverridableParentMethods: vi.fn(async () => null),
    createMissingBladeViewCodeAction: vi.fn(async () => null),
    intelligenceMode: "fullSmart",
    isRequestedRootActive: vi.fn(() => true),
    phpCreateClassCodeAction: vi.fn(async () => null),
    projectSymbolSearch: {
      searchProjectSymbols: vi.fn(async () => []),
    },
    range: { end: 0, start: 0 },
    readTestFileIfExists: vi.fn(async () => null),
    requestedRoot: ROOT,
    source: "<?php\nclass Example {}\n",
    structure: parsePhpClassStructure("<?php\nclass Example {}\n"),
    ...overrides,
  };
}

function projectSymbol(
  overrides: Partial<ProjectSymbolSearchResult>,
): ProjectSymbolSearchResult {
  return {
    column: 1,
    containerName: null,
    fullyQualifiedName: "App\\Invoice",
    kind: "class",
    lineNumber: 1,
    name: "Invoice",
    path: `${ROOT}/src/Invoice.php`,
    relativePath: "src/Invoice.php",
    ...overrides,
  };
}

describe("phpCodeActionWorkspaceCollector", () => {
  it("drops the provider response when the root changes after an async action", async () => {
    let active = true;
    const createMissingBladeViewCodeAction = vi.fn(async () => null);
    const options = baseOptions({
      isRequestedRootActive: vi.fn(() => active),
      phpCreateClassCodeAction: vi.fn(async () => {
        active = false;
        return {
          edits: [],
          newFile: { content: "<?php\nclass Invoice {}\n", path: "Invoice.php" },
          title: "Create class Invoice",
        };
      }),
      createMissingBladeViewCodeAction,
    });

    const actions = await collectPhpWorkspaceCodeActions(options);

    expect(actions).toBeNull();
    expect(createMissingBladeViewCodeAction).not.toHaveBeenCalled();
  });

  it("collects type-symbol import actions from the per-root index", async () => {
    const source = `<?php

class Example
{
    public function run(): void
    {
        new Invoice();
    }
}
`;
    const options = baseOptions({
      intelligenceMode: "lightSmart",
      range: {
        end: source.indexOf("Invoice") + "Invoice".length,
        start: source.indexOf("Invoice"),
      },
      source,
      structure: parsePhpClassStructure(source),
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(async () => [
          projectSymbol({ fullyQualifiedName: "App\\Models\\Invoice" }),
          projectSymbol({
            fullyQualifiedName: "App\\Support\\invoice",
            kind: "function",
            name: "invoice",
          }),
        ]),
      },
    });

    const actions = await collectPhpWorkspaceCodeActions(options);

    expect(actions?.map((action) => action.title)).toContain(
      "Import App\\Models\\Invoice",
    );
    expect(actions?.map((action) => action.title)).not.toContain(
      "Import App\\Support\\invoice",
    );
  });

  it("does not search imports when workspace indexing is disabled", async () => {
    const source = "<?php\nclass Example { public function run(): void { new Invoice(); } }\n";
    const searchProjectSymbols = vi.fn(async () => []);
    const options = baseOptions({
      activeDocumentPath: null,
      intelligenceMode: "basic",
      range: {
        end: source.indexOf("Invoice") + "Invoice".length,
        start: source.indexOf("Invoice"),
      },
      source,
      structure: parsePhpClassStructure(source),
      projectSymbolSearch: { searchProjectSymbols },
    });

    const actions = await collectPhpWorkspaceCodeActions(options);

    expect(actions).toEqual([]);
    expect(searchProjectSymbols).not.toHaveBeenCalled();
  });
});
