// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionDock } from "./AgentSessionDock";

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
});
