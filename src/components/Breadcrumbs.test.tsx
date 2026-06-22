// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";
import { Breadcrumbs } from "./Breadcrumbs";

function symbol(name: string): LanguageServerDocumentSymbol {
  const range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };

  return {
    children: [],
    containerName: null,
    detail: null,
    kind: 12,
    name,
    range,
    selectionRange: range,
  };
}

describe("Breadcrumbs", () => {
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

  it("renders the file name as the first segment followed by the symbol path", () => {
    act(() => {
      root.render(
        <Breadcrumbs
          fileName="App.tsx"
          path={[symbol("MyComponent"), symbol("render")]}
          onNavigate={vi.fn()}
        />,
      );
    });

    const labels = Array.from(
      host.querySelectorAll<HTMLElement>(".breadcrumb-segment"),
    ).map((segment) => segment.textContent);

    expect(labels).toEqual(["App.tsx", "MyComponent", "render"]);
  });

  it("renders just the file name when there is no symbol path", () => {
    act(() => {
      root.render(
        <Breadcrumbs fileName="App.tsx" path={[]} onNavigate={vi.fn()} />,
      );
    });

    const labels = Array.from(
      host.querySelectorAll<HTMLElement>(".breadcrumb-segment"),
    ).map((segment) => segment.textContent);

    expect(labels).toEqual(["App.tsx"]);
  });

  it("invokes onNavigate with the clicked symbol", () => {
    const onNavigate = vi.fn();
    const method = symbol("render");

    act(() => {
      root.render(
        <Breadcrumbs
          fileName="App.tsx"
          path={[symbol("MyComponent"), method]}
          onNavigate={onNavigate}
        />,
      );
    });

    const renderSegment = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".breadcrumb-segment"),
    ).find((segment) => segment.textContent === "render");

    expect(renderSegment).toBeTruthy();

    act(() => {
      renderSegment?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(method);
  });

  it("does not navigate when the file-name segment is clicked", () => {
    const onNavigate = vi.fn();

    act(() => {
      root.render(
        <Breadcrumbs
          fileName="App.tsx"
          path={[symbol("MyComponent")]}
          onNavigate={onNavigate}
        />,
      );
    });

    const fileSegment = Array.from(
      host.querySelectorAll<HTMLElement>(".breadcrumb-segment"),
    ).find((segment) => segment.textContent === "App.tsx");

    act(() => {
      fileSegment?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onNavigate).not.toHaveBeenCalled();
  });
});
