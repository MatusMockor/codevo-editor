// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentClockProvider } from "./agentClock";
import { AGENT_ROW_STATUS_ICON_SIZE, StatusSlot } from "./AgentThreadRowParts";
import type { AgentRowStatus } from "./agentSidebarPresentation";

const NOW = 1_700_000_600_000;

describe("StatusSlot", () => {
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
          <StatusSlot status={status} updatedAtEpochMs={NOW - 5 * 60_000} />
        </AgentClockProvider>,
      );
    });
  };

  const slot = (): HTMLElement => {
    const element = host.querySelector<HTMLElement>(".agent-row__status");
    expect(element).not.toBeNull();
    return element as HTMLElement;
  };

  it("renders the relative time and no status glyph when nothing is worth announcing", () => {
    render({ kind: "none" });

    expect(host.querySelector(".agent-row__status")).toBeNull();
    expect(host.querySelector(".agent-row__time")?.textContent).toBe("5m");
  });

  it("renders a check glyph before the Done label for a settled unread thread", () => {
    render({ kind: "done" });

    const status = slot();
    expect(status.classList.contains("agent-row__status--done")).toBe(true);
    expect(status.textContent).toBe("Done");
    expect(status.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(status.firstElementChild?.classList.contains("agent-row__status-icon")).toBe(true);
    expect(status.firstElementChild?.getAttribute("width")).toBe(
      String(AGENT_ROW_STATUS_ICON_SIZE),
    );
    expect(status.querySelector(".agent-row__status-label")?.textContent).toBe("Done");
    expect(host.querySelector(".agent-row__time")).toBeNull();
  });

  it("renders a glyph and label for failed and stopped threads", () => {
    render({ kind: "failed" });

    expect(slot().querySelector(".agent-row__status-icon")).not.toBeNull();
    expect(slot().textContent).toBe("Failed");

    render({ kind: "stopped" });

    expect(slot().querySelector(".agent-row__status-icon")).not.toBeNull();
    expect(slot().textContent).toBe("Stopped");
  });

  it("keeps the live elapsed duration after the working glyph and label", () => {
    render({ kind: "working", startedAtEpochMs: NOW - 90_000 });

    const status = slot();
    expect(status.querySelector(".agent-row__status-icon")).not.toBeNull();
    expect(status.querySelector(".agent-row__status-label")?.textContent).toBe("Working");
    expect(status.querySelector("time")?.textContent).toBe("1m");
  });
});
