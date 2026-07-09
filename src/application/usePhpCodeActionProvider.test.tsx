// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  createPhpFrameworkRuntimeContext,
  type PhpFrameworkRuntimeContext,
} from "./phpFrameworkRuntimeContext";
import {
  type PhpCodeActionDescriptor,
  type UsePhpCodeActionsResult,
} from "./usePhpCodeActions";
import { usePhpCodeActionProvider } from "./usePhpCodeActionProvider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);
const VIEW_CAPABLE_NON_LARAVEL_RUNTIME: PhpFrameworkRuntimeContext = {
  ...GENERIC_RUNTIME,
  supports: (capability) => capability === "views",
};
const LARAVEL_RUNTIME_WITHOUT_VIEWS: PhpFrameworkRuntimeContext = {
  ...LARAVEL_RUNTIME,
  supports: (capability) => capability !== "views",
};

type HookOptions = Parameters<typeof usePhpCodeActionProvider>[0];

function makeOptions(overrides: Partial<HookOptions> = {}): HookOptions {
  return {
    activeDocumentPath: `${ROOT}/app/Http/Controllers/OrderController.php`,
    collectPhpLaravelViewTargets: vi.fn(async () => [{ name: "dashboard" }]),
    currentWorkspaceRootRef: { current: ROOT },
    intelligenceMode: "fullSmart",
    isLaravelFrameworkActive: false,
    projectSymbolSearch: {
      searchProjectSymbols: vi.fn(async () => []),
    },
    readNavigationFileContent: vi.fn(async () => ""),
    readTestFileIfExists: vi.fn(async () => null),
    resolvePhpClassSourcePaths: vi.fn(async () => []),
    workspaceDescriptor: null,
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(options: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: UsePhpCodeActionsResult | null } = { api: null };

  function Harness({ dependencies }: { dependencies: HookOptions }) {
    captured.api = usePhpCodeActionProvider(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={options} />);
  });

  const api = (): UsePhpCodeActionsResult => {
    if (!captured.api) {
      throw new Error("hook not mounted");
    }

    return captured.api;
  };

  return {
    api,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function missingBladeViewSource(): {
  range: { end: number; start: number };
  source: string;
} {
  const source = "<?php\nreturn view('orders.show');\n";
  const start = source.indexOf("orders.show");

  if (start < 0) {
    throw new Error("missing test view literal");
  }

  return {
    range: {
      end: start + "orders.show".length,
      start: start + 1,
    },
    source,
  };
}

async function collectTitles(
  options: HookOptions,
): Promise<readonly string[]> {
  const harness = renderHook(options);
  const { range, source } = missingBladeViewSource();

  try {
    const actions = await harness.api().providePhpCodeActions(source, range);

    return actions.map((action: PhpCodeActionDescriptor) => action.title);
  } finally {
    harness.unmount();
  }
}

describe("usePhpCodeActionProvider", () => {
  it("enables missing Blade view actions from Laravel runtime", async () => {
    await expect(
      collectTitles(makeOptions({ frameworkRuntime: LARAVEL_RUNTIME })),
    ).resolves.toContain("Create Blade view orders.show");
  });

  it("lets runtime beat the legacy Laravel boolean for Laravel-only actions", async () => {
    await expect(
      collectTitles(
        makeOptions({
          frameworkRuntime: VIEW_CAPABLE_NON_LARAVEL_RUNTIME,
          isLaravelFrameworkActive: true,
        }),
      ),
    ).resolves.not.toContain("Create Blade view orders.show");
  });

  it("requires the runtime views capability for missing Blade view actions", async () => {
    await expect(
      collectTitles(
        makeOptions({
          frameworkRuntime: LARAVEL_RUNTIME_WITHOUT_VIEWS,
          isLaravelFrameworkActive: true,
        }),
      ),
    ).resolves.not.toContain("Create Blade view orders.show");
  });

  it("keeps the legacy Laravel boolean as a fallback without runtime", async () => {
    await expect(
      collectTitles(makeOptions({ isLaravelFrameworkActive: true })),
    ).resolves.toContain("Create Blade view orders.show");
  });
});
