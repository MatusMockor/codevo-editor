// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LargeSmartDocumentMetrics,
  LargeSmartDocumentPolicy,
} from "../../domain/largeDocumentPolicy";
import {
  largeSmartDocumentPresentationModeFromContent,
  useLargeSmartDocumentMetricsLifecycle,
} from "./useLargeSmartDocumentMetricsLifecycle";

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
  let activeDocumentLanguage = "markdown";
  let presentationMode: string | undefined;
  let publish:
    | ((content: string, path: string | undefined, metrics?: LargeSmartDocumentMetrics) => void)
    | undefined;

  function Harness() {
    const result = useLargeSmartDocumentMetricsLifecycle({
      document: path
        ? {
            content: content ?? "",
            language: activeDocumentLanguage,
            name: "file",
            path,
            savedContent: content ?? "",
          }
        : null,
      onChangeRef,
      policy,
      workspaceRoot,
    });
    publish = result.onModelContentChange;
    presentationMode = result.activeDocumentLargeSmartMode;
    return result.activeDocumentIsLargeSmart ? "large" : "eligible";
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onChange.mockReset();
    policy = POLICY;
    activeDocumentLanguage = "markdown";
    publish = undefined;
    presentationMode = undefined;
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
      expect(presentationMode).toBe("large-non-javascript-typescript");
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
    expect(presentationMode).toBe("large-non-javascript-typescript");

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
      expect(presentationMode).toBe("large-non-javascript-typescript");

      policy = { ...POLICY, lineLimit: 600 };
      await render(contentWith501Lines, "/workspace");
      expect(host.textContent).toBe("eligible");
      expect(charCodeAt).not.toHaveBeenCalled();
    } finally {
      charCodeAt.mockRestore();
    }
  });

  it("truthfully degrades a custom-policy JS/TS document above the hard sync limit", async () => {
    const contentAboveHardSyncLimit = "x".repeat(3 * 1024 * 1024);
    policy = { characterLimit: 10 * 1024 * 1024, lineLimit: 200_000 };
    activeDocumentLanguage = "typescript";
    await render("initial", "/workspace");
    const charCodeAt = vi.spyOn(String.prototype, "charCodeAt");

    try {
      act(() =>
        publish?.(contentAboveHardSyncLimit, "/workspace/src/file.ts", {
          lineCount: 1,
          utf16Length: contentAboveHardSyncLimit.length,
        }),
      );
      await render(contentAboveHardSyncLimit, "/workspace");

      expect(host.textContent).toBe("large");
      expect(presentationMode).toBe("editing-only");
      expect(charCodeAt).not.toHaveBeenCalled();
    } finally {
      charCodeAt.mockRestore();
    }
  });

  it("keeps a 20k-line JS/TS document in degraded UI below the hard sync limit", async () => {
    const contentWith20kLines = "x\n".repeat(19_999);
    policy = { characterLimit: 10 * 1024 * 1024, lineLimit: 5_000 };
    activeDocumentLanguage = "typescript";
    await render("initial", "/workspace");

    act(() =>
      publish?.(contentWith20kLines, "/workspace/src/file.ts", {
        lineCount: 20_000,
        utf16Length: contentWith20kLines.length,
      }),
    );
    await render(contentWith20kLines, "/workspace");

    expect(host.textContent).toBe("large");
    expect(presentationMode).toBe("editing-degraded-interactive-lsp");
  });

  it("clears hard-limit degradation after the exact JS/TS document shrinks", async () => {
    const large = "x".repeat(3 * 1024 * 1024);
    const small = "const value = 1;";
    policy = { characterLimit: 10 * 1024 * 1024, lineLimit: 200_000 };
    activeDocumentLanguage = "typescript";
    await render("initial", "/workspace");

    act(() =>
      publish?.(large, "/workspace/src/file.ts", {
        lineCount: 1,
        utf16Length: large.length,
      }),
    );
    await render(large, "/workspace");
    expect(host.textContent).toBe("large");

    act(() =>
      publish?.(small, "/workspace/src/file.ts", {
        lineCount: 1,
        utf16Length: small.length,
      }),
    );
    await render(small, "/workspace");
    expect(host.textContent).toBe("eligible");
    expect(presentationMode).toBe("eligible");
  });

  it("does not apply the JS/TS hard sync limit to another language", async () => {
    const customEligibleMarkdown = "x".repeat(3 * 1024 * 1024);
    policy = { characterLimit: 10 * 1024 * 1024, lineLimit: 200_000 };
    await render("initial", "/workspace");

    act(() =>
      publish?.(customEligibleMarkdown, "/workspace/notes.md", {
        lineCount: 1,
        utf16Length: customEligibleMarkdown.length,
      }),
    );
    await render(customEligibleMarkdown, "/workspace", "/workspace/notes.md");

    expect(host.textContent).toBe("eligible");
  });

  it("keeps invalid raw JS/TS admission sticky when exact Monaco metrics arrive", async () => {
    const malformed = "\ud800";
    activeDocumentLanguage = "typescript";
    await render(malformed, "/workspace");
    expect(presentationMode).toBe("editing-only");

    act(() =>
      publish?.(malformed, "/workspace/src/file.ts", {
        lineCount: 1,
        utf16Length: malformed.length,
      }),
    );
    await render(malformed, "/workspace");

    expect(host.textContent).toBe("large");
    expect(presentationMode).toBe("editing-only");

    const stillMalformed = "\ud800x";
    act(() =>
      publish?.(stillMalformed, "/workspace/src/file.ts", {
        lineCount: 1,
        utf16Length: stillMalformed.length,
      }),
    );
    await render(stillMalformed, "/workspace");

    expect(host.textContent).toBe("large");
    expect(presentationMode).toBe("editing-only");
    expect(largeSmartDocumentPresentationModeFromContent(stillMalformed, true, policy)).toBe(
      presentationMode,
    );

    const repaired = "const repaired = true;";
    act(() =>
      publish?.(repaired, "/workspace/src/file.ts", {
        lineCount: 1,
        utf16Length: repaired.length,
      }),
    );
    await render(repaired, "/workspace");

    expect(host.textContent).toBe("eligible");
    expect(presentationMode).toBe("eligible");
    expect(largeSmartDocumentPresentationModeFromContent(repaired, true, policy)).toBe(
      presentationMode,
    );
  });

  it("does not let a smart character threshold or metrics hide malformed raw JS/TS content", async () => {
    const malformedLargeContent = `${"x".repeat(POLICY.characterLimit)}\ud800`;
    activeDocumentLanguage = "typescript";

    await render(malformedLargeContent, "/workspace");
    expect(presentationMode).toBe("editing-only");

    act(() =>
      publish?.(malformedLargeContent, "/workspace/src/file.ts", {
        lineCount: 1,
        utf16Length: malformedLargeContent.length,
      }),
    );
    await render(malformedLargeContent, "/workspace");

    expect(presentationMode).toBe("editing-only");
  });

  it("does not leak invalid raw admission through a workspace A to B to A replacement", async () => {
    activeDocumentLanguage = "typescript";
    await render("\ud800", "/workspace-a");
    expect(presentationMode).toBe("editing-only");

    await render("const valid = true;", "/workspace-b");
    expect(presentationMode).toBe("eligible");

    await render("const validAgain = true;", "/workspace-a");
    expect(presentationMode).toBe("eligible");
  });

  it("classifies a valid character-large raw presentation update", () => {
    const content = "x".repeat(20_000);

    expect(
      largeSmartDocumentPresentationModeFromContent(content, true, {
        characterLimit: 16 * 1024,
        lineLimit: 200_000,
      }),
    ).toBe("editing-degraded-interactive-lsp");
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
