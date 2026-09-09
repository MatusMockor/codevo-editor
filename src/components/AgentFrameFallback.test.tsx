// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentFrameFallback } from "./AgentFrameFallback";
import {
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
} from "./cssContractTestSupport";

const FRAME_SHEET = "components/workbenchShellFrame.css";
const frameRules = parseAllStyleSheets().rules.filter((rule) => rule.sheet === FRAME_SHEET);

function declaration(selector: string, property: string): string | undefined {
  return lastOf(
    buildTokenTable(
      frameRules.filter(
        (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector),
      ),
      "",
    ).get(property),
  );
}

let host: HTMLElement | null = null;

afterEach(() => {
  host?.remove();
  host = null;
});

function render(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  host = container;
  const root = createRoot(container);
  act(() => {
    root.render(<AgentFrameFallback label="agent workspace" />);
  });
  return container;
}

describe("AgentFrameFallback", () => {
  it("occupies the agent slot so the frame keeps its placement while the chunk loads", () => {
    const container = render();
    const fallback = container.querySelector('[data-slot="agent"]');

    expect(fallback).not.toBeNull();
    expect(fallback?.className).toBe("agent-frame-fallback");
    expect(
      declaration('.workbench-frame[data-layout="agent"] > [data-slot="agent"]', "grid-column"),
    ).toBe("1 / 3");
  });

  it("keeps the rail track and the side tone, so the rail cannot vanish mid-startup", () => {
    const container = render();

    expect(container.querySelector(".agent-frame-fallback__rail")).not.toBeNull();
    expect(container.querySelector(".agent-frame-fallback__center")).not.toBeNull();

    const columns = declaration(".agent-frame-fallback", "grid-template-columns");
    expect(columns).toContain("--agent-rail-track");
    expect(columns).toContain("minmax(0, 1fr)");
    expect(declaration(".agent-frame-fallback__rail", "background")).toBe("var(--codevo-side)");
    expect(declaration(".agent-frame-fallback", "background")).toBe("var(--codevo-canvas)");
    expect(declaration(".agent-frame-fallback__center", "background")).toBe("var(--codevo-canvas)");
  });

  it("announces the pending surface without showing loading text", () => {
    const container = render();
    const status = container.querySelector('[role="status"]');

    expect(status).not.toBeNull();
    expect(status?.querySelector(".surface-placeholder__label")?.textContent).toBe(
      "Loading agent workspace…",
    );
  });
});
