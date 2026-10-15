// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TreeEntryIcon } from "./TreeEntryIcon";

describe("TreeEntryIcon", () => {
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

  it("renders the npm glyph for package.json", () => {
    render(<TreeEntryIcon name="package.json" />);

    expect(host.querySelector(".file-glyph--npm")).not.toBeNull();
    expect(host.textContent).toBe("n");
  });

  it("renders the TypeScript glyph for a test module", () => {
    render(<TreeEntryIcon name="a.test.ts" />);

    expect(host.querySelector(".file-glyph--ts")).not.toBeNull();
    expect(host.textContent).toBe("TS");
  });

  it("renders an icon glyph without text for JSON", () => {
    render(<TreeEntryIcon name="tsconfig.json" />);

    expect(host.querySelector(".file-glyph--json svg")).not.toBeNull();
    expect(host.textContent).toBe("");
  });

  it("falls back to the generic glyph for unknown files", () => {
    render(<TreeEntryIcon name="test.rest" />);

    expect(host.querySelector(".file-glyph--file svg")).not.toBeNull();
  });

  it("hides glyphs from assistive technology", () => {
    render(<TreeEntryIcon name="index.ts" />);

    expect(host.querySelector(".file-glyph")?.getAttribute("aria-hidden")).toBe("true");
  });

  function render(node: React.ReactNode) {
    act(() => root.render(node));
  }
});
