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
    frameworkCodeActionContributions: [],
    intelligenceMode: "fullSmart",
    isRequestedRootActive: vi.fn(() => true),
    phpCreateClassCodeAction: vi.fn(async () => null),
    phpCreateParentMemberCodeAction: vi.fn(async () => null),
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
  it("collects every action returned by a framework contribution", async () => {
    const options = baseOptions({
      frameworkCodeActionContributions: [
        vi.fn(async () => [
          { edits: [], title: "Create actionShow" },
          { edits: [], title: "Create renderShow" },
        ]),
      ],
    });

    await expect(collectPhpWorkspaceCodeActions(options)).resolves.toEqual([
      expect.objectContaining({ title: "Create actionShow" }),
      expect.objectContaining({ title: "Create renderShow" }),
    ]);
  });

  it("drops multiple framework actions when the root changes after the contribution resolves", async () => {
    let active = true;
    const options = baseOptions({
      frameworkCodeActionContributions: [
        vi.fn(async () => {
          active = false;
          return [
            { edits: [], title: "Create actionShow" },
            { edits: [], title: "Create renderShow" },
          ];
        }),
      ],
      isRequestedRootActive: vi.fn(() => active),
    });

    await expect(collectPhpWorkspaceCodeActions(options)).resolves.toBeNull();
  });

  it("drops the provider response when the root changes after an async action", async () => {
    let active = true;
    const frameworkCodeActionContribution = vi.fn(async () => null);
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
      frameworkCodeActionContributions: [frameworkCodeActionContribution],
    });

    const actions = await collectPhpWorkspaceCodeActions(options);

    expect(actions).toBeNull();
    expect(frameworkCodeActionContribution).not.toHaveBeenCalled();
  });

  it("collects the cross-file create-parent-member action", async () => {
    const options = baseOptions({
      phpCreateParentMemberCodeAction: vi.fn(async () => ({
        edits: [],
        title: "Create method 'helper' in 'Base'",
        workspaceEdit: { changes: {} },
      })),
    });

    const actions = await collectPhpWorkspaceCodeActions(options);

    expect(actions?.map((action) => action.title)).toContain(
      "Create method 'helper' in 'Base'",
    );
  });

  it("drops the provider response when the root changes after the create-parent-member action", async () => {
    let active = true;
    const frameworkCodeActionContribution = vi.fn(async () => null);
    const options = baseOptions({
      frameworkCodeActionContributions: [frameworkCodeActionContribution],
      isRequestedRootActive: vi.fn(() => active),
      phpCreateParentMemberCodeAction: vi.fn(async () => {
        active = false;
        return {
          edits: [],
          title: "Create method 'helper' in 'Base'",
          workspaceEdit: { changes: {} },
        };
      }),
    });

    const actions = await collectPhpWorkspaceCodeActions(options);

    expect(actions).toBeNull();
    expect(frameworkCodeActionContribution).not.toHaveBeenCalled();
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

  it("collects a signature synchronization action for an existing method", async () => {
    const source = `<?php
class Example implements ExampleContract
{
    private function handle(int $value): bool
    {
        return false;
    }
}
`;
    const contractSource = `<?php
interface ExampleContract
{
    public function handle(string $value = ''): void;
}
`;
    const contract = parsePhpClassStructure(
      contractSource,
      "ExampleContract",
    ).methods[0]!;
    const collectPhpAbstractMembersToImplement = vi.fn(async () => ({
      abstractMembers: new Map([
        [
          "handle",
          {
            declaringSource: contractSource,
            declaringTypeName: "ExampleContract",
            member: contract,
          },
        ],
      ]),
      conflictingNames: new Set<string>(),
      satisfiedNames: new Set<string>(),
    }));
    const options = baseOptions({
      collectPhpAbstractMembersToImplement,
      range: {
        end: source.indexOf("function"),
        start: source.indexOf("function"),
      },
      source,
      structure: parsePhpClassStructure(source),
    });

    const actions = await collectPhpWorkspaceCodeActions(options);

    expect(actions?.map((action) => action.title)).toContain(
      "Synchronize signature with ExampleContract::handle",
    );
    expect(actions?.map((action) => action.title)).not.toContain(
      "Implement methods",
    );
  });

  it("drops synchronization results when inherited collection changes roots", async () => {
    const source = `<?php
class Example implements ExampleContract
{
    private function handle(int $value): bool { return false; }
}
`;
    const contractSource = `<?php
interface ExampleContract { public function handle(string $value): void; }
`;
    const contract = parsePhpClassStructure(
      contractSource,
      "ExampleContract",
    ).methods[0]!;
    let active = true;
    const options = baseOptions({
      collectPhpAbstractMembersToImplement: vi.fn(async () => {
        active = false;
        return {
          abstractMembers: new Map([
            [
              "handle",
              {
                declaringSource: contractSource,
                declaringTypeName: "ExampleContract",
                member: contract,
              },
            ],
          ]),
          conflictingNames: new Set<string>(),
          satisfiedNames: new Set<string>(),
        };
      }),
      isRequestedRootActive: vi.fn(() => active),
      source,
      structure: parsePhpClassStructure(source),
    });

    await expect(collectPhpWorkspaceCodeActions(options)).resolves.toBeNull();
  });
});
