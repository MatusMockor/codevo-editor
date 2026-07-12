// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useDiagnostics,
  type Diagnostics,
  type DiagnosticsDependencies,
} from "./useDiagnostics";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import type {
  LanguageServerDiagnostic,
  LanguageServerDiagnosticEvent,
} from "../domain/languageServerDiagnostics";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { DiagnosticsCoalescer } from "../domain/diagnosticsCoalescer";
import type { EditorDocument } from "../domain/workspace";
import type { AppSettings, WorkspaceSettings } from "../domain/settings";
import type { WorkbenchNotice } from "./workbenchNotice";
import { createWorkbenchNotice } from "./workbenchNotice";
import type { Dispatch, SetStateAction } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ROOT = "/workspace";
const OTHER_ROOT = "/other-workspace";
const SESSION = 7;

type MutableRef<T> = { current: T };

function ref<T>(value: T): MutableRef<T> {
  return { current: value };
}

interface StateHolder<T> {
  value: T;
  set: Dispatch<SetStateAction<T>>;
}

function stateHolder<T>(initial: T): StateHolder<T> {
  const holder: StateHolder<T> = {
    value: initial,
    set: (update) => {
      holder.value =
        typeof update === "function"
          ? (update as (prev: T) => T)(holder.value)
          : update;
    },
  };
  return holder;
}

function runningStatus(
  rootPath: string,
  sessionId: number,
): LanguageServerRuntimeStatus {
  return {
    kind: "running",
    rootPath,
    sessionId,
    capabilities: {},
  } as LanguageServerRuntimeStatus;
}

function errorDiagnostic(
  overrides: Partial<LanguageServerDiagnostic> = {},
): LanguageServerDiagnostic {
  return {
    message: "Undefined variable",
    severity: "error",
    source: "phpactor",
    line: 0,
    character: 0,
    ...overrides,
  };
}

function diagnosticEvent(
  overrides: Partial<LanguageServerDiagnosticEvent> = {},
): LanguageServerDiagnosticEvent {
  const path = `${ROOT}/app/User.php`;
  return {
    rootPath: ROOT,
    sessionId: SESSION,
    uri: fileUriFromPath(path),
    version: 1,
    diagnostics: [errorDiagnostic()],
    ...overrides,
  };
}

function fakeCoalescer(): {
  coalescer: DiagnosticsCoalescer;
  dropRoot: ReturnType<typeof vi.fn>;
} {
  const dropRoot = vi.fn();
  return {
    coalescer: { dropRoot } as unknown as DiagnosticsCoalescer,
    dropRoot,
  };
}

interface Harness {
  deps: DiagnosticsDependencies;
  currentRootRef: MutableRef<string | null>;
  activeDocumentRef: MutableRef<EditorDocument | null>;
  documentsRef: MutableRef<Record<string, EditorDocument>>;
  lsByRootRef: MutableRef<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >;
  jstsByRootRef: MutableRef<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >;
  lsStatusByRootRef: MutableRef<Record<string, LanguageServerRuntimeStatus>>;
  jstsStatusByRootRef: MutableRef<Record<string, LanguageServerRuntimeStatus>>;
  lastAppliedRef: MutableRef<Record<string, number>>;
  jstsLastAppliedRef: MutableRef<Record<string, number>>;
  lsCoalescer: ReturnType<typeof fakeCoalescer>;
  jstsCoalescer: ReturnType<typeof fakeCoalescer>;
  languageServerDiagnostics: StateHolder<
    Record<string, LanguageServerDiagnostic[]>
  >;
  javaScriptTypeScriptDiagnostics: StateHolder<
    Record<string, LanguageServerDiagnostic[]>
  >;
  phpLocalDiagnostics: StateHolder<Record<string, LanguageServerDiagnostic[]>>;
  laravelDiagnostics: StateHolder<Record<string, LanguageServerDiagnostic[]>>;
  notices: StateHolder<WorkbenchNotice[]>;
  removedPaths: Set<string>;
  gatewayValidate: ReturnType<typeof vi.fn>;
  reportError: ReturnType<typeof vi.fn>;
  contextualFilterRef: MutableRef<
    (
      path: string,
      diagnostics: LanguageServerDiagnostic[],
    ) => Promise<LanguageServerDiagnostic[]>
  >;
  appSettingsRef: MutableRef<AppSettings>;
  workspaceSettingsRef: MutableRef<WorkspaceSettings>;
}

