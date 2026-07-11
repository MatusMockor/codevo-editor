// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderMarkdownPreview, type MarkdownPreviewTab } from "../domain/markdownPreview";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders sanitized HTML and replaces it when the preview content changes", async () => {
    const first = preview(await renderMarkdownPreview("# First"), "# First");

    await act(async () => {
      root.render(<MarkdownPreview preview={first} />);
    });

    expect(host.querySelector("h1")?.textContent).toBe("First");
    expect(host.querySelector("script")).toBeNull();

    const second = preview(
      await renderMarkdownPreview("## Second\n\n<script>alert(1)</script>"),
      "## Second\n\n<script>alert(1)</script>",
    );

    await act(async () => {
      root.render(<MarkdownPreview preview={second} />);
    });

    expect(host.querySelector("h1")).toBeNull();
    expect(host.querySelector("h2")?.textContent).toBe("Second");
    expect(host.querySelector("script")).toBeNull();
  });

  it("prevents webview navigation and delegates safe links externally", async () => {
    const openExternal = vi.fn(async () => undefined);
    const html = await renderMarkdownPreview("[OpenAI](https://openai.com)");

    await act(async () => {
      root.render(
        <MarkdownPreview openExternal={openExternal} preview={preview(html, "link")} />,
      );
    });

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      host.querySelector("a")?.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledWith("https://openai.com");
  });

  it("prevents middle-click auxclick navigation and delegates it externally", async () => {
    const openExternal = vi.fn(async () => undefined);
    const html = await renderMarkdownPreview("[OpenAI](https://openai.com)");

    await act(async () => {
      root.render(
        <MarkdownPreview openExternal={openExternal} preview={preview(html, "aux")} />,
      );
    });

    const event = new MouseEvent("auxclick", {
      bubbles: true,
      button: 1,
      cancelable: true,
    });
    await act(async () => {
      host.querySelector("a")?.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledWith("https://openai.com");
  });
});

function preview(html: string, content: string): MarkdownPreviewTab {
  return {
    content,
    html,
    name: "README.md Preview",
    path: "mockor-markdown-preview:/workspace/README.md",
    sourcePath: "/workspace/README.md",
  };
}
