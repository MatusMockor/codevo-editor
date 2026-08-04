// @vitest-environment jsdom

import { act, useCallback, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetKeymapPlatformCacheForTests } from "./domain/keymap";
import { defaultAppSettings } from "./domain/settings";
import type { EditorSessionOwnerKey } from "./domain/editorSessionOwnerKey";
import type { EditorCursorStorePort } from "./application/editorCursorStore";
import { useActiveEditorCursorSnapshot } from "./application/useEditorCursorSnapshot";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  largeFileContent: { current: null as string | null },
  onCursorPositionChange: {
    current: null as ((position: { column: number; lineNumber: number }) => void) | null,
  },
  surfaceRenderCount: { value: 0 },
  updateActiveDocument: {
    current: null as
      | ((
          content: string,
          path?: string,
          metrics?: { lineCount: number; utf16Length: number },
        ) => void)
      | null,
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => false,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));

vi.mock("./infrastructure/shikiHighlighter", () => ({
  createAppHighlighter: vi.fn(async () => ({
    codeToTokens: vi.fn(),
  })),
}));

vi.mock("./components/ScopedEditorSurface", () => ({
  ScopedEditorSurface: ({
    cursorStore,
    onChange,
    onCursorPositionChange,
  }: {
    cursorStore: EditorCursorStorePort;
    onChange(
      content: string,
      path?: string,
      metrics?: { lineCount: number; utf16Length: number },
    ): void;
    onCursorPositionChange(position: { column: number; lineNumber: number }): void;
  }) => {
    const leaseRef = useRef<ReturnType<EditorCursorStorePort["activate"]>>(null);
    useEffect(() => {
      const lease = cursorStore.activate({
        documentPath: "/workspace/mock.ts",
        groupId: "main",
        ownerKey: "/workspace" as EditorSessionOwnerKey,
      });
      leaseRef.current = lease;
      return () => {
        if (lease) cursorStore.deactivate(lease);
        if (leaseRef.current === lease) leaseRef.current = null;
      };
    }, [cursorStore]);
    mocks.onCursorPositionChange.current = useCallback(
      (position: { column: number; lineNumber: number }) => {
        const lease = leaseRef.current;
        if (lease && cursorStore.publish(lease, position)) onCursorPositionChange(position);
      },
      [cursorStore, onCursorPositionChange],
    );
    mocks.updateActiveDocument.current = onChange;
    mocks.surfaceRenderCount.value += 1;
    return <div />;
  },
}));

vi.mock("./components/StatusBar", () => ({
  StatusBar: ({
    cursorStore,
    largeDocumentStatus,
    message,
  }: {
    cursorStore: EditorCursorStorePort;
    largeDocumentStatus: { label: string; title: string } | null;
    message: string | null;
  }) => {
    const snapshot = useActiveEditorCursorSnapshot(cursorStore);
    const position = snapshot.status === "available" ? snapshot.position : null;
    return (
      <>
        <div data-testid="cursor-position">
          {position ? `${position.lineNumber}:${position.column}` : "no-position"}
        </div>
        <div data-testid="status-message">{message}</div>
        <div data-testid="large-document-status" title={largeDocumentStatus?.title}>
          {largeDocumentStatus?.label}
        </div>
      </>
    );
  },
}));

vi.mock("./components/WorkbenchOverlayHosts", () => ({
  WorkbenchOverlayHosts: ({
    workbench,
  }: {
    workbench: {
      workspaceDescriptor: unknown;
      workspaceTrust: unknown;
    };
  }) => (
    <div
      data-testid="workspace-ready"
      data-ready={Boolean(workbench.workspaceDescriptor && workbench.workspaceTrust)}
    />
  ),
}));

