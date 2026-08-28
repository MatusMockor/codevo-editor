// @vitest-environment jsdom

import { act, StrictMode, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, type AppSettings } from "../../domain/settings";
import {
  useInitialAppSettingsHydration,
  type InitialAppSettingsHydrationOptions,
} from "./useInitialAppSettingsHydration";
import type {
  WorkspaceOpenOutcome,
  WorkspaceStartupRestoreIntent,
} from "./useWorkspaceOpenRequestLifecycle";

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
    expect(options.onAppSettingsHydrated).toHaveBeenCalledTimes(1);
    expect(options.beginStartupRestore).toHaveBeenCalledTimes(1);
    expect(options.startupOpenWorkspacePath).toHaveBeenCalledTimes(1);
    expect(options.startupOpenWorkspacePath).toHaveBeenCalledWith("/workspace/recent");
    expect(options.reportError).not.toHaveBeenCalled();
  });

  it("lets only the current Strict Mode replay publish hydration", async () => {
    const stale = deferred<AppSettings>();
    const current = deferred<AppSettings>();
    const options = hydrationOptions(stale.promise);
    options.settingsGateway.loadAppSettings = vi
      .fn<() => Promise<AppSettings>>()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);

    act(() =>
      root.render(
        <StrictMode>
          <Harness options={options} />
        </StrictMode>,
      ),
    );

    expect(options.settingsGateway.loadAppSettings).toHaveBeenCalledTimes(2);
    await resolve(stale, {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace/stale",
    });
    expect(options.applyAppSettings).not.toHaveBeenCalled();
    expect(options.onAppSettingsHydrated).not.toHaveBeenCalled();
    expect(options.startupOpenWorkspacePath).not.toHaveBeenCalled();

    await resolve(current, {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace/current",
    });

    expect(options.applyAppSettings).toHaveBeenCalledTimes(1);
    expect(options.onAppSettingsHydrated).toHaveBeenCalledExactlyOnceWith(true);
    expect(options.startupOpenWorkspacePath).toHaveBeenCalledExactlyOnceWith("/workspace/current");
  });

  it("does not repeat settled hydration when a dependency identity changes", async () => {
    const options = hydrationOptions(Promise.resolve(defaultAppSettings()));
    render(options);
    await flush();

    render({
      ...options,
      reportError: vi.fn<(scope: string, error: unknown) => void>(),
    });
    await flush();

    expect(options.settingsGateway.loadAppSettings).toHaveBeenCalledTimes(1);
    expect(options.applyAppSettings).toHaveBeenCalledTimes(1);
    expect(options.onAppSettingsHydrated).toHaveBeenCalledTimes(1);
    expect(options.beginStartupRestore).toHaveBeenCalledTimes(1);
    expect(options.startupOpenWorkspacePath).not.toHaveBeenCalled();
  });

  it("preserves a shared restored claim across a settled unmount and remount", async () => {
    const options = hydrationOptions(Promise.resolve(defaultAppSettings()));
    const sharedHasRestoredRef = { current: false };

    act(() =>
      root.render(<SharedRefHarness options={options} hasRestoredRef={sharedHasRestoredRef} />),
    );
    await flush();
    expect(sharedHasRestoredRef.current).toBe(true);

    act(() => root.render(null));
    act(() =>
      root.render(<SharedRefHarness options={options} hasRestoredRef={sharedHasRestoredRef} />),
    );
    await flush();

    expect(options.settingsGateway.loadAppSettings).toHaveBeenCalledTimes(1);
    expect(options.applyAppSettings).toHaveBeenCalledTimes(1);
    expect(options.onAppSettingsHydrated).toHaveBeenCalledTimes(1);
    expect(options.beginStartupRestore).toHaveBeenCalledTimes(1);
    expect(options.startupOpenWorkspacePath).not.toHaveBeenCalled();
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

    expect(options.startupOpenWorkspacePath).toHaveBeenCalledWith("/workspace/tab");
  });

  it("applies fail-closed defaults and completes hydration after a mounted settings rejection", async () => {
    const failure = new Error("settings unavailable");
    const options = hydrationOptions(Promise.reject(failure));
    render(options);
    await flush();

    expect(options.reportError).toHaveBeenCalledTimes(1);
    expect(options.reportError).toHaveBeenCalledWith("Settings", failure);
    expect(options.applyAppSettings).toHaveBeenCalledWith(defaultAppSettings());
    expect(options.onAppSettingsHydrated).toHaveBeenCalledWith(true);
    expect(options.startupOpenWorkspacePath).not.toHaveBeenCalled();
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
      const options: HydrationTestOptions = {
        ...base,
        applyAppSettings:
          operation === "apply"
            ? vi.fn(() => {
                throw failure;
              })
            : base.applyAppSettings,
        startupOpenWorkspacePath:
          operation === "open"
            ? vi.fn<(path: string) => Promise<WorkspaceOpenOutcome>>(() => {
                throw failure;
              })
            : base.startupOpenWorkspacePath,
      };
      options.startupRestore.openWorkspacePath = options.startupOpenWorkspacePath;
      render(options);
      await flush();

      expect(options.reportError).toHaveBeenCalledTimes(1);
      expect(options.reportError).toHaveBeenCalledWith("Settings", failure);
      if (operation === "apply") expect(options.startupOpenWorkspacePath).not.toHaveBeenCalled();
      if (operation === "apply") expect(options.onAppSettingsHydrated).not.toHaveBeenCalled();
      if (operation === "open") expect(options.onAppSettingsHydrated).toHaveBeenCalledTimes(1);
      if (operation === "open") expect(options.applyAppSettings).toHaveBeenCalledTimes(1);
    },
  );

  it("applies fail-closed defaults after a synchronous settings load failure", async () => {
    const failure = new Error("load failed");
    const base = hydrationOptions(Promise.resolve(defaultAppSettings()));
    const options: HydrationTestOptions = {
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
    expect(options.applyAppSettings).toHaveBeenCalledWith(defaultAppSettings());
    expect(options.onAppSettingsHydrated).toHaveBeenCalledWith(true);
    expect(options.startupOpenWorkspacePath).not.toHaveBeenCalled();
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
    expect(options.onAppSettingsHydrated).not.toHaveBeenCalled();
    expect(options.startupOpenWorkspacePath).not.toHaveBeenCalled();
    expect(options.reportError).not.toHaveBeenCalled();
  });

  it("lets a manual open permanently win over delayed startup settings", async () => {
    const pending = deferred<AppSettings>();
    const options = hydrationOptions(pending.promise);
    render(options);
    options.startupRestoreCurrent.current = false;

    await resolve(pending, {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace/startup",
    });

    expect(options.applyAppSettings).toHaveBeenCalledTimes(1);
    expect(options.startupOpenWorkspacePath).not.toHaveBeenCalled();
  });

  it("awaits and reports an asynchronous startup open rejection", async () => {
    const failure = new Error("open rejected");
    const options = hydrationOptions(
      Promise.resolve({
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace/recent",
      }),
    );
    options.startupOpenWorkspacePath.mockRejectedValueOnce(failure);

    render(options);
    await flush();
    await flush();

    expect(options.reportError).toHaveBeenCalledExactlyOnceWith("Settings", failure);
  });

  it("ignores a startup open rejection after unmount", async () => {
    const opening = deferred<WorkspaceOpenOutcome>();
    const options = hydrationOptions(
      Promise.resolve({
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace/recent",
      }),
    );
    options.startupOpenWorkspacePath.mockReturnValueOnce(opening.promise);
    render(options);
    await vi.waitFor(() => expect(options.startupOpenWorkspacePath).toHaveBeenCalledOnce());
    act(() => root.unmount());

    await reject(opening, new Error("late open rejection"));

    expect(options.reportError).not.toHaveBeenCalled();
  });

  function render(options: HydrationTestOptions): void {
    act(() => root.render(<Harness options={options} />));
  }
});