function createHarness(): Harness {
  const currentRootRef = ref<string | null>(ROOT);
  const activeDocumentRef = ref<EditorDocument | null>(null);
  const documentsRef = ref<Record<string, EditorDocument>>({});
  const lsByRootRef = ref<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >({});
  const jstsByRootRef = ref<
    Record<string, Record<string, LanguageServerDiagnostic[]>>
  >({});
  const lsStatusByRootRef = ref<Record<string, LanguageServerRuntimeStatus>>({
    [ROOT]: runningStatus(ROOT, SESSION),
  });
  const jstsStatusByRootRef = ref<Record<string, LanguageServerRuntimeStatus>>({
    [ROOT]: runningStatus(ROOT, SESSION),
  });
  const lastAppliedRef = ref<Record<string, number>>({});
  const jstsLastAppliedRef = ref<Record<string, number>>({});
  const lsCoalescer = fakeCoalescer();
  const jstsCoalescer = fakeCoalescer();

  const languageServerDiagnostics = stateHolder<
    Record<string, LanguageServerDiagnostic[]>
  >({});
  const javaScriptTypeScriptDiagnostics = stateHolder<
    Record<string, LanguageServerDiagnostic[]>
  >({});
  const phpLocalDiagnostics = stateHolder<
    Record<string, LanguageServerDiagnostic[]>
  >({});
  const laravelDiagnostics = stateHolder<
    Record<string, LanguageServerDiagnostic[]>
  >({});
  const notices = stateHolder<WorkbenchNotice[]>([]);

  const removedPaths = new Set<string>();
  const gatewayValidate = vi.fn(async () => []);
  const reportError = vi.fn();
  const contextualFilterRef = ref<
    (
      path: string,
      diagnostics: LanguageServerDiagnostic[],
    ) => Promise<LanguageServerDiagnostic[]>
  >(async (_path, diagnostics) => diagnostics);

  const appSettingsRef = ref<AppSettings>({
    workspaceTabs: [ROOT],
  } as AppSettings);
  const workspaceSettingsRef = ref<WorkspaceSettings>({
    javaScriptTypeScriptValidation: true,
  } as WorkspaceSettings);

  const deps: DiagnosticsDependencies = {
    currentWorkspaceRootRef: currentRootRef,
    activeDocumentRef,
    documentsRef,
    activeDocument: null,
    appSettingsRef,
    workspaceSettingsRef,
    setLanguageServerDiagnosticsByPath: languageServerDiagnostics.set,
    setJavaScriptTypeScriptDiagnosticsByPath:
      javaScriptTypeScriptDiagnostics.set,
    setPhpLocalDiagnosticsByPath: phpLocalDiagnostics.set,
    setLaravelDiagnosticsByPath: laravelDiagnostics.set,
    setNotices: notices.set,
    languageServerDiagnosticsByRootRef: lsByRootRef,
    javaScriptTypeScriptDiagnosticsByRootRef: jstsByRootRef,
    languageServerDiagnosticsCoalescerRef: ref(lsCoalescer.coalescer),
    javaScriptTypeScriptDiagnosticsCoalescerRef: ref(jstsCoalescer.coalescer),
    lastAppliedDiagnosticVersionByUriRef: lastAppliedRef,
    javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef: jstsLastAppliedRef,
    languageServerRuntimeStatusByRootRef: lsStatusByRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef: jstsStatusByRootRef,
    contextualDiagnosticsFilterRef: contextualFilterRef,
    phpLocalDiagnosticValidationGenerationRef: ref(0),
    phpLocalDiagnosticRetryTimersRef: ref<ReturnType<typeof setTimeout>[]>([]),
    phpLocalSyntaxDiagnosticsGateway: { validate: gatewayValidate },
    isExternallyRemovedDocumentPath: (path: string) => removedPaths.has(path),
    isLanguageServerSessionCurrentForRoot: () => true,
    reportLanguageServerErrorForActiveWorkspaceRoot: reportError,
  };

  return {
    deps,
    currentRootRef,
    activeDocumentRef,
    documentsRef,
    lsByRootRef,
    jstsByRootRef,
    lsStatusByRootRef,
    jstsStatusByRootRef,
    lastAppliedRef,
    jstsLastAppliedRef,
    lsCoalescer,
    jstsCoalescer,
    languageServerDiagnostics,
    javaScriptTypeScriptDiagnostics,
    phpLocalDiagnostics,
    laravelDiagnostics,
    notices,
    removedPaths,
    gatewayValidate,
    reportError,
    contextualFilterRef,
    appSettingsRef,
    workspaceSettingsRef,
  };
}

