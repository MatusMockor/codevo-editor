// @vitest-environment jsdom

import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountUi, pointer, press, type MountedUi } from "./foundationTestSupport";
import { Spinner } from "./Spinner";
import { useDismiss } from "./useDismiss";
import { useRestoreFocus } from "./useRestoreFocus";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
  document.body.replaceChildren();
});

function DismissProbe({ active, onDismiss }: { readonly active: boolean; onDismiss(): void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  useDismiss(active, containerRef, anchorRef, onDismiss);
  return (
    <>
      <button ref={anchorRef} type="button">
        anchor
      </button>
      <div ref={containerRef}>
        <button type="button">inside</button>
      </div>
    </>
  );
}

function FocusTaker() {
  const innerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    innerRef.current?.focus();
  }, []);
  return (
    <button ref={innerRef} type="button">
      inner
    </button>
  );
}

function RestoringSurface() {
  useRestoreFocus();
  return <FocusTaker />;
}

describe("useDismiss", () => {
  it("dismisses on an outside pointer and on Escape, not inside or on the anchor", () => {
    const onDismiss = vi.fn();
    ui = mountUi();
    ui.render(<DismissProbe active onDismiss={onDismiss} />);
    const [anchor, inside] = [...ui.host.querySelectorAll("button")];

    pointer(inside as Element, "pointerdown");
    pointer(anchor as Element, "pointerdown");
    expect(onDismiss).not.toHaveBeenCalled();

    pointer(document.body, "pointerdown");
    press(inside as Element, "Escape");
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("stays silent while inactive and after unmount", () => {
    const onDismiss = vi.fn();
    ui = mountUi();
    ui.render(<DismissProbe active={false} onDismiss={onDismiss} />);
    pointer(document.body, "pointerdown");

    ui.render(<DismissProbe active onDismiss={onDismiss} />);
    ui.unmount();
    ui = null;
    pointer(document.body, "pointerdown");

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("useRestoreFocus", () => {
  it("returns focus to the element focused before a child grabbed it", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    ui = mountUi();

    ui.render(<RestoringSurface />);
    expect(document.activeElement?.textContent).toBe("inner");

    ui.render(null);
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps focus that moved outside the surface before it closed", () => {
    const trigger = document.createElement("button");
    const elsewhere = document.createElement("textarea");
    document.body.append(trigger, elsewhere);
    trigger.focus();
    ui = mountUi();
    ui.render(<RestoringSurface />);

    elsewhere.focus();
    ui.render(null);

    expect(document.activeElement).toBe(elsewhere);
  });

  it("does nothing when the previous element left the document", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    ui = mountUi();
    ui.render(<RestoringSurface />);
    trigger.remove();

    ui.render(null);

    expect(document.activeElement).toBe(document.body);
  });
});

describe("Spinner", () => {
  it("is decorative without a label and a status with one", () => {
    ui = mountUi();
    ui.render(<Spinner />);
    expect(ui.host.querySelector(".cv-spinner")?.getAttribute("aria-hidden")).toBe("true");

    ui.render(<Spinner label="Loading threads" />);
    const status = ui.host.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("Loading threads");
    expect(status?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
