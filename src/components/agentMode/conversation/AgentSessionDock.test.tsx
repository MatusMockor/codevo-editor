// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionDock } from "./AgentSessionDock";
import type { AgentSessionEndOffer } from "./agentSessionTaskControls";

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

function buttonLabelled(label: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.getAttribute("aria-label") === label,
    ) ?? null
  );
}

describe("AgentSessionDock", () => {
  it("renders one calm bar with the count, names, View and Stop", () => {
    const open = vi.fn();
    const stop = vi.fn();
    act(() =>
      root.render(
        <AgentSessionDock
          activity={{
            label: "2 agents running",
            names: "explorer, reviewer",
            actions: ["view", "stop"],
            announce: true,
          }}
          follow={{ atLatest: true, unseenActivity: false, jumpToLatest: () => undefined }}
          onOpenAgents={open}
          onRevealQueue={() => undefined}
          onStop={stop}
          queuedCount={0}
        />,
      ),
    );

    const bars = host.querySelectorAll(".cv-session-dock__banners .cv-composer-banner");
    expect(bars).toHaveLength(1);
    expect(bars[0]?.className).toContain("cv-composer-banner--working");
    expect(bars[0]?.querySelectorAll(".cv-spinner")).toHaveLength(1);
    expect(bars[0]?.getAttribute("role")).toBe("status");
    expect(bars[0]?.textContent).toBe("2 agents runningexplorer, reviewerViewStop");
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="View agents"]')?.click());
    expect(open).toHaveBeenCalledTimes(1);
    act(() =>
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Stop agent and background work"]')
        ?.click(),
    );
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("omits Stop when the bar has no background work or no stop port", () => {
    const render = (actions: ReadonlyArray<"view" | "stop">, onStop?: () => void) =>
      act(() =>
        root.render(
          <AgentSessionDock
            activity={{ label: "1 agent running", names: "explorer", actions, announce: false }}
            follow={{ atLatest: true, unseenActivity: false, jumpToLatest: () => undefined }}
            onOpenAgents={() => undefined}
            onRevealQueue={() => undefined}
            onStop={onStop}
            queuedCount={0}
          />,
        ),
      );
    render(["view"], () => undefined);
    expect(host.querySelector('button[aria-label="Stop agent and background work"]')).toBeNull();
    expect(host.querySelector(".cv-composer-banner")?.getAttribute("role")).toBeNull();
    render(["view", "stop"]);
    expect(host.querySelector('button[aria-label="Stop agent and background work"]')).toBeNull();
    expect(host.querySelectorAll(".cv-composer-banner")).toHaveLength(1);
  });

  it("shows jump-to-latest only away from the latest message and the queue count only when queued", () => {
    const jump = vi.fn();
    act(() =>
      root.render(
        <AgentSessionDock
          activity={null}
          follow={{ atLatest: false, unseenActivity: true, jumpToLatest: jump }}
          onOpenAgents={() => undefined}
          onRevealQueue={() => undefined}
          queuedCount={2}
        />,
      ),
    );

    expect(host.querySelector(".agent-jump-latest__button")?.textContent).toBe("New activity");
    expect(host.querySelector('button[aria-label="Show 2 queued messages"]')?.textContent).toBe(
      "2 queued",
    );
    expect(host.querySelector(".cv-session-dock__banners")).toBeNull();
  });

  it("lists live session tasks with their own Stop, a pending Stopping state and End session", () => {
    const stopTask = vi.fn();
    const endSession = vi.fn();
    const render = (pending: boolean, offer: AgentSessionEndOffer) =>
      act(() =>
        root.render(
          <AgentSessionDock
            activity={{
              label: "1 background task running",
              names: "",
              actions: [],
              announce: false,
            }}
            follow={{ atLatest: true, unseenActivity: false, jumpToLatest: () => undefined }}
            onEndSession={endSession}
            onOpenAgents={() => undefined}
            onRevealQueue={() => undefined}
            onStopSessionTask={stopTask}
            queuedCount={0}
            sessionTasks={{
              rows: [
                {
                  taskId: "b8kzpiexm",
                  label: "Watch beta.75 release workflow",
                  stopLabel: 'Stop background task "Watch beta.75 release workflow"',
                  pending,
                },
              ],
              hiddenCount: 2,
              endSession: offer,
            }}
          />,
        ),
      );
    render(false, "offered");

    const stop = buttonLabelled('Stop background task "Watch beta.75 release workflow"');
    expect(stop).not.toBeNull();
    expect(stop?.disabled).toBe(false);
    expect(stop?.textContent).toBe("Stop");
    expect(host.querySelector('[role="list"]')?.textContent).toContain(
      "Watch beta.75 release workflow",
    );
    expect(host.textContent).toContain("+2 more");
    act(() => stop?.click());
    expect(stopTask).toHaveBeenCalledWith("b8kzpiexm");
    act(() =>
      host.querySelector<HTMLButtonElement>('button[aria-label="End Claude session"]')?.click(),
    );
    expect(endSession).toHaveBeenCalledTimes(1);

    render(true, "suggested");
    expect(buttonLabelled("End Claude session")?.className).toContain("cv-banner-action--emphasis");
    render(true, "hidden");
    const stopping = buttonLabelled('Stop background task "Watch beta.75 release workflow"');
    expect(stopping?.disabled).toBe(true);
    expect(stopping?.textContent).toBe("Stopping…");
    act(() => stopping?.click());
    expect(stopTask).toHaveBeenCalledTimes(1);
    expect(host.querySelector('button[aria-label="End Claude session"]')).toBeNull();
  });

  it("shows no session task controls without a stop port", () => {
    act(() =>
      root.render(
        <AgentSessionDock
          activity={{ label: "1 background task running", names: "", actions: [], announce: false }}
          follow={{ atLatest: true, unseenActivity: false, jumpToLatest: () => undefined }}
          onOpenAgents={() => undefined}
          onRevealQueue={() => undefined}
          queuedCount={0}
          sessionTasks={{
            rows: [
              {
                taskId: "t1",
                label: "Build",
                stopLabel: 'Stop background task "Build"',
                pending: false,
              },
            ],
            hiddenCount: 0,
            endSession: "offered",
          }}
        />,
      ),
    );
    expect(host.querySelector('[role="list"]')).toBeNull();
    expect(host.querySelector('button[aria-label="End Claude session"]')).toBeNull();
    expect(host.querySelector(".cv-composer-banner")?.textContent).toBe(
      "1 background task running",
    );
  });
});
