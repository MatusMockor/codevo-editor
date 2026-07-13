// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { activePhpFrameworkCodeActions } from "./phpFrameworkCodeActionContributionRegistry";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { UsePhpCodeActionsResult } from "./usePhpCodeActions";
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
type HookOptions = Parameters<typeof usePhpCodeActionProvider>[0];

function makeOptions(overrides: Partial<HookOptions> = {}): HookOptions {
  return {
    activeDocumentPath: `${ROOT}/app/Http/Controllers/OrderController.php`,
    currentWorkspaceRootRef: { current: ROOT },
    frameworkCodeActionContributions: [],
    intelligenceMode: "fullSmart",
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
  const captured: { api: UsePhpCodeActionsResult | null } = {
    api: null,
  };

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

describe("usePhpCodeActionProvider", () => {
  it("preserves framework action ordering relative to generic PHP actions", async () => {
    const source = `<?php
class OrderController
{
    private string $order;

    public function show()
    {
        return view('orders.show');
    }
}
`;
    const start = source.indexOf("orders.show");
    const { contributions } = activePhpFrameworkCodeActions({
      collectPhpLaravelViewTargets: vi.fn(async () => [{ name: "dashboard" }]),
      frameworkRuntime: LARAVEL_RUNTIME,
      legacyIsLaravelFrameworkActive: false,
      readTestFileIfExists: vi.fn(async () => null),
      workspaceRoot: ROOT,
    });
    const harness = renderHook(
      makeOptions({ frameworkCodeActionContributions: contributions }),
    );

    try {
      const actions = await harness.api().providePhpCodeActions(source, {
        end: start + "orders.show".length,
        start: start + 1,
      });

      const titles = actions.map((action) => action.title);

      expect(titles).toContain("Create Blade view orders.show");
      expect(titles).toContain("Generate constructor");
      expect(titles.indexOf("Create Blade view orders.show")).toBeLessThan(
        titles.indexOf("Generate constructor"),
      );
    } finally {
      harness.unmount();
    }
  });
});