function renderDiagnostics(deps: DiagnosticsDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: Diagnostics | null } = { api: null };

  function Harness({
    dependencies,
  }: {
    dependencies: DiagnosticsDependencies;
  }) {
    captured.api = useDiagnostics(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  return {
    api: (): Diagnostics => {
      if (!captured.api) {
        throw new Error("hook not mounted");
      }

      return captured.api;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

const USER_PATH = `${ROOT}/app/User.php`;
const USER_URI = fileUriFromPath(USER_PATH);

describe("useDiagnostics - PHP language-server diagnostics", () => {
  it("applies diagnostics to active state, per-root cache, and notices", async () => {
    const harness = createHarness();
    const { api } = renderDiagnostics(harness.deps);

    api().applyLanguageServerDiagnostics(diagnosticEvent());
    await flushMicrotasks();

    expect(harness.languageServerDiagnostics.value[USER_PATH]).toHaveLength(1);
    expect(harness.lsByRootRef.current[ROOT][USER_PATH]).toHaveLength(1);
    expect(
      harness.notices.value.some(
        (notice) =>
          notice.groupKey === `language-server-diagnostics:${USER_URI}`,
      ),
    ).toBe(true);
  });

  it("ignores diagnostics from a stale session", async () => {
    const harness = createHarness();
    const { api } = renderDiagnostics(harness.deps);

    api().applyLanguageServerDiagnostics(
      diagnosticEvent({ sessionId: SESSION + 1 }),
    );
    await flushMicrotasks();

    expect(harness.languageServerDiagnostics.value).toEqual({});
    expect(harness.lsByRootRef.current).toEqual({});
    expect(harness.notices.value).toHaveLength(0);
  });

  it("drops diagnostics for a root that is neither active nor an open tab", async () => {
    const harness = createHarness();
    harness.currentRootRef.current = OTHER_ROOT;
    harness.appSettingsRef.current = { workspaceTabs: [OTHER_ROOT] } as AppSettings;
    const { api } = renderDiagnostics(harness.deps);

    api().applyLanguageServerDiagnostics(diagnosticEvent());
    await flushMicrotasks();

    expect(harness.lsByRootRef.current).toEqual({});
    expect(harness.notices.value).toHaveLength(0);
  });

  it("clears diagnostics for an externally removed path instead of applying", async () => {
    const harness = createHarness();
    harness.removedPaths.add(USER_PATH);
    harness.lsByRootRef.current = { [ROOT]: { [USER_PATH]: [errorDiagnostic()] } };
    const { api } = renderDiagnostics(harness.deps);

    api().applyLanguageServerDiagnostics(diagnosticEvent());
    await flushMicrotasks();

    expect(harness.lsByRootRef.current[ROOT]).toBeUndefined();
  });
});

describe("useDiagnostics - JavaScript/TypeScript diagnostics", () => {
  it("applies TypeScript diagnostics to state and notices", async () => {
    const harness = createHarness();
    const { api } = renderDiagnostics(harness.deps);
    const tsPath = `${ROOT}/src/index.ts`;
    const tsUri = fileUriFromPath(tsPath);

    api().applyJavaScriptTypeScriptLanguageServerDiagnostics(
      diagnosticEvent({ uri: tsUri, diagnostics: [errorDiagnostic()] }),
    );
    await flushMicrotasks();

    expect(harness.javaScriptTypeScriptDiagnostics.value[tsPath]).toHaveLength(1);
    expect(harness.jstsByRootRef.current[ROOT][tsPath]).toHaveLength(1);
    expect(
      harness.notices.value.some(
        (notice) =>
          notice.groupKey === `javascript-typescript-diagnostics:${tsUri}`,
      ),
    ).toBe(true);
  });

  it("suppresses TypeScript diagnostics when validation is disabled", async () => {
    const harness = createHarness();
    harness.workspaceSettingsRef.current = {
      javaScriptTypeScriptValidation: false,
    } as WorkspaceSettings;
    const { api } = renderDiagnostics(harness.deps);
    const tsPath = `${ROOT}/src/index.ts`;

    api().applyJavaScriptTypeScriptLanguageServerDiagnostics(
      diagnosticEvent({ uri: fileUriFromPath(tsPath) }),
    );
    await flushMicrotasks();

    expect(harness.javaScriptTypeScriptDiagnostics.value[tsPath]).toBeUndefined();
    expect(harness.notices.value).toHaveLength(0);
  });
});

describe("useDiagnostics - local PHP diagnostics", () => {
  it("adds then removes local PHP diagnostics and their notices", () => {
    const harness = createHarness();
    const { api } = renderDiagnostics(harness.deps);

    api().updateLocalPhpDiagnostics(USER_PATH, [errorDiagnostic()]);

    expect(harness.phpLocalDiagnostics.value[USER_PATH]).toHaveLength(1);
    expect(
      harness.notices.value.some(
        (notice) =>
          notice.groupKey === `php-local-diagnostics:${USER_URI}`,
      ),
    ).toBe(true);

    api().updateLocalPhpDiagnostics(USER_PATH, []);

    expect(harness.phpLocalDiagnostics.value[USER_PATH]).toBeUndefined();
    expect(
      harness.notices.value.some(
        (notice) =>
          notice.groupKey === `php-local-diagnostics:${USER_URI}`,
      ),
    ).toBe(false);
  });
});

describe("useDiagnostics - per-root clear / restore isolation", () => {
  it("clears the active root: drops cache, notifies the coalescer, clears state", () => {
    const harness = createHarness();
    harness.lsByRootRef.current = { [ROOT]: { [USER_PATH]: [errorDiagnostic()] } };
    harness.languageServerDiagnostics.value = {
      [USER_PATH]: [errorDiagnostic()],
    };
    const { api } = renderDiagnostics(harness.deps);

    api().clearLanguageServerDiagnosticsForRoot(ROOT);

    expect(harness.lsByRootRef.current[ROOT]).toBeUndefined();
    expect(harness.lsCoalescer.dropRoot).toHaveBeenCalledWith(ROOT);
    expect(harness.languageServerDiagnostics.value).toEqual({});
  });

  it("keeps active state untouched when clearing a background root", () => {
    const harness = createHarness();
    harness.lsByRootRef.current = {
      [ROOT]: { [USER_PATH]: [errorDiagnostic()] },
      [OTHER_ROOT]: { [`${OTHER_ROOT}/a.php`]: [errorDiagnostic()] },
    };
    harness.languageServerDiagnostics.value = {
      [USER_PATH]: [errorDiagnostic()],
    };
    const { api } = renderDiagnostics(harness.deps);

    api().clearLanguageServerDiagnosticsForRoot(OTHER_ROOT);

    expect(harness.lsByRootRef.current[OTHER_ROOT]).toBeUndefined();
    expect(harness.lsCoalescer.dropRoot).toHaveBeenCalledWith(OTHER_ROOT);
    // Active root's diagnostics stay visible.
    expect(harness.languageServerDiagnostics.value[USER_PATH]).toHaveLength(1);
  });

  it("restores cached diagnostics for the active root", () => {
    const harness = createHarness();
    harness.lsByRootRef.current = { [ROOT]: { [USER_PATH]: [errorDiagnostic()] } };
    const { api } = renderDiagnostics(harness.deps);

    api().restoreLanguageServerDiagnosticsForRoot(ROOT);

    expect(harness.languageServerDiagnostics.value[USER_PATH]).toHaveLength(1);
  });
});

describe("useDiagnostics - PHPStan notice groups", () => {
  it("replaces a root group on every analysis run", () => {
    const harness = createHarness();
    const { api } = renderDiagnostics(harness.deps);
    const first = createWorkbenchNotice(
      "error",
      "PHPStan",
      "first",
      `phpstan:${ROOT}`,
    );
    const second = createWorkbenchNotice(
      "error",
      "PHPStan",
      "second",
      `phpstan:${ROOT}`,
    );

    api().replacePhpstanDiagnostics(ROOT, [first]);
    api().replacePhpstanDiagnostics(ROOT, [second]);

    expect(
      harness.notices.value.filter(
        (notice) => notice.groupKey === `phpstan:${ROOT}`,
      ),
    ).toEqual([second]);
  });

  it("caps workspace-wide PHPStan notices with truthful overflow copy", () => {
    const harness = createHarness();
    const { api } = renderDiagnostics(harness.deps);
    const notices = Array.from({ length: 507 }, (_, index) =>
      createWorkbenchNotice(
        "error",
        "PHPStan",
        `problem ${index + 1}`,
        `phpstan:${ROOT}`,
      ),
    );

    api().replacePhpstanDiagnostics(ROOT, notices);

    const phpstanNotices = harness.notices.value.filter(
      (notice) => notice.groupKey === `phpstan:${ROOT}`,
    );
    expect(phpstanNotices).toHaveLength(501);
    expect(phpstanNotices[phpstanNotices.length - 1]).toMatchObject({
      kind: "overflow",
      message:
        "Showing 500 of 507 PHPStan problems — narrow the analysis or fix reported issues.",
    });
  });

  it("clears only the requested root group", () => {
    const harness = createHarness();
    harness.notices.value = [
      createWorkbenchNotice("error", "PHPStan", "A", `phpstan:${ROOT}`),
      createWorkbenchNotice(
        "error",
        "PHPStan",
        "B",
        `phpstan:${OTHER_ROOT}`,
      ),
    ];
    const { api } = renderDiagnostics(harness.deps);

    api().clearPhpstanDiagnosticsForRoot(ROOT);

    expect(harness.notices.value.map((notice) => notice.groupKey)).toEqual([
      `phpstan:${OTHER_ROOT}`,
    ]);
  });

  it("does not let root B replacement overwrite root A", () => {
    const harness = createHarness();
    const { api } = renderDiagnostics(harness.deps);

    api().replacePhpstanDiagnostics(ROOT, [
      createWorkbenchNotice("error", "PHPStan", "A", `phpstan:${ROOT}`),
    ]);
    api().replacePhpstanDiagnostics(OTHER_ROOT, [
      createWorkbenchNotice(
        "error",
        "PHPStan",
        "B",
        `phpstan:${OTHER_ROOT}`,
      ),
    ]);

    expect(harness.notices.value.map((notice) => notice.message)).toEqual([
      "B",
      "A",
    ]);
  });
});

describe("useDiagnostics - ESLint notice groups", () => {
  it("replaces, caps, and clears a root group", () => {
    const harness = createHarness();
    const { api } = renderDiagnostics(harness.deps);
    const notices = Array.from({ length: 507 }, (_, index) =>
      createWorkbenchNotice(
        "warning",
        "ESLint",
        `problem ${index + 1}`,
        `eslint:${ROOT}`,
      ),
    );

    api().replaceEslintDiagnostics(ROOT, notices);

    const eslintNotices = harness.notices.value.filter(
      (notice) => notice.groupKey === `eslint:${ROOT}`,
    );
    expect(eslintNotices).toHaveLength(501);
    expect(eslintNotices[eslintNotices.length - 1]).toMatchObject({
      kind: "overflow",
      message:
        "Showing 500 of 507 ESLint problems — narrow the analysis or fix reported issues.",
    });

    api().clearEslintDiagnosticsForRoot(ROOT);
    expect(
      harness.notices.value.some(
        (notice) => notice.groupKey === `eslint:${ROOT}`,
      ),
    ).toBe(false);
  });
});

describe("useDiagnostics - delete / rename path cleanup", () => {
  it("removes a path from php, jsts, laravel, and local caches plus notices", () => {
    const harness = createHarness();
    harness.lsByRootRef.current = { [ROOT]: { [USER_PATH]: [errorDiagnostic()] } };
    harness.jstsByRootRef.current = {
      [ROOT]: { [USER_PATH]: [errorDiagnostic()] },
    };
    harness.languageServerDiagnostics.value = {
      [USER_PATH]: [errorDiagnostic()],
    };
    harness.javaScriptTypeScriptDiagnostics.value = {
      [USER_PATH]: [errorDiagnostic()],
    };
    harness.laravelDiagnostics.value = { [USER_PATH]: [errorDiagnostic()] };
    harness.phpLocalDiagnostics.value = { [USER_PATH]: [errorDiagnostic()] };
    const { api } = renderDiagnostics(harness.deps);

    api().clearLanguageServerDiagnosticsForPath(ROOT, USER_PATH);

    expect(harness.lsByRootRef.current[ROOT]).toBeUndefined();
    expect(harness.jstsByRootRef.current[ROOT]).toBeUndefined();
    expect(harness.languageServerDiagnostics.value[USER_PATH]).toBeUndefined();
    expect(
      harness.javaScriptTypeScriptDiagnostics.value[USER_PATH],
    ).toBeUndefined();
    expect(harness.laravelDiagnostics.value[USER_PATH]).toBeUndefined();
    expect(harness.phpLocalDiagnostics.value[USER_PATH]).toBeUndefined();
  });
});

describe("useDiagnostics - stale-version gating", () => {
  it("ignores an older diagnostic version once a newer one was applied", async () => {
    const harness = createHarness();
    const { api } = renderDiagnostics(harness.deps);

    api().applyLanguageServerDiagnostics(diagnosticEvent({ version: 5 }));
    await flushMicrotasks();
    const appliedCount = harness.notices.value.length;

    api().applyLanguageServerDiagnostics(
      diagnosticEvent({ version: 2, diagnostics: [] }),
    );
    await flushMicrotasks();

    // The stale (older-version) empty publish must not clear the applied notice.
    expect(harness.notices.value.length).toBe(appliedCount);
    expect(harness.lsByRootRef.current[ROOT][USER_PATH]).toHaveLength(1);
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
