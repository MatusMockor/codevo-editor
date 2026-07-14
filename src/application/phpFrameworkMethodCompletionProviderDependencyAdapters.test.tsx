// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  phpFrameworkMethodCompletionProviderDependencyExtrasForRuntime,
  usePhpFrameworkMethodCompletionProviderDependencyAdapterResults,
  type PhpFrameworkMethodCompletionProviderDependencyAdapterResult,
} from "./phpFrameworkMethodCompletionProviderDependencyAdapters";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/ws";
const CURRENT_PHP_PATH =
  "/ws/app/modules/mailerModule/Components/MailLogs/MailLogs.php";
const COLOCATED_TEMPLATE_PATH =
  "/ws/app/modules/mailerModule/Components/MailLogs/mail_logs.latte";

function joinWorkspacePath(root: string, relativePath: string): string {
  return `${root}/${relativePath}`;
}

function relativeWorkspacePath(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function renderAdapterResults({
  currentRoot = ROOT,
  readNavigationFileContent = vi.fn(async () => ""),
  workspaceRoot = ROOT,
}: {
  currentRoot?: string | null;
  readNavigationFileContent?: (path: string) => Promise<string>;
  workspaceRoot?: string | null;
} = {}) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: {
    results: readonly PhpFrameworkMethodCompletionProviderDependencyAdapterResult[];
  } = {
    results: [],
  };

  function Harness() {
    captured.results =
      usePhpFrameworkMethodCompletionProviderDependencyAdapterResults({
        currentWorkspaceRootRef: { current: currentRoot },
        joinWorkspacePath,
        readNavigationFileContent,
        relativeWorkspacePath,
        workspaceRoot,
      });
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    results: captured.results,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("phpFrameworkMethodCompletionProviderDependencyAdapters", () => {
  it("returns Nette collector extras by redraw capability", async () => {
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === COLOCATED_TEMPLATE_PATH) {
        return "{snippet mailLogslisting}";
      }

      throw new Error(`Missing file: ${path}`);
    });
    const harness = renderAdapterResults({ readNavigationFileContent });
    const extras = phpFrameworkMethodCompletionProviderDependencyExtrasForRuntime(
      {
        supports: (capability) =>
          capability === "netteRedrawControlSnippetCompletions",
      },
      harness.results,
    );

    await expect(
      extras.collectNetteRedrawControlSnippetTargets?.(CURRENT_PHP_PATH),
    ).resolves.toEqual([
      {
        name: "mailLogslisting",
        relativePath:
          "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
      },
    ]);
    expect(readNavigationFileContent).toHaveBeenCalledWith(
      COLOCATED_TEMPLATE_PATH,
    );

    harness.unmount();
  });

  it("filters out Nette collector extras without the redraw capability", () => {
    const readNavigationFileContent = vi.fn(async () => "");
    const harness = renderAdapterResults({ readNavigationFileContent });
    const extras = phpFrameworkMethodCompletionProviderDependencyExtrasForRuntime(
      {
        supports: () => false,
      },
      harness.results,
    );

    expect(extras.collectNetteRedrawControlSnippetTargets).toBeUndefined();
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });
});
