// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdaterSurface } from "../../../application/useAppUpdater";
import type { AppUpdateChannel } from "../../../domain/appUpdateChannel";
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

  it("renders the version row and the update track without an implicit check", () => {
    const updater = updaterSurface({ kind: "idle", currentVersion: "0.2.0-beta.1" });
    render(updater);

    expect(host.querySelector(".settings-section__title")?.textContent).toBe("Updates");
    expect(rowPart("general.appUpdates", ".settings-row__title")?.textContent).toBe("Codevo");
    expect(rowPart("general.appUpdates", ".settings-row__meta")?.textContent).toBe("0.2.0-beta.1");
    expect(channelOption("Beta").getAttribute("aria-checked")).toBe("true");
    expect(channelOption("Stable").getAttribute("aria-checked")).toBe("false");
    expect(updater.check).not.toHaveBeenCalled();

    act(() => button("Check for updates").click());

    expect(updater.check).toHaveBeenCalledOnce();
  });

  it("switches the update track through the Stable/Beta segmented control", () => {
    const onChangeChannel = vi.fn();
    render(updaterSurface({ kind: "idle", currentVersion: "0.2.0" }), { onChangeChannel });

    act(() => channelOption("Stable").click());

    expect(onChangeChannel).toHaveBeenCalledWith("stable");
  });

  it("says there is no stable release yet as a neutral status with a check action", () => {
    const updater = updaterSurface({
      kind: "noRelease",
      currentVersion: "0.2.0-beta.1",
      channel: "stable",
    });
    render(updater, { channel: "stable" });

    expect(rowPart("general.appUpdates", ".settings-row__description")?.textContent).toBe(
      "No stable release yet",
    );
    expect(host.querySelector(".settings-update__status--neutral")).not.toBeNull();
    expect(host.querySelector(".settings-update__status--success")).toBeNull();
    expect(host.querySelector(".settings-update__status--danger")).toBeNull();
    expect(host.textContent).not.toContain("up to date");
    expect(host.textContent).not.toContain("Skip this version");
    expect(host.querySelector(".settings-update__notes")).toBeNull();
    expect(button("Check for updates").disabled).toBe(false);

    act(() => button("Check for updates").click());

    expect(updater.check).toHaveBeenCalledOnce();
    expect(updater.download).not.toHaveBeenCalled();
  });

  it("checks without downloading and requires separate download and install clicks", () => {
    const available = {
      kind: "available",
      currentVersion: "0.1.0",
      version: "0.2.0",
      date: null,
      notesSpan: { kind: "single", notes: "Beta update" },
    } as const;
    const updater = updaterSurface(available);
    render(updater);

    expect(rowPart("general.appUpdates", ".settings-row__description")?.textContent).toBe(
      "Codevo 0.2.0 is available.",
    );
    expect(host.querySelector(".settings-update__notes")?.textContent).toBe("Beta update");

    act(() => button("Update").click());

    expect(updater.download).toHaveBeenCalledOnce();
    expect(updater.installAndRestart).not.toHaveBeenCalled();

    render({ ...updater, state: { ...available, kind: "readyToInstall" } });
    act(() => button("Install and restart").click());

    expect(updater.installAndRestart).toHaveBeenCalledOnce();
  });

  it("offers only restart after the update is already installed", () => {
    const updater = updaterSurface({
      kind: "readyToRestart",
      currentVersion: "0.1.0",
      version: "0.2.0",
      date: null,
      notesSpan: { kind: "single", notes: null },
    });
    render(updater);
    expect(host.textContent).toContain(
      "Update installed. Restart now or use it next time you open Codevo.",
    );
    expect(host.textContent).not.toContain("Skip this version");
    expect(host.textContent).not.toContain("Install and restart");
    act(() => button("Restart").click());
    expect(updater.installAndRestart).toHaveBeenCalledOnce();
    expect(updater.download).not.toHaveBeenCalled();
  });

  it("lists every release in a multi-version span with a truthful bounded state", () => {
    const updater = updaterSurface({
      kind: "available",
      currentVersion: "0.2.0-beta.24",
      version: "0.2.0-beta.29",
      date: null,
      notesSpan: {
        kind: "bounded",
        entries: [
          { version: "0.2.0-beta.29", notes: "Twenty nine" },
          { version: "0.2.0-beta.28", notes: "Twenty eight" },
        ],
      },
    });
    render(updater);

    expect(host.textContent).toContain("Showing the last 2 releases of a longer span.");
    const versions = [...host.querySelectorAll(".settings-update__release-version")].map(
      (node) => node.textContent,
    );
    expect(versions).toEqual(["v0.2.0-beta.29", "v0.2.0-beta.28"]);
    expect(host.textContent).toContain("Twenty nine");
    expect(host.textContent).toContain("Twenty eight");
  });

  it("explains a newer release without claiming the prepared update is the newest", () => {
    const updater = updaterSurface({
      kind: "readyToRestartOutdated",
      currentVersion: "0.2.0-beta.20",
      version: "0.2.0-beta.28",
      date: null,
      notesSpan: { kind: "single", notes: null },
      supersededBy: { version: "0.2.0-beta.29", date: null },
    });
    render(updater);

    expect(host.textContent).toContain(
      "Codevo v0.2.0-beta.29 is already available and is offered after this restart.",
    );
    expect(host.textContent).not.toContain("up to date");
    act(() => button("Restart").click());
    expect(updater.installAndRestart).toHaveBeenCalledOnce();
  });

  it("skips the offered version without downloading it", () => {
    const updater = updaterSurface({
      kind: "available",
      currentVersion: "0.1.0",
      version: "0.2.0",
      date: null,
      notesSpan: { kind: "single", notes: null },
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
    act(() =>
      root.render(<GeneralAppUpdateRows channel="beta" onChangeChannel={vi.fn()} updater={null} />),
    );

    const row = host.querySelector('[data-settings-row="general.appUpdates"]');

    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Updates unavailable");
  });

  function render(
    updater: AppUpdaterSurface,
    options: {
      readonly channel?: AppUpdateChannel;
      readonly onChangeChannel?: (channel: AppUpdateChannel) => void;
    } = {},
  ): void {
    act(() =>
      root.render(
        <GeneralAppUpdateRows
          channel={options.channel ?? "beta"}
          onChangeChannel={options.onChangeChannel ?? vi.fn()}
          updater={updater}
        />,
      ),
    );
  }

  function rowPart(rowId: string, selector: string): Element | null {
    return host.querySelector(`[data-settings-row="${rowId}"] ${selector}`);
  }

  function channelOption(label: string): HTMLButtonElement {
    const match = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '[data-settings-row="general.updateChannel"] [role="radio"]',
      ),
    ].find((candidate) => candidate.textContent === label);

    expect(match).toBeDefined();
    return match as HTMLButtonElement;
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