describe("App Quick Open integration", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
    __resetKeymapPlatformCacheForTests();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        addEventListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn(),
      })),
    });
    localStorage.clear();
    mocks.onCursorPositionChange.current = null;
    mocks.largeFileContent.current = null;
    mocks.surfaceRenderCount.value = 0;
    mocks.updateActiveDocument.current = null;
    localStorage.setItem(
      "editor.settings.app",
      JSON.stringify({
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      }),
    );
    mocks.invoke.mockImplementation((command, args) => {
      if (command === "register_workspace_path") {
        return Promise.resolve({
          descriptor: {
            canonicalRootPath: "/workspace",
            caseSensitive: true,
            selectedRootPath: "/workspace",
            unicodeNormalizationPolicy: "preserved",
            workspaceId: "workspace-1",
          },
          registration: {
            admissionToken: 1,
            createdIdentity: true,
            workspaceId: "workspace-1",
          },
        });
      }

      if (command === "detect_workspace") {
        return Promise.resolve({
          javaScriptTypeScript: null,
          php: null,
          rootPath: "/workspace",
        });
      }

      if (command === "get_workspace_trust") {
        return Promise.resolve({ rootPath: "/workspace", trusted: true });
      }

      if (command === "workspace_read_directory_bounded") {
        return Promise.resolve({ entries: [], truncated: false });
      }

      if (command === "workspace_search_files") {
        return mocks.largeFileContent.current
          ? Promise.resolve({
              requestGeneration: String(args?.requestGeneration ?? "app-test"),
              results: [{ name: "large.ts", relativePath: "large.ts" }],
              truncated: false,
            })
          : Promise.resolve([]);
      }

      if (command === "workspace_read_text_file" && mocks.largeFileContent.current) {
        return Promise.resolve({ content: mocks.largeFileContent.current, revision: null });
      }

      if (command === "set_smart_mode") {
        return Promise.resolve({ message: "Basic", mode: "basic", status: "off" });
      }

      return Promise.resolve(undefined);
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows the editing-only status for custom-policy 3 MiB TypeScript and clears it after shrink", async () => {
    const largeContent = "x".repeat(3 * 1024 * 1024);
    mocks.largeFileContent.current = largeContent;
    localStorage.setItem(
      "editor.settings.workspace:canonical:workspace-1",
      JSON.stringify({
        largeFileMode: { characterLimit: 10 * 1024 * 1024, lineLimit: 200_000 },
      }),
    );
    const { default: App } = await import("./App");
    await act(async () => root.render(<App />));
    await waitFor(() => {
      expect(
        host.querySelector('[data-testid="workspace-ready"]')?.getAttribute("data-ready"),
      ).toBe("true");
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "p", metaKey: true }),
      );
    });
    const input = await waitForElement<HTMLInputElement>(host, 'input[aria-label="Search files"]');
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "large",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitFor(() => {
      expect(host.querySelector('button[title="/workspace/large.ts"]')).not.toBeNull();
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
    });

    await waitFor(() => {
      const status = host.querySelector('[data-testid="large-document-status"]');
      expect(status?.textContent).toBe("Large file mode");
      expect(status?.getAttribute("title")).toContain("language features are unavailable");
      expect(status?.getAttribute("title")).toContain("hard synchronization safety limits");
      expect(mocks.updateActiveDocument.current).not.toBeNull();
    });

    const smallContent = "const value = 1;";
    act(() => {
      mocks.updateActiveDocument.current?.(smallContent, "/workspace/large.ts", {
        lineCount: 1,
        utf16Length: smallContent.length,
      });
    });
    await waitFor(() => {
      const status = host.querySelector('[data-testid="large-document-status"]');
      expect(status?.textContent).toBe("");
      expect(status?.getAttribute("title")).toBeNull();
    });
  }, 15_000);

  it("routes a command prefix through the real controller into Command Palette", async () => {
    const { default: App } = await import("./App");
    await act(async () => {
      root.render(<App />);
    });
    await waitFor(() => {
      expect(
        host.querySelector('[data-testid="workspace-ready"]')?.getAttribute("data-ready"),
      ).toBe("true");
    });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "p",
          metaKey: true,
        }),
      );
    });

    const input = await waitForElement<HTMLInputElement>(host, 'input[aria-label="Search files"]');
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
        input,
        ">Toggle Terminal",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await waitFor(() => {
      expect(host.querySelector('section[aria-label="Command palette"]')).not.toBeNull();
      expect(host.querySelector('section[aria-label="Quick open"]')).toBeNull();
    });
  }, 10_000);

  it("hands typed workspace-symbol input to the destination picker character by character", async () => {
    const { default: App } = await import("./App");
    await act(async () => {
      root.render(<App />);
    });
    await waitFor(() => {
      expect(
        host.querySelector('[data-testid="workspace-ready"]')?.getAttribute("data-ready"),
      ).toBe("true");
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "p",
          metaKey: true,
        }),
      );
    });

    const quickOpenInput = await waitForElement<HTMLInputElement>(
      host,
      'input[aria-label="Search files"]',
    );
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
        quickOpenInput,
        "#",
      );
      quickOpenInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const symbolInput = await waitForElement<HTMLInputElement>(
      host,
      'input[aria-label="Search workspace symbols"]',
    );
    let symbolQuery = "";
    for (const character of "handler") {
      symbolQuery += character;
      act(() => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
          symbolInput,
          symbolQuery,
        );
        symbolInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    expect(symbolInput.value).toBe("handler");
    expect(host.querySelector('section[aria-label="Quick open"]')).toBeNull();
  }, 10_000);

  it("keeps the mounted editor surface out of twenty Quick Open query commits", async () => {
    const { default: App } = await import("./App");
    await act(async () => {
      root.render(<App />);
    });
    await waitFor(() => {
      expect(
        host.querySelector('[data-testid="workspace-ready"]')?.getAttribute("data-ready"),
      ).toBe("true");
    });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "p",
          metaKey: true,
        }),
      );
    });

    const input = await waitForElement<HTMLInputElement>(host, 'input[aria-label="Search files"]');
    const rendersBeforeTyping = mocks.surfaceRenderCount.value;
    let query = "";
    for (const character of "abcdefghijklmnopqrst") {
      query += character;
      act(() => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
          input,
          query,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    expect(query).toHaveLength(20);
    expect(input.value).toBe(query);
    expect(mocks.surfaceRenderCount.value - rendersBeforeTyping).toBe(0);
  }, 10_000);

  it("keeps one hundred cursor updates out of the mounted editor surface", async () => {
    const { default: App } = await import("./App");
    await act(async () => {
      root.render(<App />);
    });
    await waitFor(() => {
      expect(
        host.querySelector('[data-testid="workspace-ready"]')?.getAttribute("data-ready"),
      ).toBe("true");
      expect(mocks.onCursorPositionChange.current).not.toBeNull();
    });
    const rendersBeforeCursorMoves = mocks.surfaceRenderCount.value;

    for (let lineNumber = 1; lineNumber <= 100; lineNumber += 1) {
      act(() => {
        mocks.onCursorPositionChange.current?.({ column: lineNumber, lineNumber });
      });
    }

    expect(host.querySelector('[data-testid="cursor-position"]')?.textContent).toBe("100:100");
    expect(mocks.surfaceRenderCount.value - rendersBeforeCursorMoves).toBe(0);
  }, 10_000);

  it.each([
    {
      input: ":42",
      message: "Open a file to go to a line.",
      submit: true,
    },
    {
      input: "@",
      message: "Open a PHP, JavaScript, or TypeScript file to show structure.",
      submit: false,
    },
  ])(
    "keeps the no-document message after dispatching $input",
    async ({ input, message, submit }) => {
      const { default: App } = await import("./App");
      await act(async () => {
        root.render(<App />);
      });
      await waitFor(() => {
        expect(
          host.querySelector('[data-testid="workspace-ready"]')?.getAttribute("data-ready"),
        ).toBe("true");
      });
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "p",
            metaKey: true,
          }),
        );
      });

      const inputElement = await waitForElement<HTMLInputElement>(
        host,
        'input[aria-label="Search files"]',
      );
      let typedInput = "";
      for (const character of input) {
        typedInput += character;
        act(() => {
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
            inputElement,
            typedInput,
          );
          inputElement.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }

      if (submit) {
        act(() => {
          inputElement.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "Enter",
            }),
          );
        });
      }

      expect(host.querySelector('[data-testid="status-message"]')?.textContent).toBe(message);
      expect(host.querySelector('section[aria-label="Quick open"]')).toBeNull();
    },
    10_000,
  );
});

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }
  }

  assertion();
}

async function waitForElement<T extends Element>(
  container: ParentNode,
  selector: string,
): Promise<T> {
  let element: T | null = null;
  await waitFor(() => {
    element = container.querySelector<T>(selector);
    expect(element).not.toBeNull();
  });
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
}
