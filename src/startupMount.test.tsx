// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

const MAIN_SOURCE = readFileSync(resolve(import.meta.dirname, "main.tsx"), "utf8");

let container: HTMLElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

function containerWithSkeleton(): HTMLElement {
  const host = document.createElement("div");
  host.id = "root";
  const skeleton = document.createElement("div");
  skeleton.setAttribute("data-startup-skeleton", "");
  host.append(skeleton);
  document.body.append(host);
  container = host;
  return host;
}

describe("handing the startup skeleton to React", () => {
  it("lets React replace the skeleton inside its own commit", () => {
    const host = containerWithSkeleton();
    const root = createRoot(host);

    expect(host.querySelector("[data-startup-skeleton]")).not.toBeNull();

    act(() => {
      root.render(createElement("main", { className: "app-shell" }));
    });

    expect(host.querySelector("[data-startup-skeleton]")).toBeNull();
    expect(host.querySelector("main.app-shell")).not.toBeNull();
    expect(host.childElementCount).toBe(1);

    act(() => {
      root.unmount();
    });
  });

  it("never clears the root before rendering, which would expose an unstyled gap", () => {
    const clearCalls = [...MAIN_SOURCE.matchAll(/appRoot\.replaceChildren\(([^)]*)\)/g)].map(
      (match) => match[1],
    );

    expect(clearCalls).toEqual(["createStartupErrorScreen(error"]);
    expect(MAIN_SOURCE).toContain("ReactDOM.createRoot(appRoot).render(rootTree())");
    expect(MAIN_SOURCE.indexOf("createRoot(appRoot)")).toBeGreaterThan(
      MAIN_SOURCE.indexOf("async function bootstrap"),
    );
  });
});