function Harness({ options }: { readonly options: HydrationTestOptions }) {
  const hasRestoredRef = useRef(false);
  useInitialAppSettingsHydration({ ...options, hasRestoredRef });
  return null;
}

function SharedRefHarness({
  hasRestoredRef,
  options,
}: {
  readonly hasRestoredRef: { current: boolean };
  readonly options: HydrationTestOptions;
}) {
  useInitialAppSettingsHydration({ ...options, hasRestoredRef });
  return null;
}

interface HydrationTestOptions extends InitialAppSettingsHydrationOptions {
  readonly startupOpenWorkspacePath: ReturnType<
    typeof vi.fn<(path: string) => Promise<WorkspaceOpenOutcome>>
  >;
  readonly startupRestore: WorkspaceStartupRestoreIntent;
  readonly startupRestoreCurrent: { current: boolean };
}

function hydrationOptions(result: Promise<AppSettings>): HydrationTestOptions {
  const startupRestoreCurrent = { current: true };
  const startupOpenWorkspacePath = vi.fn<(path: string) => Promise<WorkspaceOpenOutcome>>(
    async () => ({ kind: "stale", requestToken: 0 }),
  );
  const startupRestore = {
    generation: 1,
    kind: "workspaceStartupRestoreIntent" as const,
    userIntentGeneration: 0,
    isCurrent: () => startupRestoreCurrent.current,
    openWorkspacePath: startupOpenWorkspacePath,
  };
  return {
    hasRestoredRef: { current: false },
    settingsGateway: { loadAppSettings: vi.fn<() => Promise<AppSettings>>(() => result) },
    applyAppSettings: vi.fn<(settings: AppSettings) => void>(),
    beginStartupRestore: vi.fn(() => startupRestore),
    onAppSettingsHydrated: vi.fn(),
    reportError: vi.fn<(scope: string, error: unknown) => void>(),
    startupOpenWorkspacePath,
    startupRestore,
    startupRestoreCurrent,
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
