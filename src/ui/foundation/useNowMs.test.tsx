// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, type MountedUi } from "./foundationTestSupport";
import { DEFAULT_NOW_TICK_MS, useNowMs } from "./useNowMs";

let ui: MountedUi | null = null;
const seen: number[] = [];

afterEach(() => {
  ui?.unmount();
  ui = null;
  seen.length = 0;
  vi.useRealTimers();
});

function Probe() {
  seen.push(useNowMs());
  return null;
}

describe("useNowMs", () => {
  it("ticks on the interval and stops after unmount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    ui = mountUi();
    ui.render(<Probe />);
    expect(seen[seen.length - 1]).toBe(1_000);

    act(() => {
      vi.advanceTimersByTime(DEFAULT_NOW_TICK_MS);
    });
    expect(seen[seen.length - 1]).toBe(1_000 + DEFAULT_NOW_TICK_MS);

    ui.unmount();
    ui = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
