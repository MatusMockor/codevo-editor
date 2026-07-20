import { describe, expect, it, vi } from "vitest";
import type { LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import { provideLatteDefinition } from "./latteDefinitionProvider";

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
const FACTORY_PATH = `${ROOT}/app/Model/TemplateFactory.php`;
const FACTORY_SOURCE = `<?php
$latte->addFunction('shuffled', fn(array $values) => $values);
`;

function makeDeps(files: Record<string, string>) {
  const directoriesByPath: Record<
    string,
    { kind: "directory" | "file"; path: string }[]
  > = {};

  for (const path of Object.keys(files)) {
    const segments = path.slice(ROOT.length + 1).split("/");
    let directory = ROOT;

    for (let index = 0; index < segments.length; index += 1) {
      const childPath = `${directory}/${segments[index]}`;
      const entries = (directoriesByPath[directory] ??= []);

      if (!entries.some((entry) => entry.path === childPath)) {
        entries.push({
          kind: index === segments.length - 1 ? "file" : "directory",
          path: childPath,
        });
      }

      directory = childPath;
    }
  }

  return {
    currentWorkspaceRootRef: { current: ROOT },
    frameworkIntelligence: {
      capabilities: {
        supports: (capability: string) =>
          capability === "latteTemplateIntelligence",
      },
    },
    getActiveDocument: () => ({
      languageId: "latte",
      path: `${ROOT}/app/UI/Home/default.latte`,
    }),
    isSemanticIntelligenceActive: true,
    joinPath: (rootPath: string, relativePath: string) =>
      `${rootPath}/${relativePath}`,
    listDirectory: vi.fn(async (path: string) => {
      const entries = directoriesByPath[path];

      if (!entries) {
        throw new Error(`no such directory: ${path}`);
      }

      return entries;
    }),
    openPhpMethodTarget: vi.fn(async () => true),
    openPhpPropertyTarget: vi.fn(async () => true),
    openTarget: vi.fn(async () => true),
    readFileContent: vi.fn(async (path: string) => {
      const content = files[path];

      if (content === undefined) {
        throw new Error(`no such file: ${path}`);
      }

      return content;
    }),
    resolvePhpReceiverCompletions: vi.fn(async () => []),
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
}

function makeOptions(files: Record<string, string>) {
  const deps = makeDeps(files);
  const options: LatteProviderFlowFactoryOptions = {
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

  return { deps, options };
}

describe("provideLatteDefinition custom Latte functions", () => {
  it("navigates from a bare function tag to the getFunctions method", async () => {
    const { deps, options } = makeOptions({
      [EXTENSION_PATH]: EXTENSION_SOURCE,
    });
    const source = "{money($amount)}";

    await expect(
      provideLatteDefinition(options, source, source.indexOf("money") + 3),
    ).resolves.toBe(true);
    expect(deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "AppLatteExtension",
      "formatMoney",
    );
  });

  it("navigates from an expression function call to an addFunction call site", async () => {
    const { deps, options } = makeOptions({
      [FACTORY_PATH]: FACTORY_SOURCE,
    });
    const source = "{foreach shuffled($items) as $item}{/foreach}";

    await expect(
      provideLatteDefinition(options, source, source.indexOf("shuffled") + 3),
    ).resolves.toBe(true);
    expect(deps.openTarget).toHaveBeenCalledWith(
      FACTORY_PATH,
      {
        column:
          FACTORY_SOURCE.indexOf("shuffled") -
          FACTORY_SOURCE.indexOf("$latte") +
          1,
        lineNumber: 2,
      },
      "shuffled",
    );
  });

  it("returns false for builtin functions without a project registration", async () => {
    const { deps, options } = makeOptions({});
    const source = "{if even($number)}x{/if}";

    await expect(
      provideLatteDefinition(options, source, source.indexOf("even") + 2),
    ).resolves.toBe(false);
    expect(deps.openPhpMethodTarget).not.toHaveBeenCalled();
    expect(deps.openTarget).not.toHaveBeenCalled();
  });
});
