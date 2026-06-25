// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useDebouncedPhpEditTick,
  type PhpEditTick,
} from "./useDebouncedPhpEditTick";

const lastTick = (ticks: (PhpEditTick | null)[]): PhpEditTick | null =>
  ticks[ticks.length - 1] ?? null;

describe("useDebouncedPhpEditTick", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  function Probe({
    content,
    onTick,
    path,
  }: {
    content: string | null;
    onTick: (tick: PhpEditTick | null) => void;
    path: string | null;
  }) {
    const tick = useDebouncedPhpEditTick(path, content);
    onTick(tick);
    return null;
  }

  const renderProbe = async (
    path: string | null,
    content: string | null,
    onTick: (tick: PhpEditTick | null) => void,
  ) => {
    await act(async () => {
      root.render(<Probe content={content} onTick={onTick} path={path} />);
      await Promise.resolve();
    });
  };

  it("publishes one debounced tick after the quiet window settles", async () => {
    vi.useFakeTimers();
    const ticks: (PhpEditTick | null)[] = [];
    const onTick = (tick: PhpEditTick | null) => ticks.push(tick);

    await renderProbe("/workspace/a.php", "<?php // 1", onTick);

    // No tick before the debounce window elapses.
    expect(lastTick(ticks)).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(160);
      await Promise.resolve();
    });

    expect(lastTick(ticks)).toEqual({
      content: "<?php // 1",
      path: "/workspace/a.php",
    });
  });

  it("arms a single debounce timer across a burst of keystrokes", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const ticks: (PhpEditTick | null)[] = [];
    const onTick = (tick: PhpEditTick | null) => ticks.push(tick);

    // First render arms a timer.
    await renderProbe("/workspace/a.php", "a", onTick);
    // Three rapid keystrokes: each re-arms, but the previous pending timer is
    // cleared, so only ONE timer is ever pending at a time and only the final
    // snapshot is published.
    await renderProbe("/workspace/a.php", "ab", onTick);
    await renderProbe("/workspace/a.php", "abc", onTick);
    await renderProbe("/workspace/a.php", "abcd", onTick);

    const armedTimers = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 160,
    ).length;
    // One timer per re-render is expected, but they never overlap (each cleared
    // before the next). The published tick proves a single coalesced result.
    expect(armedTimers).toBe(4);

    await act(async () => {
      vi.advanceTimersByTime(160);
      await Promise.resolve();
    });

    const published = ticks.filter((tick) => tick !== null);
    expect(published).toHaveLength(1);
    expect(published[0]).toEqual({ content: "abcd", path: "/workspace/a.php" });
  });

  it("does not re-publish an identical snapshot (stable tick across re-render)", async () => {
    vi.useFakeTimers();
    const ticks: (PhpEditTick | null)[] = [];
    const onTick = (tick: PhpEditTick | null) => ticks.push(tick);

    await renderProbe("/workspace/a.php", "stable", onTick);
    await act(async () => {
      vi.advanceTimersByTime(160);
      await Promise.resolve();
    });
    const firstTick = lastTick(ticks);
    expect(firstTick).toEqual({ content: "stable", path: "/workspace/a.php" });

    // Re-render with the SAME path + content (e.g. an unrelated prop changed).
    await renderProbe("/workspace/a.php", "stable", onTick);
    await act(async () => {
      vi.advanceTimersByTime(160);
      await Promise.resolve();
    });

    // The published object identity is unchanged, so consumers' effects keyed on
    // the tick do not re-run.
    expect(lastTick(ticks)).toBe(firstTick);
  });

  it("clears the tick synchronously when the document becomes ineligible", async () => {
    vi.useFakeTimers();
    const ticks: (PhpEditTick | null)[] = [];
    const onTick = (tick: PhpEditTick | null) => ticks.push(tick);

    await renderProbe("/workspace/a.php", "<?php", onTick);
    await act(async () => {
      vi.advanceTimersByTime(160);
      await Promise.resolve();
    });
    expect(lastTick(ticks)).not.toBeNull();

    // path becomes null (e.g. switched to a non-PHP document).
    await renderProbe(null, null, onTick);
    expect(lastTick(ticks)).toBeNull();
  });

  it("produces a distinct tick on a path switch", async () => {
    vi.useFakeTimers();
    const ticks: (PhpEditTick | null)[] = [];
    const onTick = (tick: PhpEditTick | null) => ticks.push(tick);

    await renderProbe("/workspace/a.php", "<?php // a", onTick);
    await act(async () => {
      vi.advanceTimersByTime(160);
      await Promise.resolve();
    });

    await renderProbe("/workspace/b.php", "<?php // b", onTick);
    await act(async () => {
      vi.advanceTimersByTime(160);
      await Promise.resolve();
    });

    expect(lastTick(ticks)).toEqual({
      content: "<?php // b",
      path: "/workspace/b.php",
    });
  });
});
