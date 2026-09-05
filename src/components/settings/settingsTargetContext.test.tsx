// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { SettingsRow } from "./primitives/SettingsRow";
import { SETTINGS_TARGET_PULSE_MS, SettingsTargetContext } from "./settingsTargetContext";
import type { SettingsRowId } from "./settingsRegistry";

describe("useSettingsRowTarget", () => {
  let host: HTMLDivElement;
  let root: Root;
  let scrollIntoView: ReturnType<typeof vi.fn>;
  let handled: Mock<() => void>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    scrollIntoView = vi.fn();
    handled = vi.fn<() => void>();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
      writable: true,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
      writable: true,
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("scrolls, focuses and pulses the targeted row, then reports it handled", () => {
    render("general.formatOnSave");

    const targeted = row("general.formatOnSave");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(document.activeElement).toBe(targeted);
    expect(targeted?.getAttribute("data-target")).toBe("true");
    expect(handled).toHaveBeenCalledTimes(1);
    expect(row("general.autoSave")?.hasAttribute("data-target")).toBe(false);
  });

  it("clears the pulse after the pulse window", () => {
    render("general.formatOnSave");

    act(() => {
      vi.advanceTimersByTime(SETTINGS_TARGET_PULSE_MS + 1);
    });

    expect(row("general.formatOnSave")?.hasAttribute("data-target")).toBe(false);
  });

  it("clears the pulse when the row loses focus", () => {
    render("general.formatOnSave");

    act(() => {
      row("general.formatOnSave")?.dispatchEvent(new FocusEvent("blur"));
    });

    expect(row("general.formatOnSave")?.hasAttribute("data-target")).toBe(false);
  });

  it("does not smooth scroll under reduced motion", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
      writable: true,
    });

    render("general.autoSave");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("leaves every row untouched when nothing is targeted", () => {
    render(null);

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(handled).not.toHaveBeenCalled();
    expect(row("general.formatOnSave")?.hasAttribute("data-target")).toBe(false);
  });

  function row(id: SettingsRowId): HTMLElement | null {
    return host.querySelector<HTMLElement>(`[data-settings-row="${id}"]`);
  }

  function render(targetRowId: SettingsRowId | null): void {
    act(() =>
      root.render(
        <SettingsTargetContext.Provider value={{ onTargetHandled: handled, targetRowId }}>
          <SettingsRow rowId="general.formatOnSave">
            <button type="button">on</button>
          </SettingsRow>
          <SettingsRow rowId="general.autoSave">
            <button type="button">off</button>
          </SettingsRow>
        </SettingsTargetContext.Provider>,
      ),
    );
  }
});
