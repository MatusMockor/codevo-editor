// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateToast, type AppUpdateToastProps } from "./AppUpdateToast";

describe("AppUpdateToast", () => {
  let host: HTMLDivElement;
  let root: Root;
  let handlers: Omit<AppUpdateToastProps, "presentation">;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    handlers = {
      onDismiss: vi.fn(),
      onDownload: vi.fn(),
      onInstall: vi.fn(),
      onRetry: vi.fn(),
      onSkipVersion: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (presentation: AppUpdateToastProps["presentation"]) => {
    act(() => root.render(<AppUpdateToast {...handlers} presentation={presentation} />));
  };

  it("offers download, later, and skip for an available release", () => {
    render({ kind: "available", version: "0.2.0", currentVersion: "0.1.0", date: "2026-08-29" });

    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Update Available: Codevo v0.2.0",
    );
    expect(host.textContent).toContain("Installed v0.1.0");
    expect(host.textContent).toContain("Released 2026-08-29");
    act(() => button("Download").click());
    expect(handlers.onDownload).toHaveBeenCalledOnce();
    act(() => button("Skip version").click());
    expect(handlers.onSkipVersion).toHaveBeenCalledOnce();
    act(() => button("Later").click());
    expect(handlers.onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps pending downloads and installs non-dismissable", () => {
    render({ kind: "downloading", version: "0.2.0" });
    expect(host.querySelector(".toast-notification--loading")?.textContent).toContain(
      "Downloading update",
    );
    expect(host.querySelector('[aria-label="Dismiss notification"]')).toBeNull();
    expect(host.querySelectorAll("button")).toHaveLength(0);

    render({ kind: "installing", version: "0.2.0" });
    expect(host.textContent).toContain("Installing update");
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  it("asks to restart once the update is downloaded", () => {
    render({ kind: "readyToInstall", version: "0.2.0" });

    expect(host.textContent).toContain("Update 0.2.0 downloaded. Click to restart and install.");
    expect(host.textContent).toContain("Any running tasks will be interrupted.");
    act(() => button("Restart").click());
    expect(handlers.onInstall).toHaveBeenCalledOnce();
    act(() => button("Later").click());
    expect(handlers.onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps a failed download retryable and dismissable", () => {
    render({
      kind: "failed",
      version: "0.2.0",
      operation: "download",
      message: "Unable to download the application update.",
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to download the application update.",
    );
    act(() => button("Retry").click());
    expect(handlers.onRetry).toHaveBeenCalledOnce();
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')?.click(),
    );
    expect(handlers.onDismiss).toHaveBeenCalledOnce();
  });

  function button(label: string): HTMLButtonElement {
    const found = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    expect(found).toBeDefined();
    return found as HTMLButtonElement;
  }
});
