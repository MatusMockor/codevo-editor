// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AppUpdaterSurface } from "../application/useAppUpdater";
import { AppUpdateDialog } from "./AppUpdateDialog";

describe("AppUpdateDialog", () => {
  it("shows bounded release data and the explicit startup choices", () => {
    const updater = surface("available");
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<AppUpdateDialog updater={updater} />));

    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      "Codevo 0.2.0 is available",
    );
    expect(host.textContent).toContain("Release notes");
    click(host, "Download and install");
    expect(updater.download).toHaveBeenCalledOnce();
    click(host, "Skip this version");
    expect(updater.skipVersion).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it("renders nothing for up-to-date and failed startup checks", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<AppUpdateDialog updater={surface("upToDate")} />));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.render(<AppUpdateDialog updater={surface("failed")} />));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
  });

  it("keeps an update failure dismissible and retryable", () => {
    const updater = surface("failedRelease");
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<AppUpdateDialog updater={updater} />));

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Unable to download");
    click(host, "Retry update");
    expect(updater.check).toHaveBeenCalledOnce();
    click(host, "Later");
    expect(updater.dismiss).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});

function surface(kind: "available" | "upToDate" | "failed" | "failedRelease"): AppUpdaterSurface {
  const common = { currentVersion: "0.1.0" } as const;
  return {
    state:
      kind === "available"
        ? { ...common, kind, version: "0.2.0", date: null, notes: "Release notes" }
        : kind === "upToDate"
          ? { ...common, kind }
          : kind === "failedRelease"
            ? {
                ...common,
                kind: "failed",
                operation: "download",
                message: "Unable to download the application update.",
                release: {
                  ...common,
                  version: "0.2.0",
                  date: null,
                  notes: "Release notes",
                },
              }
            : { ...common, kind, operation: "check", message: "Unable to check.", release: null },
    check: vi.fn(async () => undefined),
    dismiss: vi.fn(),
    download: vi.fn(async () => undefined),
    installAndRestart: vi.fn(async () => undefined),
    skipVersion: vi.fn(async () => undefined),
  };
}

function click(host: HTMLElement, label: string): void {
  const button = Array.from(host.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Missing ${label}.`);
  act(() => button.click());
}
