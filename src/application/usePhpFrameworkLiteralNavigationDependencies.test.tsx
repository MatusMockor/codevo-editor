// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import type { PhpFrameworkLiteralNavigationDependencies } from "./phpFrameworkLiteralNavigation";
import {
  usePhpFrameworkLiteralNavigationDependencies,
  type PhpFrameworkLiteralNavigationDependencyHookDependencies,
} from "./usePhpFrameworkLiteralNavigationDependencies";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";

function joinWorkspacePath(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot.replace(/\/+$/, "")}/${relativePath}`;
}

function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  const normalizedRoot = workspaceRoot.replace(/\/+$/, "");

  if (path.startsWith(`${normalizedRoot}/`)) {
    return path.slice(normalizedRoot.length + 1);
  }

  return path;
}

function fileEntry(path: string): FileEntry {
  return {
    kind: "file",
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
  };
}

function makeDeps(
  overrides: Partial<PhpFrameworkLiteralNavigationDependencyHookDependencies> = {},
): PhpFrameworkLiteralNavigationDependencyHookDependencies {
  return {
    collectNamedRouteTargets: vi.fn(async () => []),
    currentWorkspaceRootRef: { current: ROOT },
    findConfigTarget: vi.fn(async () => null),
    findEnvTarget: vi.fn(async () => null),
    findTranslationTarget: vi.fn(async () => null),
    findViewTarget: vi.fn(async () => null),
    joinWorkspacePath,
    readNavigationFileContent: vi.fn(async () => ""),
    readWorkspaceDirectory: vi.fn(async () => []),
    relativeWorkspacePath,
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(
  deps: PhpFrameworkLiteralNavigationDependencyHookDependencies,
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpFrameworkLiteralNavigationDependencies | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpFrameworkLiteralNavigationDependencyHookDependencies;
  }) {
    captured.api = usePhpFrameworkLiteralNavigationDependencies(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpFrameworkLiteralNavigationDependencies => {
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

describe("usePhpFrameworkLiteralNavigationDependencies", () => {
  it("wires Laravel literal dependencies and resolves Inertia component files", async () => {
    const componentPath = `${ROOT}/resources/js/Pages/Users/Index.vue`;
    const readWorkspaceDirectory = vi.fn(async (path: string) =>
      path === `${ROOT}/resources/js/Pages/Users` ? [fileEntry(componentPath)] : [],
    );
    const deps = makeDeps({ readWorkspaceDirectory });
    const harness = renderHook(deps);

    expect(harness.api().collectNamedRouteTargets).toBe(
      deps.collectNamedRouteTargets,
    );
    expect(harness.api().findConfigTarget).toBe(deps.findConfigTarget);
    await expect(
      harness.api().findInertiaComponentTarget?.("Users/Index"),
    ).resolves.toEqual({
      name: "Users/Index",
      path: componentPath,
      position: { column: 1, lineNumber: 1 },
    });
    expect(readWorkspaceDirectory).toHaveBeenCalledWith(
      `${ROOT}/resources/js/Pages/Users`,
    );

    harness.unmount();
  });

  it("resolves Nette redrawControl snippet targets from colocated Latte templates", async () => {
    const templatePath = `${ROOT}/app/modules/mailerModule/Components/MailLogs/mail_logs.latte`;
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path !== templatePath) {
        throw new Error(`Unexpected file: ${path}`);
      }

      return "{snippet mailLogslisting}\n{/snippet}";
    });
    const harness = renderHook(
      makeDeps({
        readNavigationFileContent,
      }),
    );

    await expect(
      harness.api().findNetteRedrawControlSnippetTarget?.(
        `${ROOT}/app/modules/mailerModule/Components/MailLogs/MailLogs.php`,
        "mailLogslisting",
      ),
    ).resolves.toEqual({
      name: "mailLogslisting",
      path: templatePath,
      position: { column: 10, lineNumber: 1 },
      relativePath:
        "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
    });

    harness.unmount();
  });

  it("does not read Nette snippets when the requested root is inactive", async () => {
    const readNavigationFileContent = vi.fn(async () => "{snippet listing}");
    const harness = renderHook(
      makeDeps({
        currentWorkspaceRootRef: { current: OTHER_ROOT },
        readNavigationFileContent,
      }),
    );

    await expect(
      harness.api().findNetteRedrawControlSnippetTarget?.(
        `${ROOT}/app/modules/mailerModule/Components/MailLogs/MailLogs.php`,
        "listing",
      ),
    ).resolves.toBeNull();
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });
});
