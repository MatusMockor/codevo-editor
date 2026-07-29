// @vitest-environment jsdom

import { act, memo, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveDocumentRuntime } from "../application/liveDocumentRuntime";
import type { EditorGroupsState } from "../domain/editorGroups";
import type { EditorDocument } from "../domain/workspace";
import type { EditorGroupSurface } from "./EditorGroupView";
import { WorkbenchEditorHost } from "./WorkbenchEditorHost";
import {
  useStableLatestCallback,
  useWorkbenchEditorHostPresenter,
  workbenchEditorHostProps,
  type WorkbenchEditorHostPresenter,
} from "./workbenchEditorHostPresenter";

vi.mock("./EditorRuntimeHost", () => ({
  EditorRuntimeHost: ({ children }: { children: React.ReactNode }) => children,
}));

describe("workbench editor host presenter", () => {
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

  it("keeps a suppressed surface wired to the latest PHP change-signature port", () => {
    const firstOpen = vi.fn();
    const latestOpen = vi.fn();
    const surfaceCommits = { value: 0 };
    const openCapture = {
      current: null as ((request: { path: string }) => void) | null,
    };
    const Surface = memo(function Surface({ onOpen }: { onOpen(request: { path: string }): void }) {
      surfaceCommits.value += 1;
      openCapture.current = onOpen;
      return <div />;
    });
    const activeRevision = Object.freeze({});
    const document = editorDocument("/active.php");
    const hostActions = {
      onActivateGroup: vi.fn(),
      onCloseDocument: vi.fn(async () => undefined),
      onMoveTab: vi.fn(),
      onPinTab: vi.fn(),
      onSetActivePath: vi.fn(),
    };

    function Harness({
      indexReadiness,
      onOpen,
    }: {
      indexReadiness: number;
      onOpen(request: { path: string }): void;
    }) {
      const stableOpen = useStableLatestCallback(onOpen);
      const renderContent = useMemo(
        () => (surface: EditorGroupSurface) =>
          surface.kind === "document" ? <Surface key={indexReadiness} onOpen={stableOpen} /> : null,
        [indexReadiness, stableOpen],
      );
      return (
        <WorkbenchEditorHost
          {...hostActions}
          activeGroupId={state.activeGroupId}
          attachEditorGroupLiveDocument={() => null}
          contentRevisionForGroup={() => activeRevision}
          documents={[document]}
          documentSessionAuthorityRevision={TEST_DOCUMENT_SESSION_AUTHORITY_REVISION}
          editorSessionOwnerKey={null}
          isEditorGroupDocumentSessionAuthorityCurrent={() => false}
          liveDocumentRuntime={TEST_LIVE_DOCUMENT_RUNTIME}
          projectId="/workspace"
          renderContent={renderContent}
          resolveEditorGroupDocumentSessionAuthority={() => null}
          state={state}
        />
      );
    }

    act(() => {
      root.render(<Harness indexReadiness={1} onOpen={firstOpen} />);
    });
    surfaceCommits.value = 0;
    act(() => {
      root.render(<Harness indexReadiness={2} onOpen={latestOpen} />);
    });

    expect(surfaceCommits.value).toBe(0);
    act(() => {
      openCapture.current?.({ path: "/active.php" });
    });
    expect(firstOpen).not.toHaveBeenCalled();
    expect(latestOpen).toHaveBeenCalledWith({ path: "/active.php" });
  });

  it("keeps document-session authority adapters stable and routes them to the latest workbench", () => {
    const authority = Object.freeze({ marker: "authority" }) as unknown as NonNullable<
      ReturnType<WorkbenchInput["resolveEditorGroupDocumentSessionAuthority"]>
    >;
    const firstResolve = vi.fn(() => null);
    const latestResolve = vi.fn(() => authority);
    const firstValidate = vi.fn(() => false);
    const latestValidate = vi.fn(() => true);
    const firstAttach = vi.fn(() => null);
    const latestAttachment = Object.freeze({
      observe: vi.fn(() => true),
      release: vi.fn(() => true),
    });
    const latestAttach = vi.fn(() => latestAttachment);
    const stableWorkbench = workbench();
    let presenter: WorkbenchEditorHostPresenter | null = null;

    function Harness({
      attach,
      isCurrent,
      resolve,
    }: {
      attach: WorkbenchInput["attachEditorGroupLiveDocument"];
      isCurrent: WorkbenchInput["isEditorGroupDocumentSessionAuthorityCurrent"];
      resolve: WorkbenchInput["resolveEditorGroupDocumentSessionAuthority"];
    }) {
      presenter = useWorkbenchEditorHostPresenter(
        workbench(
          {
            attachEditorGroupLiveDocument: attach,
            isEditorGroupDocumentSessionAuthorityCurrent: isCurrent,
            resolveEditorGroupDocumentSessionAuthority: resolve,
          },
          stableWorkbench,
        ),
      );
      return null;
    }

    act(() => {
      root.render(
        <Harness attach={firstAttach} isCurrent={firstValidate} resolve={firstResolve} />,
      );
    });
    const firstPresenter = requiredPresenter(presenter);
    const stableAttach = firstPresenter.attachEditorGroupLiveDocument;
    const stableResolve = firstPresenter.resolveEditorGroupDocumentSessionAuthority;
    const stableValidate = firstPresenter.isEditorGroupDocumentSessionAuthorityCurrent;

    act(() => {
      root.render(
        <Harness attach={latestAttach} isCurrent={latestValidate} resolve={latestResolve} />,
      );
    });
    const latestPresenter = requiredPresenter(presenter);

    expect(latestPresenter).toBe(firstPresenter);
    expect(latestPresenter.attachEditorGroupLiveDocument).toBe(stableAttach);
    expect(latestPresenter.resolveEditorGroupDocumentSessionAuthority).toBe(stableResolve);
    expect(latestPresenter.isEditorGroupDocumentSessionAuthorityCurrent).toBe(stableValidate);
    expect(stableResolve("active")).toBe(authority);
    expect(stableValidate(authority)).toBe(true);
    const source = {
      captureCurrentContent: () => "saved",
      holderIncarnation: Object.freeze({}),
      modelIncarnation: Object.freeze({}),
    };
    const revision = {
      alternativeVersionId: 1,
      contentVersion: 1,
      mode: "retained" as const,
      modelVersionId: 1,
      utf16Length: 5,
    };
    expect(stableAttach(authority, source, revision)).toBe(latestAttachment);
    expect(firstResolve).not.toHaveBeenCalled();
    expect(firstValidate).not.toHaveBeenCalled();
    expect(firstAttach).not.toHaveBeenCalled();
    expect(latestAttach).toHaveBeenCalledWith(authority, source, revision);
    expect(latestResolve).toHaveBeenCalledWith("active");
    expect(latestValidate).toHaveBeenCalledWith(authority);

    const onActiveLiveDocumentBindingChange = vi.fn();
    const onGroupFocusRunnerChange = vi.fn();
    const props = workbenchEditorHostProps({
      activeGroupId: state.activeGroupId,
      contentRevisionForGroup: () => Object.freeze({}),
      documents: [],
      editorHost: latestPresenter,
      editorSessionOwnerKey: null,
      liveDocumentRuntime: TEST_LIVE_DOCUMENT_RUNTIME,
      onActiveLiveDocumentBindingChange,
      onGroupFocusRunnerChange,
      renderContent: () => null,
      state,
    });

    expect(props.activeGroupId).toBe(state.activeGroupId);
    expect(props.attachEditorGroupLiveDocument).toBe(stableAttach);
    expect(props.documentSessionAuthorityRevision).toBe(TEST_DOCUMENT_SESSION_AUTHORITY_REVISION);
    expect(props.liveDocumentRuntime).toBe(TEST_LIVE_DOCUMENT_RUNTIME);
    expect(props.onActiveLiveDocumentBindingChange).toBe(onActiveLiveDocumentBindingChange);
    expect(props.onGroupFocusRunnerChange).toBe(onGroupFocusRunnerChange);
    expect(props.resolveEditorGroupDocumentSessionAuthority).toBe(stableResolve);
    expect(props.isEditorGroupDocumentSessionAuthorityCurrent).toBe(stableValidate);
  });
});

