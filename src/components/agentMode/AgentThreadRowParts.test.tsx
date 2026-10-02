// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentClockProvider } from "./agentClock";
import {
  AGENT_ROW_STATUS_ICON_SIZE,
  AGENT_ROW_WORKING_ICON_SIZE,
  AgentThreadRowStatusSlot,
} from "./AgentThreadRowParts";
import type { AgentRowStatus } from "./agentThreadRowStatus";

const NOW = 1_700_000_600_000;

describe("AgentThreadRowStatusSlot", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
    });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const render = (status: AgentRowStatus): void => {
    act(() => {
      root.render(
        <AgentClockProvider>
          <AgentThreadRowStatusSlot status={status} updatedAtEpochMs={NOW - 5 * 60_000} />
        </AgentClockProvider>,
      );
    });
  };

  const slot = (): HTMLElement => {
    const element = host.querySelector<HTMLElement>(".cv-card-row__status");
    expect(element).not.toBeNull();
    return element as HTMLElement;
  };

  it("renders the relative time and no status glyph when nothing is worth announcing", () => {
    render({ kind: "none" });

    expect(host.querySelector(".cv-card-row__status")).toBeNull();
    expect(host.querySelector(".cv-card-row__when")?.textContent).toBe("5m");
  });

  it("renders a filled dot before the Done label for a settled unread thread", () => {
    render({ kind: "done" });

    const status = slot();
    expect(status.getAttribute("data-tone")).toBe("ok");
    expect(status.textContent).toBe("Done");
    expect(status.firstElementChild?.className).toBe("cv-card-row__done-dot");
    expect(status.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(status.querySelector("svg")).toBeNull();
    expect(status.querySelector(".cv-card-row__status-label")?.textContent).toBe("Done");
    expect(host.querySelector(".cv-card-row__when")).toBeNull();
  });

  it("keeps the compact glyph size for approval, input, failed and stopped", () => {
    for (const status of [
      { kind: "approval" },
      { kind: "input" },
      { kind: "failed" },
      { kind: "stopped" },
    ] as const) {
      render(status);
      expect(slot().querySelector("svg")?.getAttribute("width"), status.kind).toBe(
        String(AGENT_ROW_STATUS_ICON_SIZE),
      );
    }
  });

  it("renders a glyph, label and tone for failed and stopped threads", () => {
    render({ kind: "failed" });

    expect(slot().querySelector("svg")).not.toBeNull();
    expect(slot().textContent).toBe("Failed");
    expect(slot().getAttribute("data-tone")).toBe("fail");

    render({ kind: "stopped" });

    expect(slot().querySelector("svg")).not.toBeNull();
    expect(slot().textContent).toBe("Stopped");
    expect(slot().getAttribute("data-tone")).toBe("quiet");
  });

  it("names the waiting reason for approval, input and running agents", () => {
    render({ kind: "approval" });
    expect(slot().textContent).toBe("Approval");
    expect(slot().title).toBe("Waiting for your approval");

    render({ kind: "input" });
    expect(slot().textContent).toBe("Input");
    expect(slot().getAttribute("data-tone")).toBe("warn");

    render({ kind: "agents", count: 3, lead: "waiting", startedAtEpochMs: NOW - 25_000 });
    expect(slot().getAttribute("data-tone")).toBe("work");
    expect(slot().title).toBe("Waiting for 3 agents");
  });

  it("shows running agents with the Working glyph and a live elapsed time", () => {
    render({ kind: "working", startedAtEpochMs: NOW - 25_000 });
    const workingGlyph = slot().querySelector("svg")?.getAttribute("class");
    render({ kind: "agents", count: 3, lead: "waiting", startedAtEpochMs: NOW - 25_000 });
    expect(slot().querySelector("svg")?.getAttribute("class")).toBe(workingGlyph);
    expect(slot().querySelector(".cv-card-row__status-label")?.textContent).toBe(
      "3 agents running",
    );
    expect(slot().querySelector("svg")?.getAttribute("width")).toBe(
      String(AGENT_ROW_WORKING_ICON_SIZE),
    );
    expect(slot().querySelector(".cv-card-row__tick")?.textContent).toBe("25s");
    act(() => vi.advanceTimersByTime(5_000));
    expect(slot().querySelector(".cv-card-row__tick")?.textContent).toBe("30s");
    act(() => vi.advanceTimersByTime(30_000));
    expect(slot().querySelector(".cv-card-row__tick")?.textContent).toBe("1m");
    render({ kind: "agents", count: 1, lead: "working", startedAtEpochMs: NOW - 25_000 });
    expect(slot().querySelector(".cv-card-row__status-label")?.textContent).toBe("1 agent running");
    expect(slot().title).toBe("Working with 1 agent");
  });

  it.each([
    ["monitoring", "Monitoring"],
    ["background", "Working in background"],
  ] as const)("retains the live elapsed time and glyph for %s", (activity, label) => {
    render({ kind: "working", activity, startedAtEpochMs: NOW - 90_000 });
    expect(slot().querySelector(".cv-card-row__status-label")?.textContent).toBe(label);
    expect(slot().querySelector("svg")).not.toBeNull();
    expect(slot().querySelector(".cv-card-row__tick")?.textContent).toBe("1m");
  });

  it("shows Working with a 16px dashed glyph and a coarse duration", () => {
    render({ kind: "working", startedAtEpochMs: NOW - 65 * 60_000 });

    const status = slot();
    expect(status.getAttribute("data-tone")).toBe("work");
    expect(status.querySelector("svg")?.getAttribute("width")).toBe(
      String(AGENT_ROW_WORKING_ICON_SIZE),
    );
    expect(status.querySelector("svg")?.getAttribute("class")).toContain("circle-dashed");
    expect(status.querySelector(".cv-card-row__status-label")?.textContent).toBe("Working");
    expect(status.querySelector(".cv-card-row__tick")?.textContent).toBe("1h 5m");
  });
});
