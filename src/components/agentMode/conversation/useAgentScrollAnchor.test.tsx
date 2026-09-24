// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAgentScrollAnchor, type AgentScrollAnchor } from "./useAgentScrollAnchor";

let host: HTMLDivElement;
let root: Root;
let anchor: AgentScrollAnchor | null = null;

function Probe({ revision }: { readonly revision: number }) {
  anchor = useAgentScrollAnchor(revision);
  return null;
}

function rectAt(element: HTMLElement, read: () => number): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: read(),
      bottom: read() + 20,
      left: 0,
      right: 0,
      width: 0,
      height: 20,
      x: 0,
      y: read(),
    }),
  });
}

function scene() {
  const container = document.createElement("div");
  container.className = "agent-session__scroll";
  Object.defineProperty(container, "scrollTop", { configurable: true, writable: true, value: 500 });
  rectAt(container, () => 0);
  const events = document.createElement("div");
  events.className = "agent-turn__events";
  const control = document.createElement("button");
  const row = document.createElement("div");
  row.className = "agent-tool-row";
  events.append(control, row);
  container.append(events);
  document.body.append(container);
  return { container, control, row };
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("useAgentScrollAnchor", () => {
  it("keeps the first visible row at the same offset after earlier rows are prepended", () => {
    const { container, control, row } = scene();
    let rowTop = 40;
    rectAt(control, () => -30);
    rectAt(row, () => rowTop);
    act(() => root.render(<Probe revision={1} />));

    act(() => anchor?.capture(control));
    rowTop = 340;
    act(() => root.render(<Probe revision={2} />));

    expect(container.scrollTop).toBe(800);
  });

  it("falls back to the control when the anchored row was replaced", () => {
    const { container, control, row } = scene();
    let controlTop = 10;
    rectAt(control, () => controlTop);
    rectAt(row, () => 40);
    act(() => root.render(<Probe revision={1} />));

    act(() => anchor?.capture(control));
    row.remove();
    controlTop = 10;
    act(() => root.render(<Probe revision={2} />));

    expect(container.scrollTop).toBe(500);
  });

  it("keeps the surviving block in place when the control and anchored row are removed", () => {
    const { container, control, row } = scene();
    const block = control.parentElement as HTMLElement;
    let blockTop = -200;
    rectAt(control, () => 30);
    rectAt(row, () => 40);
    rectAt(block, () => blockTop);
    act(() => root.render(<Probe revision={1} />));

    act(() => anchor?.capture(control, block));
    control.remove();
    row.remove();
    blockTop = -50;
    act(() => root.render(<Probe revision={2} />));

    expect(container.scrollTop).toBe(650);
  });

  it("forgets a capture that was cancelled", () => {
    const { container, control, row } = scene();
    let rowTop = 40;
    rectAt(control, () => 0);
    rectAt(row, () => rowTop);
    act(() => root.render(<Probe revision={1} />));

    act(() => {
      anchor?.capture(control);
      anchor?.cancel();
    });
    rowTop = 340;
    act(() => root.render(<Probe revision={2} />));

    expect(container.scrollTop).toBe(500);
  });
});
