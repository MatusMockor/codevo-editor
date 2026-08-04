// @vitest-environment jsdom

import { act, memo, startTransition, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultLargeSmartDocumentPolicy,
  type LargeSmartDocumentPolicy,
} from "./domain/largeDocumentPolicy";
import type { EditorDocument } from "./domain/workspace";
import { useAppActiveLargeDocumentPresentation } from "./components/useAppActiveLargeDocumentPresentation";

interface HarnessProps {
  readonly document: EditorDocument | null;
  readonly onChange: (content: string, path?: string, metrics?: Metrics) => void;
  readonly policy?: LargeSmartDocumentPolicy;
  readonly surfaceCount?: number;
  readonly workspaceRoot?: string;
}

interface Metrics {
  readonly lineCount: number;
  readonly utf16Length: number;
}

let latestChange: HarnessProps["onChange"] = () => {};
let memoizedSurfaceRenders = 0;

const MemoizedSurface = memo(function MemoizedSurface({
  onChange: _onChange,
}: {
  readonly onChange: HarnessProps["onChange"];
}) {
  memoizedSurfaceRenders += 1;
  return null;
});

function Harness({
  document,
  onChange,
  policy = defaultLargeSmartDocumentPolicy,
  surfaceCount = 0,
  workspaceRoot = "/workspace",
}: HarnessProps) {
  const presentation = useAppActiveLargeDocumentPresentation({
    activeDocument: document,
    onChange,
    policy,
    workspaceRoot,
  });
  useLayoutEffect(() => {
    latestChange = presentation.onChange;
  }, [presentation.onChange]);
  return (
    <>
      <span>{presentation.status?.title ?? "eligible"}</span>
      {Array.from({ length: surfaceCount }, (_, index) => (
        <MemoizedSurface key={index} onChange={presentation.onChange} />
      ))}
    </>
  );
}