const TEST_LIVE_DOCUMENT_RUNTIME = new LiveDocumentRuntime();
const TEST_DOCUMENT_SESSION_AUTHORITY_REVISION = Object.freeze({});

const state: EditorGroupsState = {
  activeGroupId: "active",
  groups: {
    active: {
      activePath: "/active.php",
      openPaths: ["/active.php"],
      previewPath: null,
    },
  },
  layout: { groupId: "active", kind: "group" },
};

function editorDocument(path: string): EditorDocument {
  return {
    content: "<?php",
    language: "php",
    name: path.slice(1),
    path,
    savedContent: "<?php",
  };
}

type WorkbenchInput = Parameters<typeof useWorkbenchEditorHostPresenter>[0];

function workbench(overrides: Partial<WorkbenchInput> = {}, base?: WorkbenchInput): WorkbenchInput {
  if (base) {
    return new Proxy(overrides, {
      get(target, property, receiver) {
        return Reflect.has(target, property)
          ? Reflect.get(target, property, receiver)
          : Reflect.get(base, property);
      },
    }) as WorkbenchInput;
  }
  const callable = vi.fn();
  const debugSession = new Proxy(
    {
      breakpoints: [],
      debugHover: null,
      inlineValueContext: null,
    },
    {
      get(target, property, receiver) {
        return Reflect.has(target, property) ? Reflect.get(target, property, receiver) : callable;
      },
    },
  );
  const values = {
    activeEditorConfig: {},
    appSettings: {},
    debugSession,
    documentSessionAuthorityRevision: TEST_DOCUMENT_SESSION_AUTHORITY_REVISION,
    frameworkIntelligenceProviders: null,
    gitDiffDocuments: {},
    languageServerDiagnosticsByPath: {},
    markdownPreviewTabs: {},
    restoredEditorViewStates: {},
    restoredEditorViewStatesByGroup: {},
    workspaceRoot: "/workspace",
    workspaceSettings: {},
    ...overrides,
  };
  return new Proxy(values, {
    get(target, property, receiver) {
      return Reflect.has(target, property) ? Reflect.get(target, property, receiver) : callable;
    },
  }) as unknown as WorkbenchInput;
}

function requiredPresenter(
  presenter: WorkbenchEditorHostPresenter | null,
): WorkbenchEditorHostPresenter {
  if (!presenter) {
    throw new Error("Expected presenter capture");
  }
  return presenter;
}
