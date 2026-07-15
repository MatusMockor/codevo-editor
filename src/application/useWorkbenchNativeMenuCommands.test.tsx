// @vitest-environment jsdom

import { act, startTransition, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CommandContext,
  CommandExecutionRunner,
} from "./commandRegistry";
import { NATIVE_MENU_EVENT_NAMES } from "./workbenchNativeMenuCommandDispatcher";
import { useWorkbenchNativeMenuCommands } from "./useWorkbenchNativeMenuCommands";

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: tauriMocks.isTauri,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriMocks.listen,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const initialContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: false,
};

afterEach(() => {
  tauriMocks.isTauri.mockReset();
  tauriMocks.isTauri.mockReturnValue(true);
  tauriMocks.listen.mockReset();
  document.body.innerHTML = "";
});

describe("useWorkbenchNativeMenuCommands", () => {
  it("registers and disposes all native menu event listeners", async () => {
    const disposers = new Map<string, ReturnType<typeof vi.fn>>();
    tauriMocks.listen.mockImplementation(async (eventName: string) => {
      const dispose = vi.fn();
      disposers.set(eventName, dispose);
      return dispose;
    });
    const harness = renderHook();

    await flushAsyncTurns();

    expect(tauriMocks.listen.mock.calls.map(([eventName]) => eventName)).toEqual(
      NATIVE_MENU_EVENT_NAMES,
    );

    harness.unmount();

    disposers.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it("dispatches with the latest runner and command context without re-registering", async () => {
    const listeners = new Map<string, () => void>();
    tauriMocks.listen.mockImplementation(
      async (eventName: string, listener: () => void) => {
        listeners.set(eventName, listener);
        return vi.fn();
      },
    );
    const initialRunner = commandRunner();
    const latestRunner = commandRunner();
    const latestContext: CommandContext = {
      activeDocumentDirty: true,
      hasActiveDocument: true,
      hasWorkspace: true,
    };
    const harness = renderHook({ runCommand: initialRunner });
    await flushAsyncTurns();

    harness.rerender({
      commandContext: latestContext,
      runCommand: latestRunner,
    });
    act(() => listeners.get("mockor-close-active-tab")?.());

    expect(tauriMocks.listen).toHaveBeenCalledTimes(
      NATIVE_MENU_EVENT_NAMES.length,
    );
    expect(initialRunner).not.toHaveBeenCalled();
    expect(latestRunner).toHaveBeenCalledWith("editor.closeTab", latestContext);
    harness.unmount();
  });

  it("keeps dispatching through the latest committed runner during a suspended render", async () => {
    const listeners = new Map<string, () => void>();
    tauriMocks.listen.mockImplementation(
      async (eventName: string, listener: () => void) => {
        listeners.set(eventName, listener);
        return vi.fn();
      },
    );
    const committedRunner = commandRunner();
    const suspendedRunner = commandRunner();
    const suspendedContext: CommandContext = {
      activeDocumentDirty: true,
      hasActiveDocument: true,
      hasWorkspace: true,
    };
    const harness = renderHook({ runCommand: committedRunner });
    await flushAsyncTurns();

    harness.renderSuspended({
      commandContext: suspendedContext,
      runCommand: suspendedRunner,
    });
    act(() => listeners.get("mockor-close-active-tab")?.());

    expect(committedRunner).toHaveBeenCalledWith(
      "editor.closeTab",
      initialContext,
    );
    expect(suspendedRunner).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("ignores retained native callbacks after unmount", async () => {
    let retainedListener: (() => void) | undefined;
    tauriMocks.listen.mockImplementation(
      async (eventName: string, listener: () => void) => {
        if (eventName === "mockor-close-active-tab") {
          retainedListener = listener;
        }

        return vi.fn();
      },
    );
    const runCommand = commandRunner();
    const harness = renderHook({ runCommand });
    await flushAsyncTurns();

    harness.unmount();
    act(() => retainedListener?.());

    expect(runCommand).not.toHaveBeenCalled();
  });

  it("reports listener registration errors as Shortcuts", async () => {
    const error = new Error("registration failed");
    const reportError = vi.fn();
    tauriMocks.listen.mockRejectedValue(error);
    const harness = renderHook({ reportError });

    await flushAsyncTurns();

    expect(reportError).toHaveBeenCalledTimes(NATIVE_MENU_EVENT_NAMES.length);
    expect(reportError).toHaveBeenCalledWith("Shortcuts", error);
    harness.unmount();
  });

  it("disposes listeners that finish registering after unmount", async () => {
    const registrations = NATIVE_MENU_EVENT_NAMES.map(() =>
      createDeferred<() => void>(),
    );
    tauriMocks.listen.mockImplementation(
      () => registrations[tauriMocks.listen.mock.calls.length - 1]!.promise,
    );
    const disposers = registrations.map(() => vi.fn());
    const harness = renderHook();

    harness.unmount();
    registrations.forEach((registration, index) => {
      registration.resolve(disposers[index]!);
    });
    await flushAsyncTurns();

    disposers.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it("does not register listeners outside Tauri", () => {
    tauriMocks.isTauri.mockReturnValue(false);
    const harness = renderHook();

    expect(tauriMocks.listen).not.toHaveBeenCalled();
    harness.unmount();
  });
});

interface HookOptions {
  commandContext?: CommandContext;
  reportError?: (source: string, error: unknown) => void;
  runCommand?: CommandExecutionRunner;
  suspend?: boolean;
}

function renderHook(options: HookOptions = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let currentOptions = options;
  const defaultReportError = vi.fn();
  const defaultRunner = commandRunner();
  const suspendedRender = new Promise<void>(() => {});

  function HookHarness() {
    useWorkbenchNativeMenuCommands({
      commandContext: currentOptions.commandContext ?? initialContext,
      reportError: currentOptions.reportError ?? defaultReportError,
      runCommand: currentOptions.runCommand ?? defaultRunner,
    });

    if (currentOptions.suspend) {
      throw suspendedRender;
    }

    return null;
  }

  act(() =>
    root.render(
      <Suspense fallback={null}>
        <HookHarness />
      </Suspense>,
    ),
  );

  return {
    rerender(nextOptions: HookOptions) {
      currentOptions = nextOptions;
      act(() =>
        root.render(
          <Suspense fallback={null}>
            <HookHarness />
          </Suspense>,
        ),
      );
    },
    renderSuspended(nextOptions: HookOptions) {
      currentOptions = { ...nextOptions, suspend: true };
      act(() => {
        startTransition(() => {
          root.render(
            <Suspense fallback={null}>
              <HookHarness />
            </Suspense>,
          );
        });
      });
    },
    unmount: () => act(() => root.unmount()),
  };
}

function commandRunner() {
  return vi.fn<CommandExecutionRunner>(() => "executed");
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushAsyncTurns(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