describe("App active large-document presentation", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    memoizedSurfaceRenders = 0;
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("uses exact Monaco metrics without rescanning an ordinary 100K JS edit publication", () => {
    const initial = "x".repeat(100_000);
    const next = `${initial}y`;
    const onChange = vi.fn();
    const charCodeAt = vi.spyOn(String.prototype, "charCodeAt");
    render(documentFor("/workspace/index.ts", initial), onChange);
    charCodeAt.mockClear();

    act(() =>
      latestChange(next, "/workspace/index.ts", { lineCount: 1, utf16Length: next.length }),
    );
    render(documentFor("/workspace/index.ts", next), onChange);

    expect(charCodeAt).not.toHaveBeenCalled();
    expect(host.textContent).toBe("eligible");
  });

  it("keeps line-large status and shrink recovery O(1) on edit publications", () => {
    const initial = "x\n".repeat(5_001);
    const next = `${initial}y`;
    const onChange = vi.fn();
    const charCodeAt = vi.spyOn(String.prototype, "charCodeAt");
    render(documentFor("/workspace/index.ts", initial), onChange);
    expect(host.textContent).toContain("Manual completion");
    charCodeAt.mockClear();

    act(() =>
      latestChange(next, "/workspace/index.ts", { lineCount: 5_002, utf16Length: next.length }),
    );
    render(documentFor("/workspace/index.ts", next), onChange);
    expect(host.textContent).toContain("Manual completion");
    expect(charCodeAt).not.toHaveBeenCalled();

    const small = "const ok = true;";
    act(() =>
      latestChange(small, "/workspace/index.ts", { lineCount: 1, utf16Length: small.length }),
    );
    render(documentFor("/workspace/index.ts", small), onChange);
    expect(host.textContent).toBe("eligible");
    expect(charCodeAt).not.toHaveBeenCalled();
  });

  it("does not let metrics upgrade malformed JS content and recovers after an exact valid repair", () => {
    const malformed = "\ud800";
    const next = `${malformed}x`;
    const onChange = vi.fn();
    render(documentFor("/workspace/index.ts", malformed), onChange);
    expect(host.textContent).toContain("hard synchronization safety limits");

    act(() =>
      latestChange(next, "/workspace/index.ts", { lineCount: 1, utf16Length: next.length }),
    );
    render(documentFor("/workspace/index.ts", next), onChange);

    expect(host.textContent).toContain("hard synchronization safety limits");

    const repaired = "const repaired = true;";
    act(() =>
      latestChange(repaired, "/workspace/index.ts", {
        lineCount: 1,
        utf16Length: repaired.length,
      }),
    );
    render(documentFor("/workspace/index.ts", repaired), onChange);
    expect(host.textContent).toBe("eligible");
  });

  it("keeps malformed character-large content in editing-only instead of policy degradation", () => {
    const malformedCharacterLarge = `${"x".repeat(17_000)}\ud800`;
    const onChange = vi.fn();
    render(documentFor("/workspace/index.ts", malformedCharacterLarge), onChange, "/workspace", {
      characterLimit: 16 * 1_024,
      lineLimit: 5_000,
    });

    expect(host.textContent).toContain("hard synchronization safety limits");
    expect(host.textContent).not.toContain("Manual completion");
  });

  it("fails closed when published metrics do not belong to the exact content", () => {
    const onChange = vi.fn();
    render(documentFor("/workspace/index.ts", "const before = true;"), onChange);
    const next = "const after = true;";

    act(() =>
      latestChange(next, "/workspace/index.ts", { lineCount: 1, utf16Length: next.length - 1 }),
    );
    render(documentFor("/workspace/index.ts", next), onChange);

    expect(host.textContent).toContain("hard synchronization safety limits");
  });

  it("keeps the active-change wrapper stable so four inactive panes do not rerender", () => {
    const initial = "const before = true;";
    const next = "const after = true;";
    const firstDelegate = vi.fn();
    const latestDelegate = vi.fn();
    render(documentFor("/workspace/index.ts", initial), firstDelegate, "/workspace", undefined, 4);
    expect(memoizedSurfaceRenders).toBe(4);

    act(() =>
      latestChange(next, "/workspace/index.ts", { lineCount: 1, utf16Length: next.length }),
    );
    render(documentFor("/workspace/index.ts", next), latestDelegate, "/workspace", undefined, 4);
    act(() =>
      latestChange(`${next}x`, "/workspace/index.ts", {
        lineCount: 1,
        utf16Length: next.length + 1,
      }),
    );

    expect(memoizedSurfaceRenders).toBe(4);
    expect(firstDelegate).toHaveBeenCalledTimes(1);
    expect(latestDelegate).toHaveBeenCalledTimes(1);
  });

  it("does not publish presentation authority from an abandoned workspace render", () => {
    const malformed = "\ud800";
    render(documentFor("/workspace/index.ts", malformed), vi.fn(), "/workspace-a");

    act(() => {
      startTransition(() =>
        root.render(
          <Harness
            document={documentFor("/workspace/index.ts", "const foreign = true;")}
            onChange={vi.fn()}
            workspaceRoot="/workspace-b"
          />,
        ),
      );
      root.render(
        <Harness
          document={documentFor("/workspace/index.ts", malformed)}
          onChange={vi.fn()}
          workspaceRoot="/workspace-a"
        />,
      );
    });

    const next = `${malformed}x`;
    act(() =>
      latestChange(next, "/workspace/index.ts", { lineCount: 1, utf16Length: next.length }),
    );
    render(documentFor("/workspace/index.ts", next), vi.fn(), "/workspace-a");
    expect(host.textContent).toContain("hard synchronization safety limits");
  });

  it("does not borrow cached metrics across workspace A to B to A replacement", () => {
    const onChange = vi.fn();
    render(documentFor("/workspace/index.ts", "const a = 1;"), onChange, "/workspace-a");
    act(() => latestChange("x", "/workspace/index.ts", { lineCount: 1, utf16Length: 1 }));
    render(documentFor("/workspace/index.ts", "x"), onChange, "/workspace-a");

    render(documentFor("/workspace/index.ts", "\ud800"), onChange, "/workspace-b");
    expect(host.textContent).toContain("hard synchronization safety limits");

    render(documentFor("/workspace/index.ts", "const a = 2;"), onChange, "/workspace-a");
    expect(host.textContent).toBe("eligible");
  });

  function render(
    editorDocument: EditorDocument | null,
    onChange: HarnessProps["onChange"],
    workspaceRoot = "/workspace",
    policy: LargeSmartDocumentPolicy | undefined = defaultLargeSmartDocumentPolicy,
    surfaceCount = 0,
  ) {
    act(() =>
      root.render(
        <Harness
          document={editorDocument}
          onChange={onChange}
          policy={policy}
          surfaceCount={surfaceCount}
          workspaceRoot={workspaceRoot}
        />,
      ),
    );
  }
});

function documentFor(path: string, content: string): EditorDocument {
  return {
    content,
    language: "typescript",
    name: "index.ts",
    path,
    savedContent: content,
  };
}
