import { describe, expect, it, vi } from "vitest";
import type { LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import { provideLatteCompletions } from "./latteCompletionProvider";

const ROOT = "/ws";
const EXTENSION_PATH = `${ROOT}/app/Latte/AppLatteExtension.php`;
const EXTENSION_SOURCE = `<?php
final class AppLatteExtension extends Latte\\Extension
{
    public function getFunctions(): array
    {
        return [
            'money' => [$this, 'formatMoney'],
        ];
    }

    public function formatMoney(float $value): string
    {
        return '';
    }
}
`;

function functionWorkspaceOptions(): LatteProviderFlowFactoryOptions {
  const listDirectory = vi.fn(async (path: string) => {
    if (path === `${ROOT}/app`) {
      return [{ kind: "directory" as const, path: `${ROOT}/app/Latte` }];
    }

    if (path === `${ROOT}/app/Latte`) {
      return [{ kind: "file" as const, path: EXTENSION_PATH }];
    }

    throw new Error(`no such directory: ${path}`);
  });
  const readFileContent = vi.fn(async (path: string) => {
    if (path === EXTENSION_PATH) {
      return EXTENSION_SOURCE;
    }

    throw new Error(`no such file: ${path}`);
  });
  const deps = {
    currentWorkspaceRootRef: { current: ROOT },
    frameworkIntelligence: {
      capabilities: {
        supports: (capability: string) =>
          capability === "latteTemplateIntelligence",
      },
      isNette: true,
    },
    getActiveDocument: () => ({
      languageId: "latte",
      path: `${ROOT}/app/UI/Home/default.latte`,
    }),
    isSemanticIntelligenceActive: true,
    joinPath: (rootPath: string, relativePath: string) =>
      `${rootPath}/${relativePath}`,
    listDirectory,
    openPhpMethodTarget: vi.fn(async () => true),
    openPhpPropertyTarget: vi.fn(async () => true),
    openTarget: vi.fn(async () => true),
    readFileContent,
    resolvePhpReceiverCompletions: vi.fn(async () => [
      {
        declaringClassName: "AppLatteExtension",
        name: "formatMoney",
        parameters: "float $value",
        returnType: "string",
      },
    ]),
    synthesizeTypedReceiverSource: vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
      }),
    ),
    toRelativePath: (rootPath: string, path: string) =>
      path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path,
    workspaceRoot: ROOT,
  };

  return {
    caches: {
      componentCache: {},
      filterCache: {},
      factoryTemplateOwnerCache: {},
      factoryTemplateOwnerGeneration: { next: 0, roots: {} },
      includeArgumentCache: {},
      includeArgumentGenerationByRoot: {},
      presenterCache: {},
      presenterMappingCache: {},
      presenterMappingGeneration: { next: 0, roots: {} },
      templateCache: {},
      templateTypeCache: {},
      viewDataCache: {},
    },
    frameworkCapabilities: {} as never,
    getDependencies: () =>
      deps as unknown as ReturnType<
        LatteProviderFlowFactoryOptions["getDependencies"]
      >,
    inFlight: {
      filterInFlight: new Map(),
      factoryTemplateOwnerInFlight: new Map(),
      includeArgumentInFlight: { graphs: new Map(), queries: new Map() },
      presenterInFlight: new Map(),
      presenterMappingInFlight: new Map(),
      templateTypeInFlight: new Map(),
      viewDataInFlight: new Map(),
    },
  };
}

describe("provideLatteCompletions custom Latte functions", () => {
  it("offers discovered project functions with signatures at the tag position", async () => {
    const source = "{mon";

    const completions = await provideLatteCompletions(
      functionWorkspaceOptions(),
      source,
      { column: source.length + 1, lineNumber: 1 },
    );

    expect(completions).toEqual([
      {
        detail: "AppLatteExtension::formatMoney(float $value): string",
        insertText: "money",
        kind: "filter",
        label: "money",
        replaceEnd: source.length,
        replaceStart: 1,
      },
    ]);
  });

  it("offers builtin Latte functions inside a tag expression", async () => {
    const source = "{if divisi}";
    const offset = source.indexOf("divisi") + "divisi".length;

    const completions = await provideLatteCompletions(
      functionWorkspaceOptions(),
      source,
      { column: offset + 1, lineNumber: 1 },
    );

    expect(completions).toEqual([
      {
        detail: "Latte function",
        insertText: "divisibleBy",
        kind: "filter",
        label: "divisibleBy",
        replaceEnd: offset,
        replaceStart: source.indexOf("divisi"),
      },
    ]);
  });

  it("does not offer functions after a filter pipe", async () => {
    const source = "{$total|mon";

    const completions = await provideLatteCompletions(
      functionWorkspaceOptions(),
      source,
      { column: source.length + 1, lineNumber: 1 },
    );

    expect(completions).toEqual([]);
  });

  it("does not offer functions for a closing tag", async () => {
    const source = "{/cl";

    const completions = await provideLatteCompletions(
      functionWorkspaceOptions(),
      source,
      { column: source.length + 1, lineNumber: 1 },
    );

    expect(completions).toEqual([]);
  });
});

describe("provideLatteCompletions same-file blocks", () => {
  it("returns block symbols before the framework request gate", async () => {
    const source = [
      "{block #emptyState}<p />{/block emptyState}",
      "{define tableRow, $row}<tr />{/define tableRow}",
      "{block local helper}<i />{/block helper}",
      "{include block ta",
    ].join("\n");
    const getDependencies = vi.fn(() => {
      throw new Error("framework request should not be created");
    });

    await expect(
      provideLatteCompletions(
        { getDependencies } as unknown as LatteProviderFlowFactoryOptions,
        source,
        { column: "{include block ta".length + 1, lineNumber: 4 },
      ),
    ).resolves.toEqual([
      {
        detail: "Same-file Latte block",
        insertText: "tableRow",
        kind: "block",
        label: "tableRow",
        replaceEnd: source.length,
        replaceStart: source.length - 2,
      },
    ]);
    expect(getDependencies).not.toHaveBeenCalled();
  });

  it("returns an empty local result when the block prefix has no candidate", async () => {
    const source = "{block #emptyState}{/block}\n{include missing";
    const getDependencies = vi.fn(() => {
      throw new Error("framework request should not be created");
    });

    await expect(
      provideLatteCompletions(
        { getDependencies } as unknown as LatteProviderFlowFactoryOptions,
        source,
        { column: "{include missing".length + 1, lineNumber: 2 },
      ),
    ).resolves.toEqual([]);
    expect(getDependencies).not.toHaveBeenCalled();
  });

  it("passes a bare dotted include through to framework template completion", async () => {
    const source = [
      "{block #price.total}{/block price.total}",
      "{include price.to",
    ].join("\n");
    const getDependencies = vi.fn(() => {
      throw new Error("framework request reached");
    });

    await expect(
      provideLatteCompletions(
        { getDependencies } as unknown as LatteProviderFlowFactoryOptions,
        source,
        { column: "{include price.to".length + 1, lineNumber: 2 },
      ),
    ).rejects.toThrow("framework request reached");
    expect(getDependencies).toHaveBeenCalledOnce();
  });
});
