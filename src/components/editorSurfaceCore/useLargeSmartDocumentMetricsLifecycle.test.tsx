// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LargeSmartDocumentMetrics,
  LargeSmartDocumentPolicy,
} from "../../domain/largeDocumentPolicy";
import { useLargeSmartDocumentMetricsLifecycle } from "./useLargeSmartDocumentMetricsLifecycle";

const POLICY = { characterLimit: 30_000, lineLimit: 500 } as const;

describe("useLargeSmartDocumentMetricsLifecycle", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onChange = vi.fn();
  const onChangeRef = { current: onChange };
  let content: string | undefined;
  let path: string | undefined;
  let policy: LargeSmartDocumentPolicy = POLICY;
  let workspaceRoot: string | null;
  let publish:
    | ((content: string, path: string | undefined, metrics?: LargeSmartDocumentMetrics) => void)
    | undefined;

  function Harness() {
    const result = useLargeSmartDocumentMetricsLifecycle({
      content,
      onChangeRef,
      path,
      policy,
      workspaceRoot,
    });
    publish = result.onModelContentChange;
    return result.activeDocumentIsLargeSmart ? "large" : "eligible";
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onChange.mockReset();
    policy = POLICY;
    publish = undefined;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("uses exact Monaco metrics without rescanning the published content", async () => {
    const nextContent = "x".repeat(20_000);
    await render("initial", "/workspace");
    const charCodeAt = vi.spyOn(String.prototype, "charCodeAt");

    try {
      act(() =>
        publish?.(nextContent, "/workspace/src/file.ts", {
          lineCount: 501,
          utf16Length: 20_000,
        }),
      );
      await render(nextContent, "/workspace");

      expect(host.textContent).toBe("large");
      expect(charCodeAt).not.toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledWith(nextContent, "/workspace/src/file.ts", {
        lineCount: 501,
        utf16Length: 20_000,
      });
    } finally {
      charCodeAt.mockRestore();
    }
  });

  it("rejects same-length metrics after an A to B to A content reversal", async () => {
    const eligible = "x".repeat(20_000);
    const large = "\n".repeat(20_000);
    await render(eligible, "/workspace");

    act(() =>
      publish?.(large, "/workspace/src/file.ts", {
        lineCount: 20_001,
        utf16Length: 20_000,
      }),
    );
    await render(large, "/workspace");
    expect(host.textContent).toBe("large");

    await render(eligible, "/workspace");
    expect(host.textContent).toBe("eligible");
  });

  it("retains exact committed metrics across policy changes without rescanning", async () => {
    const contentWith501Lines = `${"x\n".repeat(500)}${"x".repeat(19_000)}`;
    await render("initial", "/workspace");
    const charCodeAt = vi.spyOn(String.prototype, "charCodeAt");

    try {
      act(() =>
        publish?.(contentWith501Lines, "/workspace/src/file.ts", {
          lineCount: 501,
          utf16Length: contentWith501Lines.length,
        }),
      );
      await render(contentWith501Lines, "/workspace");
      expect(host.textContent).toBe("large");

      policy = { ...POLICY, lineLimit: 600 };
      await render(contentWith501Lines, "/workspace");
      expect(host.textContent).toBe("eligible");
      expect(charCodeAt).not.toHaveBeenCalled();
    } finally {
      charCodeAt.mockRestore();
    }
  });

  it("drops unconsumed metrics across close and workspace replacement", async () => {
    const large = "\n".repeat(20_000);
    await render("initial", "/workspace-a");
    act(() =>
      publish?.(large, "/workspace/src/file.ts", {
        lineCount: 1,
        utf16Length: 20_000,
      }),
    );

    await render(undefined, null, undefined);
    await render(large, "/workspace-b");
    expect(host.textContent).toBe("large");
  });

  async function render(
    nextContent: string | undefined,
    nextWorkspaceRoot: string | null,
    nextPath: string | undefined = "/workspace/src/file.ts",
  ): Promise<void> {
    content = nextContent;
    path = nextPath;
    workspaceRoot = nextWorkspaceRoot;
    await act(async () => root.render(<Harness />));
  }
});
