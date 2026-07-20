import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpCodeActionProvider,
  type UsePhpCodeActionProviderResult,
} from "./usePhpCodeActionProvider";

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
    collectViewTargets: vi.fn(async () => []),
    currentWorkspaceRootRef: { current: ROOT },
    frameworkRuntime: LARAVEL_RUNTIME,
    getPhpDocumentSyncVersion: vi.fn(() => null),
    intelligenceMode: "fullSmart",
    projectSymbolSearch: {
      searchProjectSymbols: vi.fn(async () => []),
    },
    readNavigationFileContent: vi.fn(async () => ""),
    readOpenDocumentContent: vi.fn(() => null),
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
  const captured: { api: UsePhpCodeActionProviderResult | null } = {
    api: null,
  };

  function Harness({ dependencies }: { dependencies: HookOptions }) {
    captured.api = usePhpCodeActionProvider(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={options} />);
  });

  const api = (): UsePhpCodeActionProviderResult => {
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
  it("offers parent create-method actions from PSR-4 paths before indexing catches up", async () => {
    const childSource = `<?php

namespace App\\Support;

class QaChild extends QaBase
{
    public function run(): void
    {
        parent::formatTotals();
    }
}
`;
    const basePath = `${ROOT}/app/Support/QaBase.php`;
    const readTestFileIfExists = vi.fn(async (path: string) =>
      path === basePath
        ? `<?php

namespace App\\Support;

class QaBase
{
}
`
        : null,
    );
    const resolvePhpClassSourcePaths = vi.fn(async () => []);
    const harness = renderHook(
      makeOptions({
        readTestFileIfExists,
        resolvePhpClassSourcePaths,
        workspaceDescriptor: {
          javaScriptTypeScript: null,
          php: {
            classmapRoots: [],
            hasComposer: true,
            packageName: "app/demo",
            packages: [],
            phpPlatformVersion: null,
            phpVersionConstraint: null,
            psr4Roots: [{ dev: false, namespace: "App\\", paths: ["app/"] }],
          },
          rootPath: ROOT,
        },
      }),
    );

    try {
      const start = childSource.indexOf("parent::formatTotals");
      const actions = await harness.api().providePhpCodeActions(childSource, {
        end: start + "parent::formatTotals".length,
        start,
      });
      const action = actions.find(
        (candidate) =>
          candidate.title === "Create method 'formatTotals' in 'QaBase'",
      );

      expect(action).toBeDefined();
      expect(
        action?.workspaceEdit?.changes[`file://${basePath}`]?.[0]?.newText,
      ).toContain("protected function formatTotals()");
    } finally {
      harness.unmount();
    }
  });

  it("keeps same-file create-method actions available after workspace actions", async () => {
    const source = `<?php

namespace App\\Support;

class QaChild
{
    public function run(): void
    {
        $this->missingLocal();
    }
}
`;
    const harness = renderHook(makeOptions());

    try {
      const start = source.indexOf("missingLocal") + "missingLocal".length;
      const actions = await harness.api().providePhpCodeActions(source, {
        end: start,
        start,
      });

      expect(actions.map((action) => action.title)).toContain(
        "Create method 'missingLocal'",
      );
    } finally {
      harness.unmount();
    }
  });

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
    const harness = renderHook(
      makeOptions({
        collectViewTargets: vi.fn(async () => [{ name: "dashboard" }]),
      }),
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
