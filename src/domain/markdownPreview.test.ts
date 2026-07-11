// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderMarkdownPreview } from "./markdownPreview";

describe("renderMarkdownPreview", () => {
  it("renders headings, lists, fenced code, tables, links, and remote images", async () => {
    const html = await renderMarkdownPreview(`
# Preview

- first
- second

\`\`\`ts
const answer = 42;
\`\`\`

| Name | Value |
| --- | --- |
| answer | 42 |

[OpenAI](https://openai.com)

![Logo](https://example.com/logo.png)
`);

    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector("h1")?.textContent).toBe("Preview");
    expect([...container.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "first",
      "second",
    ]);
    expect(container.querySelector("pre code")?.textContent).toContain(
      "const answer = 42;",
    );
    expect(container.querySelector("table")?.textContent).toContain("answer");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://openai.com",
    );
    expect(container.querySelector("a")?.getAttribute("rel")).toBe("noopener");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/logo.png",
    );
  });

  it.each([
    ["script tags", "<script>globalThis.pwned = true</script>", "script"],
    ["image event handlers", '<img src="https://example.com/a.png" onerror="alert(1)">', "[onerror]"],
    ["javascript links", "[unsafe](javascript:alert(1))", 'a[href^="javascript:"]'],
    ["iframes", '<iframe src="https://example.com"></iframe>', "iframe"],
    ["objects", '<object data="https://example.com"></object>', "object"],
    ["embeds", '<embed src="https://example.com">', "embed"],
    ["data image URLs", "![unsafe](data:image/png;base64,AAAA)", 'img[src^="data:"]'],
    ["inline SVG", '<svg><script>alert(1)</script><a href="javascript:alert(1)"><circle /></a></svg>', "svg"],
  ])("removes %s", async (_name, markdown, selector) => {
    const html = await renderMarkdownPreview(markdown);
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector(selector)).toBeNull();
  });

  it("does not pass raw HTML blocks through as elements", async () => {
    const html = await renderMarkdownPreview(
      '<section id="raw"><strong>Raw HTML</strong></section>',
    );
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector("#raw")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });

  it.each([
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/png;base64,AAAA",
    "file:///tmp/private.png",
    "asset://localhost/private.png",
    "blob:https://example.com/id",
    "/relative.png",
  ])("strips disallowed image source %s", async (source) => {
    const html = await renderMarkdownPreview(`![unsafe](${source})`);
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector("img")?.hasAttribute("src") ?? false).toBe(false);
  });
});
