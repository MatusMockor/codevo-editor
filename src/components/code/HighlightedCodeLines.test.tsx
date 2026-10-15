// @vitest-environment jsdom
import { act, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { HighlightedLines } from "../../domain/codeHighlight/highlightedCode";
import { HighlightedCodeLines } from "./HighlightedCodeLines";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(element: JSX.Element): Promise<HTMLDivElement> {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => root?.render(element));
  return container;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

const LINES: HighlightedLines = [
  [
    { text: "const", color: "#569cd6", italic: false, bold: true },
    { text: " x = ", color: null, italic: false, bold: false },
    { text: "1", color: "#b5cea8", italic: true, bold: false },
  ],
  [],
];

describe("HighlightedCodeLines", () => {
  it("renders colored token spans per line", async () => {
    const host = await render(<HighlightedCodeLines lines={LINES} plainText={"const x = 1\n"} />);
    const rows = host.querySelectorAll(".highlighted-code__line");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toBe("const x = 1");
    const keyword = rows[0]?.querySelector("span[style]") as HTMLElement | null;
    expect(keyword?.textContent).toBe("const");
    expect(keyword?.style.color).toBe("rgb(86, 156, 214)");
    expect(keyword?.style.fontWeight).toBe("600");
    const styled = [...(rows[0]?.querySelectorAll<HTMLElement>("span[style]") ?? [])];
    const number = styled[styled.length - 1];
    expect(number?.style.fontStyle).toBe("italic");
    expect(host.querySelector(".highlighted-code__gutter")).toBeNull();
  });

  it("falls back to plain text lines while tokens are not ready", async () => {
    const host = await render(<HighlightedCodeLines lines={null} plainText={"a\r\nb\nc"} />);
    const rows = [...host.querySelectorAll(".highlighted-code__line")].map(
      (row) => row.textContent,
    );
    expect(rows).toEqual(["a", "b", "c"]);
    expect(host.querySelector("span[style]")).toBeNull();
  });

  it("shows a hidden-from-AT gutter numbered from startLineNumber and marks the current line", async () => {
    const host = await render(
      <HighlightedCodeLines
        lines={null}
        plainText={"x\ny\nz"}
        startLineNumber={98}
        showLineNumbers
        highlightedLine={99}
      />,
    );
    const gutters = [...host.querySelectorAll(".highlighted-code__gutter")];
    expect(gutters.map((gutter) => gutter.textContent)).toEqual(["98", "99", "100"]);
    expect(gutters.every((gutter) => gutter.getAttribute("aria-hidden") === "true")).toBe(true);
    const current = host.querySelector(".highlighted-code__line.is-current");
    expect(current?.getAttribute("data-line")).toBe("99");
    expect(current?.getAttribute("aria-current")).toBe("true");
    const root = host.querySelector(".highlighted-code") as HTMLElement;
    expect(root.style.getPropertyValue("--highlighted-code-gutter-chars")).toBe("3");
  });

  it("toggles wrapping and forwards className", async () => {
    const host = await render(
      <HighlightedCodeLines lines={LINES} plainText="" wrap className="viewer-code" />,
    );
    const root = host.querySelector(".highlighted-code");
    expect(root?.classList.contains("highlighted-code--wrap")).toBe(true);
    expect(root?.classList.contains("viewer-code")).toBe(true);
    await render(<HighlightedCodeLines lines={LINES} plainText="" />);
    expect(host.querySelector(".highlighted-code--nowrap")).not.toBeNull();
  });
});
