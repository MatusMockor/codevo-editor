import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
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
    findAuthGuardTarget: vi.fn(async () => null),
    findBroadcastConnectionTarget: vi.fn(async () => null),
    findCacheStoreTarget: vi.fn(async () => null),
    findConfigTarget: vi.fn(async () => null),
    findDatabaseConnectionTarget: vi.fn(async () => null),
    findEnvTarget: vi.fn(async () => null),
    findLogChannelTarget: vi.fn(async () => null),
    findMailMailerTarget: vi.fn(async () => null),
    findPasswordBrokerTarget: vi.fn(async () => null),
    findQueueConnectionTarget: vi.fn(async () => null),
    findRedisConnectionTarget: vi.fn(async () => null),
    findStorageDiskTarget: vi.fn(async () => null),
    findTranslationTarget: vi.fn(async () => null),
    findViewTarget: vi.fn(async () => null),
    joinWorkspacePath,
    providers: [],
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
  it("forwards common literal dependencies without provider-specific extras", () => {
    const deps = makeDeps();
    const harness = renderHook(deps);

    expect(harness.api().collectNamedRouteTargets).toBe(
      deps.collectNamedRouteTargets,
    );
    expect(harness.api().findConfigTarget).toBe(deps.findConfigTarget);
    expect(harness.api().findEnvTarget).toBe(deps.findEnvTarget);
    expect(harness.api().findTranslationTarget).toBe(
      deps.findTranslationTarget,
    );
    expect(harness.api().findViewTarget).toBe(deps.findViewTarget);
    expect(harness.api().findAuthGuardTarget).toBe(
      deps.findAuthGuardTarget,
    );
    expect(harness.api().findBroadcastConnectionTarget).toBe(
      deps.findBroadcastConnectionTarget,
    );
    expect(harness.api().findCacheStoreTarget).toBe(
      deps.findCacheStoreTarget,
    );
    expect(harness.api().findDatabaseConnectionTarget).toBe(
      deps.findDatabaseConnectionTarget,
    );
    expect(harness.api().findLogChannelTarget).toBe(
      deps.findLogChannelTarget,
    );
    expect(harness.api().findMailMailerTarget).toBe(
      deps.findMailMailerTarget,
    );
    expect(harness.api().findPasswordBrokerTarget).toBe(
      deps.findPasswordBrokerTarget,
    );
    expect(harness.api().findQueueConnectionTarget).toBe(
      deps.findQueueConnectionTarget,
    );
    expect(harness.api().findRedisConnectionTarget).toBe(
      deps.findRedisConnectionTarget,
    );
    expect(harness.api().findStorageDiskTarget).toBe(
      deps.findStorageDiskTarget,
    );
    expect(harness.api().findInertiaComponentTarget).toBeUndefined();
    expect(
      harness.api().findNetteRedrawControlSnippetTarget,
    ).toBeUndefined();

    harness.unmount();
  });

  it("wires Laravel Inertia dependencies without Nette redraw extras", async () => {
    const componentPath = `${ROOT}/resources/js/Pages/Users/Index.vue`;
    const readWorkspaceDirectory = vi.fn(async (path: string) =>
      path === `${ROOT}/resources/js/Pages/Users` ? [fileEntry(componentPath)] : [],
    );
    const deps = makeDeps({
      providers: [phpLaravelFrameworkProvider],
      readWorkspaceDirectory,
    });
    const harness = renderHook(deps);

    expect(
      harness.api().findNetteRedrawControlSnippetTarget,
    ).toBeUndefined();
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
        providers: [phpNetteFrameworkProvider],
        readNavigationFileContent,
      }),
    );

    expect(harness.api().findInertiaComponentTarget).toBeUndefined();
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
        providers: [phpNetteFrameworkProvider],
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
