// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, type AppSettings } from "../../domain/settings";
import {
  useInitialAppSettingsHydration,
  type InitialAppSettingsHydrationOptions,
} from "./useInitialAppSettingsHydration";

describe("useInitialAppSettingsHydration", () => {
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

  it("applies settings and opens the preferred recent workspace once while mounted", async () => {
    const pending = deferred<AppSettings>();
    const options = hydrationOptions(pending.promise);
    render(options);

    await resolve(pending, {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace/recent",
      workspaceTabs: ["/workspace/tab"],
    });
    render(options);
    await flush();

    expect(options.settingsGateway.loadAppSettings).toHaveBeenCalledTimes(1);
    expect(options.applyAppSettings).toHaveBeenCalledTimes(1);
    expect(options.openWorkspacePath).toHaveBeenCalledTimes(1);
    expect(options.openWorkspacePath).toHaveBeenCalledWith("/workspace/recent");
    expect(options.reportError).not.toHaveBeenCalled();
  });

  it("falls back to the first workspace tab", async () => {
    const settings = {
      ...defaultAppSettings(),
      recentWorkspacePath: null,
      workspaceTabs: ["/workspace/tab", "/workspace/other"],
    };
    const options = hydrationOptions(Promise.resolve(settings));
    render(options);
    await flush();

    expect(options.openWorkspacePath).toHaveBeenCalledWith("/workspace/tab");
  });

  it("reports a mounted settings rejection once", async () => {
    const failure = new Error("settings unavailable");
    const options = hydrationOptions(Promise.reject(failure));
    render(options);
    await flush();

    expect(options.reportError).toHaveBeenCalledTimes(1);
    expect(options.reportError).toHaveBeenCalledWith("Settings", failure);
    expect(options.applyAppSettings).not.toHaveBeenCalled();
    expect(options.openWorkspacePath).not.toHaveBeenCalled();
  });

  it.each(["apply", "open"] as const)(
    "reports a synchronous %s collaborator failure once",
    async (operation) => {
      const failure = new Error(`${operation} failed`);
      const base = hydrationOptions(
        Promise.resolve({
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace/recent",
        }),
      );
      const options: InitialAppSettingsHydrationOptions = {
        ...base,
        applyAppSettings:
          operation === "apply"
            ? vi.fn(() => {
                throw failure;
              })
            : base.applyAppSettings,
        openWorkspacePath:
          operation === "open"
            ? vi.fn(() => {
                throw failure;
              })
            : base.openWorkspacePath,
      };
      render(options);
      await flush();

      expect(options.reportError).toHaveBeenCalledTimes(1);
      expect(options.reportError).toHaveBeenCalledWith("Settings", failure);
      if (operation === "apply") expect(options.openWorkspacePath).not.toHaveBeenCalled();
      if (operation === "open") expect(options.applyAppSettings).toHaveBeenCalledTimes(1);
    },
  );

  it("reports a synchronous settings load failure once", async () => {
    const failure = new Error("load failed");
    const base = hydrationOptions(Promise.resolve(defaultAppSettings()));
    const options: InitialAppSettingsHydrationOptions = {
      ...base,
      settingsGateway: {
        loadAppSettings: vi.fn(() => {
          throw failure;
        }),
      },
    };
    render(options);
    await flush();

    expect(options.reportError).toHaveBeenCalledTimes(1);
    expect(options.reportError).toHaveBeenCalledWith("Settings", failure);
    expect(options.applyAppSettings).not.toHaveBeenCalled();
    expect(options.openWorkspacePath).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("ignores a late %s after unmount", async (settlement) => {
    const pending = deferred<AppSettings>();
    const options = hydrationOptions(pending.promise);
    render(options);
    act(() => root.unmount());

    if (settlement === "resolve") {
      await resolve(pending, {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace/late",
      });
    }
    if (settlement === "reject") await reject(pending, new Error("late failure"));

    expect(options.applyAppSettings).not.toHaveBeenCalled();
    expect(options.openWorkspacePath).not.toHaveBeenCalled();
    expect(options.reportError).not.toHaveBeenCalled();
  });

  function render(options: InitialAppSettingsHydrationOptions): void {
    act(() => root.render(<Harness options={options} />));
  }
});

function Harness({ options }: { readonly options: InitialAppSettingsHydrationOptions }) {
  const hasRestoredRef = useRef(false);
  useInitialAppSettingsHydration({ ...options, hasRestoredRef });
  return null;
}

function hydrationOptions(result: Promise<AppSettings>): InitialAppSettingsHydrationOptions {
  return {
    hasRestoredRef: { current: false },
    settingsGateway: { loadAppSettings: vi.fn<() => Promise<AppSettings>>(() => result) },
    applyAppSettings: vi.fn<(settings: AppSettings) => void>(),
    openWorkspacePath: vi.fn<(path: string) => Promise<void>>(async () => undefined),
    reportError: vi.fn<(scope: string, error: unknown) => void>(),
  };
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

async function resolve<Value>(pending: Deferred<Value>, value: Value): Promise<void> {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}

async function reject<Value>(pending: Deferred<Value>, error: unknown): Promise<void> {
  await act(async () => {
    pending.reject(error);
    await pending.promise.catch(() => undefined);
  });
}

async function flush(): Promise<void> {
  await act(async () => Promise.resolve());
}
