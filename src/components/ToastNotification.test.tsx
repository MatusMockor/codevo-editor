// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastMark, ToastNotification } from "./ToastNotification";

describe("ToastNotification", () => {
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

  it("announces informational toasts as status and errors as alerts", () => {
    act(() => root.render(<ToastNotification onClose={vi.fn()} title="Info toast" />));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Info toast");

    act(() => root.render(<ToastNotification onClose={vi.fn()} template="error" title="Broken" />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Broken");
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("exposes a labelled close control and dismisses on Escape from inside the toast", () => {
    const onClose = vi.fn();
    act(() =>
      root.render(
        <ToastNotification
          actions={[{ id: "primary", label: "Update", onClick: vi.fn(), tone: "primary" }]}
          onClose={onClose}
          title="Update"
        />,
      ),
    );

    const close = host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]');
    expect(close).not.toBeNull();
    act(() => close?.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    const action = host.querySelector<HTMLButtonElement>(".toast-notification-action--primary");
    act(() => {
      action?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);

    act(() => {
      action?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("omits the close control while a toast has no dismissal", () => {
    act(() => root.render(<ToastNotification template="loading" title="Downloading" />));
    expect(host.querySelector('[aria-label="Dismiss notification"]')).toBeNull();
    expect(host.querySelector(".toast-notification--loading")).not.toBeNull();
  });

  it("renders bounded meta entries, action placement, and busy state", () => {
    act(() =>
      root.render(
        <ToastNotification
          actions={[
            {
              id: "copy",
              label: "Copy error",
              onClick: vi.fn(),
              placement: "leading",
              tone: "ghost",
            },
            { id: "retry", label: "Retry", onClick: vi.fn(), isBusy: true, disabled: true },
          ]}
          description="Body"
          icon={<ToastMark badge="update">glyph</ToastMark>}
          meta={["Installed v1.0.0", null, "via npm"]}
          onClose={vi.fn()}
          title="Title"
        />,
      ),
    );

    const meta = Array.from(host.querySelectorAll(".toast-notification__meta li")).map(
      (entry) => entry.textContent,
    );
    expect(meta).toEqual(["Installed v1.0.0", "via npm"]);
    expect(host.querySelector(".toast-notification-action--leading")?.textContent).toBe(
      "Copy error",
    );
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(retry?.getAttribute("aria-busy")).toBe("true");
    expect(retry?.disabled).toBe(true);
    expect(host.querySelector(".toast-notification__badge--update")).not.toBeNull();
    expect(host.textContent).toContain("Body");
  });
});
