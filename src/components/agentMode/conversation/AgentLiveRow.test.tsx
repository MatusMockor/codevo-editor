// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLiveRow } from "./AgentLiveRow";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("AgentLiveRow", () => {
  it("pulses a thinking row and announces it politely", () => {
    act(() => root.render(<AgentLiveRow label="Thinking" tone="thinking" />));

    const row = host.querySelector<HTMLElement>(".cv-live-row");
    expect(row?.className).toBe("cv-live-row cv-live-row--pulse");
    expect(row?.getAttribute("role")).toBe("status");
    expect(row?.getAttribute("aria-live")).toBe("polite");
    expect(row?.querySelector(".cv-live-row__icon svg")).not.toBeNull();
    expect(row?.querySelector(".cv-live-row__label")?.textContent).toBe("Thinking");
  });

  it("marks an approval wait with the warning tone and no pulse", () => {
    act(() => root.render(<AgentLiveRow label="Waiting for approval" tone="approval" />));

    expect(host.querySelector(".cv-live-row")?.className).toBe("cv-live-row cv-live-row--warn");
  });

  it("opens the agents panel from an agents row", () => {
    const open = vi.fn();
    act(() =>
      root.render(
        <AgentLiveRow
          activateLabel="2 agents working. Open Agents panel"
          label="Waiting for 2 agents"
          onActivate={open}
          tone="agents"
        />,
      ),
    );

    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="2 agents working. Open Agents panel"]',
    );
    act(() => button?.click());
    expect(open).toHaveBeenCalledTimes(1);
  });
});
