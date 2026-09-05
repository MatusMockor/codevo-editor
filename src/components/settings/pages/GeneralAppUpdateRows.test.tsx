// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdaterSurface } from "../../../application/useAppUpdater";
import { GeneralAppUpdateRows } from "./GeneralAppUpdateRows";

describe("GeneralAppUpdateRows", () => {
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
    vi.restoreAllMocks();
  });

  it("renders the current version without an implicit check", () => {
    const updater = updaterSurface({ kind: "idle", currentVersion: "0.2.0-beta.1" });
    render(updater);

    expect(host.textContent).toContain("Application updates");
    expect(host.textContent).toContain("Current version");
    expect(host.textContent).toContain("0.2.0-beta.1");
    expect(updater.check).not.toHaveBeenCalled();

    act(() => button("Check for updates").click());

    expect(updater.check).toHaveBeenCalledOnce();
  });

  it("checks without downloading and requires separate download and install clicks", () => {
    const available = {
      kind: "available",
      currentVersion: "0.1.0",
      version: "0.2.0",
      date: null,
      notes: "Beta update",
    } as const;
    const updater = updaterSurface(available);
    render(updater);

    expect(host.textContent).toContain("Available version");
    expect(host.textContent).toContain("0.2.0");
    expect(host.querySelector(".settings-update__notes")?.textContent).toBe("Beta update");

    act(() => button("Download update").click());

    expect(updater.download).toHaveBeenCalledOnce();
    expect(updater.installAndRestart).not.toHaveBeenCalled();

    render({ ...updater, state: { ...available, kind: "readyToInstall" } });
    act(() => button("Install and restart").click());

    expect(updater.installAndRestart).toHaveBeenCalledOnce();
  });

  it("skips the offered version without downloading it", () => {
    const updater = updaterSurface({
      kind: "available",
      currentVersion: "0.1.0",
      version: "0.2.0",
      date: null,
      notes: null,
    });
    render(updater);

    act(() => button("Skip this version").click());

    expect(updater.skipVersion).toHaveBeenCalledOnce();
    expect(updater.download).not.toHaveBeenCalled();
  });

  it("shows truthful no-update and failure states", () => {
    const updater = updaterSurface({ kind: "upToDate", currentVersion: "0.1.0" });
    render(updater);

    expect(host.textContent).toContain("Codevo is up to date.");
    expect(host.querySelector(".settings-update__status--success")).not.toBeNull();
    expect(button("Check for updates").disabled).toBe(false);

    render({
      ...updater,
      state: {
        kind: "failed",
        currentVersion: "0.1.0",
        operation: "check",
        message: "Unable to check for application updates.",
        release: null,
      },
    });

    expect(host.textContent).toContain("Unable to check for application updates.");
    expect(host.querySelector(".settings-update__status--danger")).not.toBeNull();
  });

  it("disables the action while an operation is pending and offers no skip", () => {
    render(updaterSurface({ kind: "checking", currentVersion: "0.1.0", generation: 2 }));

    expect(button("Checking…").disabled).toBe(true);
    expect(button("Checking…").getAttribute("aria-busy")).toBe("true");
    expect(
      [...host.querySelectorAll("button")].some(
        (candidate) => candidate.textContent === "Skip this version",
      ),
    ).toBe(false);
  });

  it("keeps the registry row and reports that updates are unavailable without a surface", () => {
    act(() => root.render(<GeneralAppUpdateRows updater={null} />));

    const row = host.querySelector('[data-settings-row="general.appUpdates"]');

    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Updates unavailable");
  });

  function render(updater: AppUpdaterSurface): void {
    act(() => root.render(<GeneralAppUpdateRows updater={updater} />));
  }

  function button(label: string): HTMLButtonElement {
    const match = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );

    expect(match).toBeDefined();
    return match as HTMLButtonElement;
  }
});

function updaterSurface(state: AppUpdaterSurface["state"]): AppUpdaterSurface {
  return {
    state,
    check: vi.fn(async () => undefined),
    dismiss: vi.fn(),
    download: vi.fn(async () => undefined),
    installAndRestart: vi.fn(async () => undefined),
    skipVersion: vi.fn(async () => undefined),
  };
}
