// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentClockProvider, AgentRelativeTime } from "./agentClock";

const NOW = 1_700_000_600_000;

describe("agent clock", () => {
  let host: HTMLDivElement;
  let root: Root;
  let probeRenders: number;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    probeRenders = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("renders the elapsed time against the shared clock", () => {
    render(NOW - 10 * 60_000);

    expect(host.textContent).toContain("10 minutes ago");
  });

  it("advances every leaf on a tick without rerendering the surrounding tree", () => {
    render(NOW - 10 * 60_000);

    expect(probeRenders).toBe(1);

    act(() => {
      vi.setSystemTime(NOW + 50 * 60_000);
      vi.advanceTimersByTime(1_000);
    });
    act(() => {
      vi.setSystemTime(NOW + 110 * 60_000);
      vi.advanceTimersByTime(1_000);
    });
    act(() => {
      vi.setSystemTime(NOW + 170 * 60_000);
      vi.advanceTimersByTime(1_000);
    });

    expect(host.textContent).toContain("3 hours ago");
    expect(probeRenders).toBe(1);
  });

  it("falls back to the wall clock without a provider", () => {
    act(() => root.render(<AgentRelativeTime epochMs={NOW - 2 * 60_000} />));

    expect(host.textContent).toContain("2 minutes ago");
  });

  function render(epochMs: number): void {
    act(() =>
      root.render(
        <AgentClockProvider nowTickMs={1_000}>
          <Probe>
            <AgentRelativeTime epochMs={epochMs} />
          </Probe>
        </AgentClockProvider>,
      ),
    );
  }

  function Probe({ children }: { readonly children: ReactNode }) {
    probeRenders += 1;
    return <div className="probe">{children}</div>;
  }
});
