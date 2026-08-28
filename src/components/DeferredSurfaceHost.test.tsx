// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeferredSurfaceHost } from "./DeferredSurfaceHost";

describe("DeferredSurfaceHost", () => {
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
  });

  it("defers a hidden surface and keeps the same owner mounted after first activation", () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Surface() {
      useEffect(() => {
        mounted();
        return () => {
          unmounted();
        };
      }, []);
      return <div data-testid="surface" />;
    }
    const render = (active: boolean) =>
      act(() =>
        root.render(
          <DeferredSurfaceHost active={active} fallback={<div role="status">Loading…</div>}>
            <Surface />
          </DeferredSurfaceHost>,
        ),
      );

    render(false);
    expect(host.querySelector('[data-testid="surface"]')).toBeNull();
    expect(mounted).not.toHaveBeenCalled();

    render(true);
    const surface = host.querySelector('[data-testid="surface"]');
    expect(surface).not.toBeNull();
    expect(mounted).toHaveBeenCalledTimes(1);

    render(false);
    expect(host.querySelector('[data-testid="surface"]')).toBe(surface);
    expect(unmounted).not.toHaveBeenCalled();
  });
});
