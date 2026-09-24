// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentClockProvider } from "./agentClock";
import { AGENT_ROW_STATUS_ICON_SIZE, AgentThreadRowStatusSlot } from "./AgentThreadRowParts";
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

  it("renders a check glyph before the Done label for a settled unread thread", () => {
    render({ kind: "done" });

    const status = slot();
    expect(status.getAttribute("data-tone")).toBe("ok");
    expect(status.textContent).toBe("Done");
    expect(status.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(status.firstElementChild?.getAttribute("width")).toBe(
      String(AGENT_ROW_STATUS_ICON_SIZE),
    );
    expect(status.querySelector(".cv-card-row__status-label")?.textContent).toBe("Done");
    expect(host.querySelector(".cv-card-row__when")).toBeNull();
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

    render({ kind: "agents", count: 3 });
    expect(slot().textContent).toBe("3 agents");
    expect(slot().getAttribute("data-tone")).toBe("work");
    expect(slot().title).toBe("Waiting for 3 agents");
  });

  it.each([
    ["monitoring", "Monitoring"],
    ["background", "Working in background"],
  ] as const)("retains the live elapsed time and glyph for %s", (activity, label) => {
    render({ kind: "working", activity, startedAtEpochMs: NOW - 90_000 });
    expect(slot().querySelector(".cv-card-row__status-label")?.textContent).toBe(label);
    expect(slot().querySelector("svg")).not.toBeNull();
    expect(slot().querySelector(".cv-card-row__tick")?.textContent).toBe("1:30");
  });

  it("keeps the live elapsed time after the working glyph and label", () => {
    render({ kind: "working", startedAtEpochMs: NOW - 90_000 });

    const status = slot();
    expect(status.querySelector("svg")).not.toBeNull();
    expect(status.querySelector(".cv-card-row__status-label")?.textContent).toBe("Working");
    expect(status.querySelector(".cv-card-row__tick")?.textContent).toBe("1:30");
  });
});
