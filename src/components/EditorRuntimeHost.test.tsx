// @vitest-environment jsdom

import { act, StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { URI } from "monaco-editor/esm/vs/base/common/uri.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { EditorDocument } from "../domain/workspace";
import type { EditorGroupFocusRunner } from "../application/editorGroupFocusPort";
import { LiveDocumentRuntime } from "../application/liveDocumentRuntime";
import { DocumentSessionStore } from "../application/documentSessionStore";
import { createRegisteredDocumentSaveIdentity } from "../application/documentSaveIdentity";
import {
  EditorSessionDocumentAuthoritySidecar,
  type EditorGroupLiveDocumentSource,
} from "../application/editorSessionDocumentAuthority";
import type { EditorGroupDocumentSessionAuthority } from "../application/useEditorSessionState";
import type { EditorJavaScriptTypeScriptIncrementalSyncPort } from "../application/javaScriptTypeScriptIncrementalSyncProduction";
import { editorJavaScriptTypeScriptIncrementalSyncFacade } from "../application/editorJavaScriptTypeScriptIncrementalSyncFacade";
import { AUTHORITATIVE_EDITOR_LIVE_EDIT } from "../application/editorLiveEditArbitration";
import {
  captureEditorActiveLiveDocumentForSave,
  releaseEditorActiveLiveDocumentContent,
} from "../application/editorActiveLiveDocumentBinding";
import { createLegacyEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import { workspaceModelUri } from "./phpMonacoDocumentContext";
import {
  EditorRuntimeHost,
  type EditorRuntimeSurfaceRegistration,
  type EditorRuntimeSurfaceRouting,
} from "./EditorRuntimeHost";
import { useEditorRuntimeContext } from "./editorRuntimeContext";
import { EditorLiveDocumentBindingCoordinator } from "./editorLiveDocumentBindingCoordinator";
import type { EditorSurfaceLanguageProviderRegistrationRefs } from "./editorSurfaceLanguageProviderOptions";

const runtimeMocks = vi.hoisted(() => ({
  debugHoverContext: null as {
    getAdmittedWorkspaceRoot(): string | null;
    resolveDocumentForModel(model: Monaco.editor.ITextModel): EditorDocument | null;
  } | null,
  debugHoverDispose: vi.fn(),
  javaScriptContext: null as {
    getActiveDocument(): EditorDocument | null;
    getActiveJavaScriptTypeScriptOwnerEpoch(): number;
    getActiveJavaScriptTypeScriptOwnerIdentity(): object | null;
  } | null,
  providerContext: null as {
    getActiveDocument(): EditorDocument | null;
    getDocumentForModel?(model: Monaco.editor.ITextModel): EditorDocument | null;
  } | null,
  registerComposer: vi.fn(() => ({ dispose: vi.fn() })),
  registerLanguage: vi.fn((_monaco, context) => {
    runtimeMocks.providerContext = context;
    return { dispose: vi.fn() };
  }),
  registerNpm: vi.fn(() => ({ dispose: vi.fn() })),
  registerJavaScriptTypeScript: vi.fn((_monaco, context) => {
    runtimeMocks.javaScriptContext = context;
    return { dispose: vi.fn() };
  }),
  registerDebugHover: vi.fn((_monaco, context) => {
    runtimeMocks.debugHoverContext = context;
    return { dispose: runtimeMocks.debugHoverDispose };
  }),
  configureTypescriptJavascriptDefaultsOnce: vi.fn(),
}));

vi.mock("./languageServerMonacoProviders", async (importOriginal) => ({
  ...(await importOriginal()),
  registerLanguageServerMonacoProviders: runtimeMocks.registerLanguage,
}));
vi.mock("./composerManifestMonacoProviders", async (importOriginal) => ({
  ...(await importOriginal()),
  registerComposerManifestMonacoProviders: runtimeMocks.registerComposer,
}));
vi.mock("./npmManifestMonacoProviders", async (importOriginal) => ({
  ...(await importOriginal()),
  registerNpmManifestMonacoProviders: runtimeMocks.registerNpm,
}));
vi.mock("./javascriptTypescriptLanguageServerMonacoProviders", async (importOriginal) => ({
  ...(await importOriginal()),
  registerJavaScriptTypeScriptLanguageServerMonacoProviders:
    runtimeMocks.registerJavaScriptTypeScript,
}));
vi.mock("./typescriptJavascriptDefaults", async (importOriginal) => ({
  ...(await importOriginal()),
  configureTypescriptJavascriptDefaultsOnce: runtimeMocks.configureTypescriptJavascriptDefaultsOnce,
}));
vi.mock("./debugHoverMonacoProvider", async (importOriginal) => ({
  ...(await importOriginal()),
  registerDebugHoverMonacoProviders: runtimeMocks.registerDebugHover,
}));

describe("EditorRuntimeHost", () => {
  let container: HTMLDivElement;
  let root: Root;

  it("keeps live binding work off child renders and suppresses legacy reads after exact checkpoints", async () => {
    const fixture = runtimeFixture("/workspace", undefined, undefined, "/workspace/shared.php");
    const authority = liveSessionAuthority("left", fixture.path);
    const runtime = new LiveDocumentRuntime();
    const onBindingChange = vi.fn();
    const deliveryOrder: string[] = [];
    const onChange = vi.fn(() => {
      deliveryOrder.push("legacy");
      return true;
    });
    const observe = vi.fn(() => {
      deliveryOrder.push("checkpoint");
      return true;
    });
    const release = vi.fn(() => true);
    const capturedContent: string[] = [];
    const attachEditorGroupLiveDocument = vi.fn((_authority, source) => {
      const content = source.captureCurrentContent();
      if (content !== null) capturedContent.push(content);
      return { observe, release };
    });
    const reconcile = vi.spyOn(EditorLiveDocumentBindingCoordinator.prototype, "reconcile");
    const stableHostProps = {
      activeGroupId: "left",
      attachEditorGroupLiveDocument,
      isEditorGroupDocumentSessionAuthorityCurrent: (
        candidate: EditorGroupDocumentSessionAuthority,
      ) => candidate === authority,
      liveDocumentRuntime: runtime,
      onActiveLiveDocumentBindingChange: onBindingChange,
      resolveEditorGroupDocumentSessionAuthority: () => authority,
    };

    const render = (churn: number) => (
      <EditorRuntimeHost {...stableHostProps}>
        <RuntimeSurface
          {...fixture}
          groupId="left"
          name="shared.php"
          onModelContentChange={onChange}
        />
        <span data-churn={churn} />
      </EditorRuntimeHost>
    );
    const readsBeforeMount = vi.mocked(fixture.model.getValue).mock.calls.length;
    await act(async () => root.render(render(0)));

    expect(onBindingChange).toHaveBeenCalledTimes(1);
    expect(onBindingChange.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ groupId: "left", path: fixture.path }),
    );
    expect(attachEditorGroupLiveDocument).toHaveBeenCalledOnce();
    expect(capturedContent).toEqual(["<?php"]);
    expect(fixture.model.getValue).toHaveBeenCalledTimes(readsBeforeMount + 1);
    const reconcileCount = reconcile.mock.calls.length;
    const readsBeforeChurn = vi.mocked(fixture.model.getValue).mock.calls.length;

    for (let index = 1; index <= 100; index += 1) {
      await act(async () => root.render(render(index)));
    }

    expect(reconcile).toHaveBeenCalledTimes(reconcileCount);
    expect(onBindingChange).toHaveBeenCalledTimes(1);
    expect(fixture.model.getValue).toHaveBeenCalledTimes(readsBeforeChurn);

    for (let index = 0; index < 100; index += 1) {
      fixture.leftEditor.emitModelContentChange();
    }

    expect(onChange).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledTimes(100);
    expect(deliveryOrder).toEqual(Array.from({ length: 100 }, () => "checkpoint"));
    expect(fixture.model.getValue).toHaveBeenCalledTimes(readsBeforeChurn);
    expect(attachEditorGroupLiveDocument).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledTimes(reconcileCount);
    expect(onBindingChange).toHaveBeenCalledTimes(1);
  });

  it("wires the existing runtime into the opaque active-binding content facade", async () => {
    const fixture = runtimeFixture("/workspace", undefined, undefined, "/workspace/shared.ts");
    const authority = liveSessionAuthority("left", fixture.path);
    const published = vi.fn();

    await act(async () =>
      root.render(
        <EditorRuntimeHost
          activeGroupId="left"
          isEditorGroupDocumentSessionAuthorityCurrent={(candidate) => candidate === authority}
          liveDocumentRuntime={new LiveDocumentRuntime()}
          onActiveLiveDocumentBindingChange={published}
          resolveEditorGroupDocumentSessionAuthority={() => authority}
        >
          <RuntimeSurface {...fixture} groupId="left" name="shared.ts" />
        </EditorRuntimeHost>,
      ),
    );
    fixture.leftEditor.emitModelContentChange();
    const binding = published.mock.calls[published.mock.calls.length - 1]?.[0];
    const captured = captureEditorActiveLiveDocumentForSave(binding);

    expect(captured.status).toBe("captured");
    if (captured.status === "captured") {
      expect(captured.capture).toMatchObject({ content: "<?php", purpose: "save" });
      expect(releaseEditorActiveLiveDocumentContent(binding, captured.capture)).toBe(true);
    }
  });

  it("cuts exact compact revisions over to authoritative incremental ownership", async () => {
    const fixture = runtimeFixture("/workspace", undefined, undefined, "/workspace/shared.ts");
    const authority = liveSessionAuthority("left", fixture.path);
    const order: string[] = [];
    const incrementalAttachment = Object.freeze({
      kind: "editor-javascript-typescript-incremental-sync-attachment" as const,
      semanticMode: "incremental" as const,
    });
    const incremental: EditorJavaScriptTypeScriptIncrementalSyncPort = {
      attach: vi.fn((_authority, source, isCurrent) => {
        expect(isCurrent()).toBe(true);
        expect(source.captureCurrentContent()).toBe("<?php");
        return incrementalAttachment;
      }),
      observe: vi.fn((_attachment, event) => {
        order.push(`incremental:${event.versionId}`);
        return AUTHORITATIVE_EDITOR_LIVE_EDIT;
      }),
      reconciliationIdentity: () => incrementalAttachment,
      release: vi.fn(async () => undefined),
    };

    await act(async () =>
      root.render(
        <EditorRuntimeHost
          activeGroupId="left"
          attachEditorGroupLiveDocument={() => ({
            observe: () => true,
            release: () => true,
          })}
          isEditorGroupDocumentSessionAuthorityCurrent={(candidate) => candidate === authority}
          javaScriptTypeScriptIncrementalSync={editorJavaScriptTypeScriptIncrementalSyncFacade(
            incremental,
          )}
          liveDocumentRuntime={new LiveDocumentRuntime()}
          resolveEditorGroupDocumentSessionAuthority={() => authority}
        >
          <RuntimeSurface
            {...fixture}
            groupId="left"
            name="shared.ts"
            onModelContentChange={() => {
              order.push("legacy");
              return true;
            }}
          />
        </EditorRuntimeHost>,
      ),
    );
    fixture.leftEditor.emitModelContentChange();

    expect(incremental.attach).toHaveBeenCalledOnce();
    expect(incremental.observe).toHaveBeenCalledOnce();
    expect(order).toEqual(["incremental:2"]);
  });

  it("reattaches the same model when the opaque JS/TS runtime revision changes", async () => {
    const fixture = runtimeFixture("/workspace", undefined, undefined, "/workspace/shared.ts");
    const authority = liveSessionAuthority("left", fixture.path);
    const runtime = new LiveDocumentRuntime();
    let runtimeRevision = Object.freeze({});
    let languageId = "typescript";
    Object.assign(fixture.model, { getLanguageId: () => languageId });
    const incremental: EditorJavaScriptTypeScriptIncrementalSyncPort = {
      attach: vi.fn(() =>
        Object.freeze({
          kind: "editor-javascript-typescript-incremental-sync-attachment" as const,
          semanticMode: "incremental" as const,
        }),
      ),
      observe: vi.fn(),
      reconciliationIdentity: () => runtimeRevision,
      release: vi.fn(async () => undefined),
    };
    const render = () => (
      <EditorRuntimeHost
        activeGroupId="left"
        attachEditorGroupLiveDocument={() => ({
          observe: () => true,
          release: () => true,
        })}
        isEditorGroupDocumentSessionAuthorityCurrent={(candidate) => candidate === authority}
        javaScriptTypeScriptIncrementalSync={editorJavaScriptTypeScriptIncrementalSyncFacade(
          incremental,
        )}
        liveDocumentRuntime={runtime}
        resolveEditorGroupDocumentSessionAuthority={() => authority}
      >
        <RuntimeSurface {...fixture} groupId="left" name="shared.ts" />
      </EditorRuntimeHost>
    );

    await act(async () => root.render(render()));
    runtimeRevision = Object.freeze({});
    await act(async () => root.render(render()));

    expect(incremental.release).toHaveBeenCalledOnce();
    expect(incremental.attach).toHaveBeenCalledTimes(2);

    languageId = "plaintext";
    await act(async () => root.render(render()));
    expect(incremental.release).toHaveBeenCalledTimes(2);
    expect(incremental.attach).toHaveBeenCalledTimes(3);
  });

  it("joins one, two, or four exact panes without rotating peers and preserves the active observer", async () => {
    const fixture = runtimeFixture("/workspace", undefined, undefined, "/workspace/shared.ts");
    const firstAuthority = liveSessionAuthority("left", fixture.path);
    const runtime = new LiveDocumentRuntime();
    const authorities = new Map<string, EditorGroupDocumentSessionAuthority>();
    const attachments: {
      observe: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
      source: {
        holderIncarnation: object;
        modelIncarnation: object;
      };
    }[] = [];
    const attachEditorGroupLiveDocument = vi.fn((_authority, source) => {
      const attachment = {
        observe: vi.fn(() => true),
        release: vi.fn(() => true),
        source,
      };
      attachments.push(attachment);
      return attachment;
    });
    const render = (count: 1 | 2 | 4) => {
      const groupIds = [
        "left",
        ...Array.from({ length: count - 1 }, (_, index) => `peer-${index}`),
      ];
      for (const groupId of groupIds) {
        if (!authorities.has(groupId)) {
          authorities.set(groupId, peerSessionAuthority(firstAuthority, groupId));
        }
      }
      return (
        <EditorRuntimeHost
          activeGroupId="left"
          attachEditorGroupLiveDocument={attachEditorGroupLiveDocument}
          isEditorGroupDocumentSessionAuthorityCurrent={(candidate) =>
            authorities.get(candidate.groupId) === candidate
          }
          liveDocumentRuntime={runtime}
          resolveEditorGroupDocumentSessionAuthority={(groupId) => authorities.get(groupId) ?? null}
        >
          {groupIds.map((groupId) => (
            <RuntimeSurface {...fixture} groupId={groupId} key={groupId} name={`${groupId}.ts`} />
          ))}
        </EditorRuntimeHost>
      );
    };

    await act(async () => root.render(render(1)));
    await act(async () => root.render(render(2)));
    await act(async () => root.render(render(4)));

    expect(attachEditorGroupLiveDocument).toHaveBeenCalledTimes(4);
    expect(new Set(attachments.map(({ source }) => source.modelIncarnation)).size).toBe(1);
    expect(new Set(attachments.map(({ source }) => source.holderIncarnation)).size).toBe(4);

    fixture.leftEditor.emitModelContentChange();
    expect(attachments.reduce((count, { observe }) => count + observe.mock.calls.length, 0)).toBe(
      1,
    );
    expect(attachments[0]?.observe).toHaveBeenCalledOnce();

    await act(async () => root.render(render(1)));
    expect(attachments[0]?.release).not.toHaveBeenCalled();
    for (const attachment of attachments.slice(1)) {
      expect(attachment.release).toHaveBeenCalledOnce();
    }

    fixture.leftEditor.emitModelContentChange();
    expect(attachments[0]?.observe).toHaveBeenCalledTimes(2);
  });

  it("rejects a lifecycle content probe when the exact Monaco model changes during the read", async () => {
    const path = "/workspace/shared.ts";
    const firstModel = runtimeModel("/workspace", path);
    const secondModel = runtimeModel("/workspace", path);
    const fixture = runtimeFixture(
      "/workspace",
      runtimeMonaco([firstModel, secondModel]),
      firstModel,
      path,
    );
    const authority = liveSessionAuthority("left", path);
    const sources: EditorGroupLiveDocumentSource[] = [];

    await act(async () =>
      root.render(
        <EditorRuntimeHost
          activeGroupId="left"
          attachEditorGroupLiveDocument={(_authority, candidate) => {
            sources.push(candidate);
            return {
              observe: () => true,
              release: () => true,
            };
          }}
          isEditorGroupDocumentSessionAuthorityCurrent={(candidate) => candidate === authority}
          liveDocumentRuntime={new LiveDocumentRuntime()}
          resolveEditorGroupDocumentSessionAuthority={() => authority}
        >
          <RuntimeSurface {...fixture} groupId="left" name="shared.ts" />
        </EditorRuntimeHost>,
      ),
    );

    expect(sources[0]?.captureCurrentContent()).toBe("<?php");
    vi.mocked(firstModel.getValue).mockImplementationOnce(() => {
      fixture.leftEditor.getModel.mockReturnValue(secondModel);
      return "<?php";
    });
    expect(sources[0]?.captureCurrentContent()).toBeNull();
  });

  it("publishes programmatic A to B to A selection and makes each prior DTO stale", async () => {
    const pathA = "/workspace/a.ts";
    const pathB = "/workspace/b.ts";
    const modelA = runtimeModel("/workspace", pathA);
    const modelB = runtimeModel("/workspace", pathB);
    const monaco = runtimeMonaco([modelA, modelB]);
    const fixtureA = runtimeFixture("/workspace", monaco, modelA, pathA);
    const fixtureB = runtimeFixture("/workspace", monaco, modelB, pathB);
    const authorityA = liveSessionAuthority("left", pathA);
    const authorityB = liveSessionAuthority("right", pathB);
    const authorities = new Map([
      ["left", authorityA],
      ["right", authorityB],
    ]);
    const runtime = new LiveDocumentRuntime();
    const published: NonNullable<
      React.ComponentProps<typeof EditorRuntimeHost>["onActiveLiveDocumentBindingChange"]
    > = vi.fn();
    const stableProps = {
      isEditorGroupDocumentSessionAuthorityCurrent: (
        authority: EditorGroupDocumentSessionAuthority,
      ) => authorities.get(authority.groupId) === authority,
      liveDocumentRuntime: runtime,
      onActiveLiveDocumentBindingChange: published,
      resolveEditorGroupDocumentSessionAuthority: (groupId: string) =>
        authorities.get(groupId) ?? null,
    };
    const render = (activeGroupId: "left" | "right") => (
      <EditorRuntimeHost {...stableProps} activeGroupId={activeGroupId}>
        <RuntimeSurface {...fixtureA} groupId="left" name="a.ts" />
        <RuntimeSurface {...fixtureB} groupId="right" name="b.ts" />
      </EditorRuntimeHost>
    );

    await act(async () => root.render(render("left")));
    const firstA = vi.mocked(published).mock.calls[vi.mocked(published).mock.calls.length - 1]?.[0];
    expect(firstA).toEqual(expect.objectContaining({ groupId: "left", path: pathA }));

    await act(async () => root.render(render("right")));
    const bindingB =
      vi.mocked(published).mock.calls[vi.mocked(published).mock.calls.length - 1]?.[0];
    expect(firstA?.isCurrent()).toBe(false);
    expect(bindingB).toEqual(expect.objectContaining({ groupId: "right", path: pathB }));

    await act(async () => root.render(render("left")));
    const secondA =
      vi.mocked(published).mock.calls[vi.mocked(published).mock.calls.length - 1]?.[0];
    expect(bindingB?.isCurrent()).toBe(false);
    expect(secondA).toEqual(expect.objectContaining({ groupId: "left", path: pathA }));
    expect(secondA?.isCurrent()).toBe(true);
  });

  it("rebinds the same group and path from one exact session incarnation to the next", async () => {
    const fixture = runtimeFixture("/workspace", undefined, undefined, "/workspace/shared.php");
    let authority = liveSessionAuthority("left", fixture.path);
    const resolver = vi.fn(() => authority);
    const published = vi.fn();
    const attachments = Array.from({ length: 2 }, () => ({
      observe: vi.fn(() => true),
      release: vi.fn(() => true),
    }));
    const attachEditorGroupLiveDocument = vi
      .fn()
      .mockReturnValueOnce(attachments[0])
      .mockReturnValueOnce(attachments[1]);
    const stableProps = {
      activeGroupId: "left",
      attachEditorGroupLiveDocument,
      isEditorGroupDocumentSessionAuthorityCurrent: (
        candidate: EditorGroupDocumentSessionAuthority,
      ) => candidate === authority,
      liveDocumentRuntime: new LiveDocumentRuntime(),
      onActiveLiveDocumentBindingChange: published,
      resolveEditorGroupDocumentSessionAuthority: resolver,
    };
    const render = (documentSessionAuthorityRevision: object) => (
      <EditorRuntimeHost
        {...stableProps}
        documentSessionAuthorityRevision={documentSessionAuthorityRevision}
      >
        <RuntimeSurface {...fixture} groupId="left" name="shared.php" />
      </EditorRuntimeHost>
    );

    await act(async () => root.render(render({})));
    const first = published.mock.calls[published.mock.calls.length - 1]?.[0];
    const callsAfterFirst = resolver.mock.calls.length;
    authority = liveSessionAuthority("left", fixture.path);
    await act(async () => root.render(render({})));
    const second = published.mock.calls[published.mock.calls.length - 1]?.[0];

    expect(resolver).toHaveBeenCalledTimes(callsAfterFirst + 1);
    expect(attachEditorGroupLiveDocument).toHaveBeenCalledTimes(2);
    expect(attachments[0]?.release).toHaveBeenCalledOnce();
    expect(attachments[1]?.release).not.toHaveBeenCalled();
    expect(first?.isCurrent()).toBe(false);
    expect(second).not.toBe(first);
    expect(second?.isCurrent()).toBe(true);
  });

  it("rebinds after the editor replaces its Monaco model without content churn", async () => {
    const path = "/workspace/shared.php";
    const firstModel = runtimeModel("/workspace", path);
    const secondModel = runtimeModel("/workspace", path);
    const monaco = runtimeMonaco([firstModel, secondModel]);
    const fixture = runtimeFixture("/workspace", monaco, firstModel, path);
    const authority = liveSessionAuthority("left", path);
    const published = vi.fn();
    const onChange = vi.fn(() => true);
    const attachments = [
      {
        observe: vi.fn(() => true),
        release: vi.fn(() => {
          fixture.leftEditor.emitModelContentChange();
          return true;
        }),
      },
      {
        observe: vi.fn(() => true),
        release: vi.fn(() => true),
      },
    ];
    const sources: {
      holderIncarnation: object;
      modelIncarnation: object;
    }[] = [];
    const attachEditorGroupLiveDocument = vi.fn((_authority, source) => {
      sources.push(source);
      return attachments[sources.length - 1] ?? null;
    });

    await act(async () =>
      root.render(
        <EditorRuntimeHost
          activeGroupId="left"
          attachEditorGroupLiveDocument={attachEditorGroupLiveDocument}
          documentSessionAuthorityRevision={{}}
          isEditorGroupDocumentSessionAuthorityCurrent={(candidate) => candidate === authority}
          liveDocumentRuntime={new LiveDocumentRuntime()}
          onActiveLiveDocumentBindingChange={published}
          resolveEditorGroupDocumentSessionAuthority={() => authority}
        >
          <RuntimeSurface
            {...fixture}
            groupId="left"
            name="shared.php"
            onModelContentChange={onChange}
          />
        </EditorRuntimeHost>,
      ),
    );
    const first = published.mock.calls[published.mock.calls.length - 1]?.[0];
    await act(async () => {
      firstModel.dispose();
      vi.mocked(firstModel.getValue).mockReturnValue("<?php");
      fixture.leftEditor.getModel.mockReturnValue(secondModel);
      fixture.leftEditor.emitModelChange();
    });
    const second = published.mock.calls[published.mock.calls.length - 1]?.[0];

    expect(attachEditorGroupLiveDocument).toHaveBeenCalledTimes(2);
    expect(sources[1]?.holderIncarnation).not.toBe(sources[0]?.holderIncarnation);
    expect(sources[1]?.modelIncarnation).not.toBe(sources[0]?.modelIncarnation);
    expect(attachments[0]?.release).toHaveBeenCalledOnce();
    expect(attachments[1]?.release).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(first?.isCurrent()).toBe(false);
    expect(second).not.toBe(first);
    expect(second?.isCurrent()).toBe(true);
  });

  it("rotates past malformed release facades and fences reentrant stale observations", async () => {
    const fixture = runtimeFixture("/workspace", undefined, undefined, "/workspace/shared.ts");
    let authority = liveSessionAuthority("left", fixture.path);
    const onChange = vi.fn(() => true);
    const attachments = [
      {
        observe: vi.fn(() => true),
        release: vi
          .fn()
          .mockImplementationOnce(() => {
            fixture.leftEditor.emitModelContentChange();
            return false;
          })
          .mockReturnValue(true),
      },
      {
        observe: vi.fn(() => true),
        release: vi
          .fn()
          .mockImplementationOnce(() => {
            throw new Error("release failed");
          })
          .mockImplementationOnce(() => {
            throw new Error("release failed again");
          })
          .mockReturnValue(true),
      },
      {
        observe: vi.fn(() => true),
        release: vi.fn(() => true),
      },
    ];
    const attachEditorGroupLiveDocument = vi
      .fn()
      .mockReturnValueOnce(attachments[0])
      .mockReturnValueOnce(attachments[1])
      .mockReturnValueOnce(attachments[2]);
    const runtime = new LiveDocumentRuntime();
    const render = (documentSessionAuthorityRevision: object) => (
      <EditorRuntimeHost
        activeGroupId="left"
        attachEditorGroupLiveDocument={attachEditorGroupLiveDocument}
        documentSessionAuthorityRevision={documentSessionAuthorityRevision}
        isEditorGroupDocumentSessionAuthorityCurrent={(candidate) => candidate === authority}
        liveDocumentRuntime={runtime}
        resolveEditorGroupDocumentSessionAuthority={() => authority}
      >
        <RuntimeSurface
          {...fixture}
          groupId="left"
          name="shared.ts"
          onModelContentChange={onChange}
        />
      </EditorRuntimeHost>
    );

    await act(async () => root.render(render({})));
    authority = liveSessionAuthority("left", fixture.path);
    await act(async () => root.render(render({})));
    authority = liveSessionAuthority("left", fixture.path);
    await act(async () => root.render(render({})));

    expect(attachEditorGroupLiveDocument).toHaveBeenCalledTimes(3);
    expect(attachments[0].release).toHaveBeenCalledTimes(2);
    // Host reconciliation may retry a rejected detached release immediately;
    // both attempts remain fenced before the replacement can observe edits.
    expect(attachments[1].release).toHaveBeenCalledTimes(2);
    expect(attachments[0].observe).not.toHaveBeenCalled();
    expect(attachments[1].observe).not.toHaveBeenCalled();

    fixture.leftEditor.emitModelContentChange();
    expect(attachments[2].observe).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    await Promise.resolve();
    expect(attachments[1].release).toHaveBeenCalledTimes(3);
    expect(attachments[2].release).toHaveBeenCalledOnce();
  });

  it("fails closed for an old model event after the same surface switches path", async () => {
    const firstPath = "/workspace/first.php";
    const secondPath = "/workspace/second.php";
    const firstModel = runtimeModel("/workspace", firstPath);
    const secondModel = runtimeModel("/workspace", secondPath);
    const monaco = runtimeMonaco([firstModel, secondModel]);
    const first = runtimeFixture("/workspace", monaco, firstModel, firstPath);
    const firstOnChange = vi.fn(() => true);

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface
            {...first}
            groupId="left"
            name="first.php"
            onModelContentChange={firstOnChange}
            transitionContentSync={{
              emitOldContentChange: firstModel.emitContentChange,
              nextEditor: first.leftEditor as unknown as Monaco.editor.IStandaloneCodeEditor,
              nextPath: secondPath,
              prepareTransition: () => first.leftEditor.getModel.mockReturnValue(secondModel),
            }}
          />
        </EditorRuntimeHost>,
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-content-sync-transition='left']")?.click();
    });

    expect(firstOnChange).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    runtimeMocks.javaScriptContext = null;
    runtimeMocks.providerContext = null;
    runtimeMocks.debugHoverContext = null;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("registers workspace providers once and routes them through the focused group", async () => {
    const fixture = runtimeFixture();

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...fixture} groupId="left" key="left" name="left.php" />
          <RuntimeSurface {...fixture} groupId="right" key="right" name="right.php" />
        </EditorRuntimeHost>,
      );
    });

    expect(runtimeMocks.registerLanguage).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.registerComposer).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.registerNpm).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.registerJavaScriptTypeScript).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.configureTypescriptJavascriptDefaultsOnce).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe("left.php");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-group='right']")?.click();
    });

    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe("right.php");
    expect(runtimeMocks.providerContext?.getDocumentForModel?.(fixture.model)?.name).toBe(
      "right.php",
    );

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...fixture} groupId="right" key="right" name="right.php" />
        </EditorRuntimeHost>,
      );
    });

    expect(runtimeMocks.registerLanguage).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.registerJavaScriptTypeScript).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.configureTypescriptJavascriptDefaultsOnce).toHaveBeenCalledTimes(1);
  });

  it("advances the JS/TS owner epoch across A-B-A without an intermediate provider call", async () => {
    const fixture = runtimeFixture();

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...fixture} groupId="left" key="left" name="left.ts" />
          <RuntimeSurface {...fixture} groupId="right" key="right" name="right.ts" />
        </EditorRuntimeHost>,
      );
    });

    const initialEpoch =
      runtimeMocks.javaScriptContext?.getActiveJavaScriptTypeScriptOwnerEpoch() ?? -1;
    const initialIdentity =
      runtimeMocks.javaScriptContext?.getActiveJavaScriptTypeScriptOwnerIdentity();
    expect(initialEpoch).toBeGreaterThan(0);
    expect(Number.isSafeInteger(initialEpoch)).toBe(true);
    expect(initialIdentity).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-group='right']")?.click();
    });
    const rightIdentity =
      runtimeMocks.javaScriptContext?.getActiveJavaScriptTypeScriptOwnerIdentity();
    expect(rightIdentity).not.toBe(initialIdentity);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-group='left']")?.click();
    });

    expect(runtimeMocks.javaScriptContext?.getActiveDocument()?.name).toBe("left.ts");
    expect(runtimeMocks.javaScriptContext?.getActiveJavaScriptTypeScriptOwnerEpoch()).toBe(
      initialEpoch + 2,
    );
    expect(runtimeMocks.javaScriptContext?.getActiveJavaScriptTypeScriptOwnerIdentity()).toBe(
      initialIdentity,
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-update='left']")?.click();
    });

    expect(runtimeMocks.javaScriptContext?.getActiveJavaScriptTypeScriptOwnerEpoch()).toBe(
      initialEpoch + 3,
    );
    expect(runtimeMocks.javaScriptContext?.getActiveJavaScriptTypeScriptOwnerIdentity()).toBe(
      initialIdentity,
    );
  });

  it("registers debug hover against the admitted workspace model resolver", async () => {
    const fixture = runtimeFixture();
    const debugHover = {
      copyEvaluatePath: vi.fn(async () => false),
      evaluate: vi.fn(),
      getOwner: vi.fn(() => null),
      getOwnerEpoch: vi.fn(() => 0),
      registerCopyEvaluatePath: vi.fn(() => null),
      revokeCopyEvaluatePath: vi.fn(),
    };

    await act(async () => {
      root.render(
        <EditorRuntimeHost debugHover={debugHover}>
          <RuntimeSurface {...fixture} groupId="left" name="left.ts" />
        </EditorRuntimeHost>,
      );
    });

    expect(runtimeMocks.registerDebugHover).toHaveBeenCalledOnce();
    expect(runtimeMocks.debugHoverContext?.getAdmittedWorkspaceRoot()).toBe("/workspace");
    expect(runtimeMocks.debugHoverContext?.resolveDocumentForModel(fixture.model)?.name).toBe(
      "left.ts",
    );

    await act(async () =>
      root.render(<EditorRuntimeHost debugHover={debugHover}>{null}</EditorRuntimeHost>),
    );
    expect(runtimeMocks.debugHoverDispose).toHaveBeenCalledOnce();
  });

  it("routes PHP code actions by source when the focused group is different", async () => {
    const fixture = runtimeFixture();
    const leftCodeActions = vi.fn(async () => []);
    const rightCodeActions = vi.fn(async () => []);
    const leftSource = "<?php\nclass LeftFile {}\n";
    const rightSource = "<?php\nclass RightFile {}\n";

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface
            {...fixture}
            content={leftSource}
            groupId="left"
            key="left"
            name="left.php"
            phpCodeActions={leftCodeActions}
          />
          <RuntimeSurface
            {...fixture}
            content={rightSource}
            groupId="right"
            key="right"
            name="right.php"
            phpCodeActions={rightCodeActions}
          />
        </EditorRuntimeHost>,
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-group='right']")?.click();
    });

    const providerContext = runtimeMocks.registerLanguage.mock.calls[0]?.[1];
    await providerContext.providePhpCodeActions(leftSource, {
      endColumn: 1,
      endLineNumber: 1,
      startColumn: 1,
      startLineNumber: 1,
    });

    expect(leftCodeActions).toHaveBeenCalledOnce();
    expect(rightCodeActions).not.toHaveBeenCalled();
  });

  it("subscribes to Monaco marker changes once and fans them out to owning surfaces", async () => {
    const fixture = runtimeFixture();
    const leftMarkerChange = vi.fn();
    const rightMarkerChange = vi.fn();

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface
            {...fixture}
            groupId="left"
            key="left"
            name="left.php"
            onMarkerUrisChanged={leftMarkerChange}
          />
          <RuntimeSurface
            {...fixture}
            groupId="right"
            key="right"
            name="right.php"
            onMarkerUrisChanged={rightMarkerChange}
          />
        </EditorRuntimeHost>,
      );
    });

    expect(fixture.markerChanges.subscribe).toHaveBeenCalledTimes(1);

    const changedUris = [fixture.model.uri];
    await act(async () => fixture.markerChanges.emit(changedUris));

    expect(leftMarkerChange).toHaveBeenCalledWith(changedUris);
    expect(rightMarkerChange).toHaveBeenCalledWith(changedUris);

    await act(async () => root.unmount());

    expect(fixture.markerChanges.dispose).toHaveBeenCalledTimes(1);
  });

  it("configures global TypeScript defaults once for one, two, or four surfaces", async () => {
    const fixture = runtimeFixture();

    for (const count of [1, 2, 4]) {
      await act(async () => {
        root.render(
          <EditorRuntimeHost>
            {Array.from({ length: count }, (_, index) => (
              <RuntimeSurface
                {...fixture}
                groupId={`group-${index}`}
                key={`group-${index}`}
                name={`surface-${index}.ts`}
              />
            ))}
          </EditorRuntimeHost>,
        );
      });

      expect(runtimeMocks.configureTypescriptJavascriptDefaultsOnce).toHaveBeenCalledTimes(1);
    }
  });

  it("reconfigures TypeScript defaults only when effective workspace settings change", async () => {
    const fixture = runtimeFixture();

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...fixture} groupId="left" name="left.ts" />
          <RuntimeSurface {...fixture} groupId="right" name="right.ts" />
        </EditorRuntimeHost>,
      );
    });
    expect(runtimeMocks.configureTypescriptJavascriptDefaultsOnce).toHaveBeenCalledTimes(1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-group='right']")?.click();
    });
    expect(runtimeMocks.configureTypescriptJavascriptDefaultsOnce).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...fixture} groupId="left" name="left.ts" validationEnabled={false} />
          <RuntimeSurface {...fixture} groupId="right" name="right.ts" validationEnabled={false} />
        </EditorRuntimeHost>,
      );
    });
    expect(runtimeMocks.configureTypescriptJavascriptDefaultsOnce).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.configureTypescriptJavascriptDefaultsOnce).toHaveBeenLastCalledWith(
      fixture.monaco,
      { managedLanguageServerActive: false, validationEnabled: false },
    );
  });

  it("configures Monaco defaults for a rootless surface without admitting provider or model ownership", async () => {
    const fixture = runtimeFixture(null);

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...fixture} groupId="scratch" name="scratch.ts" />
        </EditorRuntimeHost>,
      );
    });

    expect(runtimeMocks.configureTypescriptJavascriptDefaultsOnce).toHaveBeenCalledOnce();
    expect(runtimeMocks.registerLanguage).not.toHaveBeenCalled();
    expect(runtimeMocks.registerJavaScriptTypeScript).not.toHaveBeenCalled();
    expect(fixture.model.dispose).not.toHaveBeenCalled();
  });

  it("focuses the registered Monaco editor for a command-selected group", async () => {
    const fixture = runtimeFixture();
    const animationFrames = animationFrameFixture();
    let focusRunner: EditorGroupFocusRunner = () => false;

    await act(async () => {
      root.render(
        <EditorRuntimeHost
          onGroupFocusRunnerChange={(runner) => {
            if (runner) {
              focusRunner = runner;
            }
          }}
        >
          <RuntimeSurface {...fixture} groupId="left" key="left" name="left.php" />
          <RuntimeSurface {...fixture} groupId="right" key="right" name="right.php" />
        </EditorRuntimeHost>,
      );
    });

    let accepted = false;
    await act(async () => {
      accepted = focusRunner("right");
    });

    expect(accepted).toBe(true);
    expect(fixture.rightEditor.focus).not.toHaveBeenCalled();
    fixture.leftEditor.focus();
    expect(fixture.leftEditor.focus).toHaveBeenCalledOnce();

    await act(async () => animationFrames.flush());

    expect(fixture.rightEditor.focus).toHaveBeenCalledOnce();
    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe("right.php");
  });

  it("cancels stale scheduled focus when the target group is removed", async () => {
    const fixture = runtimeFixture();
    const animationFrames = animationFrameFixture();
    let focusRunner: EditorGroupFocusRunner = () => false;

    await act(async () => {
      root.render(
        <EditorRuntimeHost
          onGroupFocusRunnerChange={(runner) => {
            if (runner) {
              focusRunner = runner;
            }
          }}
        >
          <RuntimeSurface {...fixture} groupId="left" key="left" name="left.php" />
          <RuntimeSurface {...fixture} groupId="right" key="right" name="right.php" />
        </EditorRuntimeHost>,
      );
    });

    await act(async () => {
      expect(focusRunner("right")).toBe(true);
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...fixture} groupId="left" key="left" name="left.php" />
        </EditorRuntimeHost>,
      );
    });
    await act(async () => animationFrames.flush());

    expect(fixture.rightEditor.focus).not.toHaveBeenCalled();
    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe("left.php");
  });

  it("does not carry a scheduled group focus into another workspace", async () => {
    const first = runtimeFixture("/first");
    const second = runtimeFixture("/second");
    const animationFrames = animationFrameFixture();
    let focusRunner: EditorGroupFocusRunner = () => false;

    await act(async () => {
      root.render(
        <EditorRuntimeHost
          onGroupFocusRunnerChange={(runner) => {
            if (runner) {
              focusRunner = runner;
            }
          }}
        >
          <RuntimeSurface {...first} groupId="main" name="first.php" />
        </EditorRuntimeHost>,
      );
    });

    await act(async () => {
      expect(focusRunner("main")).toBe(true);
      root.render(
        <EditorRuntimeHost
          onGroupFocusRunnerChange={(runner) => {
            if (runner) {
              focusRunner = runner;
            }
          }}
        >
          <RuntimeSurface {...second} groupId="main" name="second.php" />
        </EditorRuntimeHost>,
      );
    });
    await act(async () => animationFrames.flush());

    expect(first.leftEditor.focus).not.toHaveBeenCalled();
    expect(second.leftEditor.focus).not.toHaveBeenCalled();
    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe("second.php");
  });

  it("shares a model, reconciles its markers once, and retains it until host teardown", async () => {
    const fixture = runtimeFixture();

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...fixture} groupId="left" key="left" name="shared.php" />
          <RuntimeSurface {...fixture} groupId="right" key="right" name="shared.php" />
        </EditorRuntimeHost>,
      );
    });

    expect(fixture.leftEditor.getModel()).toBe(fixture.model);
    expect(fixture.rightEditor.getModel()).toBe(fixture.model);
    expect(fixture.monaco.editor.setModelMarkers).toHaveBeenCalledTimes(1);
    const modelReadsBeforeStableUpdate = vi.mocked(fixture.monaco.editor.getModels).mock.calls
      .length;

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-update='left']")?.click();
    });
    expect(fixture.monaco.editor.getModels).toHaveBeenCalledTimes(modelReadsBeforeStableUpdate);
    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe("shared.php updated");
    expect(runtimeMocks.javaScriptContext?.getActiveDocument()?.name).toBe("shared.php updated");

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...fixture} groupId="right" key="right" name="shared.php" />
        </EditorRuntimeHost>,
      );
    });
    expect(fixture.model.dispose).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(fixture.model.dispose).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("writes identical local PHP markers once for panes sharing a model", async () => {
    const fixture = runtimeFixture();
    const localMarkers = [localPhpMarker("Unexpected token")];

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface
            {...fixture}
            groupId="left"
            key="left"
            localMarkers={localMarkers}
            name="shared.php"
          />
          <RuntimeSurface
            {...fixture}
            groupId="right"
            key="right"
            localMarkers={localMarkers}
            name="shared.php"
          />
        </EditorRuntimeHost>,
      );
    });

    expect(
      vi
        .mocked(fixture.monaco.editor.setModelMarkers)
        .mock.calls.filter(([, owner]) => owner === "php-syntax"),
    ).toEqual([[fixture.model, "php-syntax", localMarkers]]);
  });

  it("does not let a rejected foreign-workspace pane write local PHP markers", async () => {
    const admitted = runtimeFixture("/workspace");
    const foreign = runtimeFixture("/foreign");

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface
            {...admitted}
            groupId="left"
            localMarkers={[localPhpMarker("Admitted marker")]}
            name="shared.php"
          />
          <RuntimeSurface
            {...foreign}
            groupId="foreign"
            localMarkers={[localPhpMarker("Foreign marker")]}
            name="foreign.php"
          />
        </EditorRuntimeHost>,
      );
    });

    expect(admitted.monaco.editor.setModelMarkers).toHaveBeenCalledWith(
      admitted.model,
      "php-syntax",
      [localPhpMarker("Admitted marker")],
    );
    expect(foreign.monaco.editor.setModelMarkers).not.toHaveBeenCalled();
  });

  it("keeps a shared model alive when StrictMode splits one surface into two", async () => {
    const fixture = runtimeFixture();

    function SplitHarness() {
      const [split, setSplit] = useState(false);
      return (
        <EditorRuntimeHost>
          <RuntimeSurface {...fixture} groupId="left" key="left" name="shared.php" />
          {split ? (
            <RuntimeSurface {...fixture} groupId="right" key="right" name="shared.php" />
          ) : null}
          <button data-split onClick={() => setSplit(true)} />
        </EditorRuntimeHost>
      );
    }

    await act(async () => {
      root.render(
        <StrictMode>
          <SplitHarness />
        </StrictMode>,
      );
      await Promise.resolve();
    });
    expect(fixture.model.dispose).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-split]")?.click();
      await Promise.resolve();
    });

    expect(fixture.leftEditor.getModel()).toBe(fixture.model);
    expect(fixture.rightEditor.getModel()).toBe(fixture.model);
    expect(fixture.model.dispose).not.toHaveBeenCalled();
    expect(() => fixture.model.getValue()).not.toThrow();
    expect(runtimeMocks.providerContext?.getDocumentForModel?.(fixture.model)).toEqual(
      expect.objectContaining({ path: fixture.path }),
    );
    expect(runtimeMocks.javaScriptContext?.getActiveDocument()).toEqual(
      expect.objectContaining({ path: fixture.path }),
    );
  });

  it("keeps a shared model alive when a removed split is dynamically recreated", async () => {
    const fixture = runtimeFixture();

    function Split({ children }: { children: React.ReactNode }) {
      return <div data-layout="split">{children}</div>;
    }

    function DynamicSplitHarness() {
      const [stage, setStage] = useState(0);
      const left = <RuntimeSurface {...fixture} groupId="left" key="left" name="shared.php" />;
      const right = <RuntimeSurface {...fixture} groupId="right" key="right" name="shared.php" />;

      return (
        <EditorRuntimeHost>
          {stage < 2 ? (
            <Split>
              {left}
              {stage === 0 ? right : <div data-empty-group="right" />}
            </Split>
          ) : null}
          {stage === 2 ? left : null}
          {stage === 3 ? (
            <Split>
              {left}
              {right}
            </Split>
          ) : null}
          <button data-next-stage onClick={() => setStage((current) => current + 1)} />
        </EditorRuntimeHost>
      );
    }

    await act(async () => {
      root.render(
        <StrictMode>
          <DynamicSplitHarness />
        </StrictMode>,
      );
      await Promise.resolve();
    });

    for (let stage = 1; stage <= 3; stage += 1) {
      await act(async () => {
        container.querySelector<HTMLButtonElement>("[data-next-stage]")?.click();
        await Promise.resolve();
      });

      expect(fixture.model.dispose).not.toHaveBeenCalled();
      expect(() => fixture.model.getValue()).not.toThrow();
      expect(runtimeMocks.providerContext?.getDocumentForModel?.(fixture.model)).toEqual(
        expect.objectContaining({ path: fixture.path }),
      );
    }

    expect(container.querySelectorAll("[data-group]")).toHaveLength(2);
    expect(runtimeMocks.javaScriptContext?.getActiveDocument()).toEqual(
      expect.objectContaining({ path: fixture.path }),
    );
  });

  it("hands shared models to a replacement host before deferred teardown", async () => {
    const fixture = runtimeFixture();

    await act(async () => {
      root.render(
        <EditorRuntimeHost key="implicit">
          <RuntimeSurface {...fixture} groupId="left" name="shared.php" />
        </EditorRuntimeHost>,
      );
    });

    await act(async () => {
      root.render(
        <EditorRuntimeHost key="explicit">
          <RuntimeSurface {...fixture} groupId="left" name="shared.php" />
          <RuntimeSurface {...fixture} groupId="right" name="shared.php" />
        </EditorRuntimeHost>,
      );
      await Promise.resolve();
    });

    expect(fixture.model.dispose).not.toHaveBeenCalled();
    expect(() => fixture.model.getValue()).not.toThrow();
    expect(runtimeMocks.providerContext?.getDocumentForModel?.(fixture.model)).toEqual(
      expect.objectContaining({ path: fixture.path }),
    );

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    expect(fixture.model.dispose).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("releases the previous Monaco API lease when the workspace root is unchanged", async () => {
    const first = runtimeFixture();
    const secondModel = runtimeModel("/workspace", first.path);
    const secondMonaco = runtimeMonaco([secondModel]);
    const second = runtimeFixture("/workspace", secondMonaco, secondModel, first.path);

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...first} groupId="left" name="shared.php" />
        </EditorRuntimeHost>,
      );
    });

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...second} groupId="left" name="shared.php" />
        </EditorRuntimeHost>,
      );
      await Promise.resolve();
    });

    expect(first.model.dispose).toHaveBeenCalledTimes(1);
    expect(second.model.dispose).not.toHaveBeenCalled();
    expect(() => second.model.getValue()).not.toThrow();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    expect(second.model.dispose).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("rejects a foreign workspace without touching either project's models", async () => {
    const firstModel = runtimeModel("/first", "/first/shared.php");
    const secondModel = runtimeModel("/second", "/second/shared.php");
    const monaco = runtimeMonaco([firstModel, secondModel]);
    const first = runtimeFixture("/first", monaco, firstModel);
    const second = runtimeFixture("/second", monaco, secondModel);

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...first} groupId="first" key="first" name="first.php" />
          <RuntimeSurface {...second} groupId="second" key="second" name="second.php" />
        </EditorRuntimeHost>,
      );
    });

    expect(runtimeMocks.registerLanguage).toHaveBeenCalledTimes(1);
    expect(monaco.editor.setModelMarkers).toHaveBeenCalledTimes(1);
    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(
      firstModel,
      "php-language-server",
      expect.any(Array),
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-group='second']")?.click();
    });

    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe("first.php");
    expect(firstModel.dispose).not.toHaveBeenCalled();
    expect(secondModel.dispose).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(firstModel.dispose).toHaveBeenCalledTimes(1);
    expect(secondModel.dispose).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it("keeps a rootless registration inert after a workspace is admitted", async () => {
    const admittedModel = runtimeModel("/workspace", "/workspace/shared.php");
    const foreignModel = {
      dispose: vi.fn(),
      uri: URI.parse("file:///foreign/shared.php"),
    } as unknown as Monaco.editor.ITextModel;
    const monaco = runtimeMonaco([admittedModel, foreignModel]);
    const rootless = runtimeFixture(null, monaco, foreignModel, "/foreign/shared.php");
    const admitted = runtimeFixture("/workspace", monaco, admittedModel);

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...admitted} groupId="admitted" key="admitted" name="admitted.php" />
        </EditorRuntimeHost>,
      );
    });

    const modelReadsAfterAdmission = vi.mocked(monaco.editor.getModels).mock.calls.length;

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...admitted} groupId="admitted" key="admitted" name="admitted.php" />
          <RuntimeSurface {...rootless} groupId="rootless" key="rootless" name="foreign.php" />
        </EditorRuntimeHost>,
      );
    });

    expect(monaco.editor.getModels).toHaveBeenCalledTimes(modelReadsAfterAdmission);
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-group='rootless']")?.click();
    });

    expect(monaco.editor.getModels).toHaveBeenCalledTimes(modelReadsAfterAdmission);
    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe("admitted.php");
    expect(foreignModel.dispose).not.toHaveBeenCalled();
  });

  it("activates only a rootless registration's workspace on its same-id transition", async () => {
    const workspaceModel = runtimeModel("/workspace", "/workspace/shared.php");
    const foreignModel = runtimeModel("/foreign", "/foreign/shared.php");
    const monaco = runtimeMonaco([workspaceModel, foreignModel]);
    const pending = runtimeFixture(null, monaco, workspaceModel, "/workspace/shared.php");

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface
            {...pending}
            groupId="pending"
            key="pending"
            name="pending.php"
            transitionWorkspaceRoot="/workspace"
          />
        </EditorRuntimeHost>,
      );
    });

    expect(monaco.editor.getModels).toHaveBeenCalledOnce();
    expect(monaco.editor.setModelMarkers).not.toHaveBeenCalled();
    expect(runtimeMocks.registerLanguage).not.toHaveBeenCalled();
    expect(workspaceModel.dispose).not.toHaveBeenCalled();
    expect(foreignModel.dispose).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-transition='pending']")?.click();
    });

    expect(runtimeMocks.registerLanguage).toHaveBeenCalledTimes(1);
    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(
      workspaceModel,
      "php-language-server",
      expect.any(Array),
    );
    expect(
      vi.mocked(monaco.editor.setModelMarkers).mock.calls.some(([model]) => model === foreignModel),
    ).toBe(false);
    expect(workspaceModel.dispose).not.toHaveBeenCalled();
    expect(foreignModel.dispose).not.toHaveBeenCalled();
  });

  it("admits normalized aliases of the owning workspace root", async () => {
    const model = runtimeModel("/workspace", "/workspace/shared.php");
    const monaco = runtimeMonaco([model]);
    const canonical = runtimeFixture("/workspace", monaco, model);
    const trailingSlashAlias = runtimeFixture(
      "/workspace/",
      monaco,
      model,
      "/workspace/shared.php",
    );

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface {...canonical} groupId="canonical" key="canonical" name="canonical.php" />
          <RuntimeSurface {...trailingSlashAlias} groupId="alias" key="alias" name="alias.php" />
        </EditorRuntimeHost>,
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-group='alias']")?.click();
    });

    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe("alias.php");
    expect(model.dispose).not.toHaveBeenCalled();
  });
});

function RuntimeSurface({
  content = "<?php",
  groupId,
  featuresGateway,
  leftEditor,
  localMarkers,
  model,
  monaco,
  name,
  onMarkerUrisChanged,
  onModelContentChange = noopModelContentChange,
  path,
  phpCodeActions,
  rightEditor,
  transitionWorkspaceRoot,
  transitionContentSync,
  validationEnabled = true,
  workspaceRoot,
}: ReturnType<typeof runtimeFixture> & {
  content?: string;
  groupId: string;
  name: string;
  localMarkers?: readonly Monaco.editor.IMarkerData[];
  onMarkerUrisChanged?: (uris: readonly Monaco.Uri[]) => void;
  onModelContentChange?: (content: string, path?: string) => boolean | void;
  phpCodeActions?: EditorSurfaceLanguageProviderRegistrationRefs["phpCodeActionsRef"]["current"];
  transitionWorkspaceRoot?: string;
  transitionContentSync?: {
    emitOldContentChange(): void;
    nextEditor: Monaco.editor.IStandaloneCodeEditor;
    nextPath: string;
    prepareTransition(): void;
  };
  validationEnabled?: boolean;
}) {
  const runtime = useEditorRuntimeContext();
  const registrationRef = useRef<EditorRuntimeSurfaceRegistration | null>(null);
  const document = useMemo<EditorDocument>(
    () => ({
      content,
      language: "php",
      name,
      path,
      savedContent: content,
    }),
    [content, name, path],
  );

  useEffect(() => {
    const currentRef = { current: document };
    const providerRefs = providerRefsFor(currentRef, { phpCodeActions });
    const registration = {
      activePath: document.path,
      diagnosticsByPath: {
        [document.path]: [{ character: 0, line: 0, message: "warning", severity: "warning" }],
      },
      editor: (groupId === "left" ? leftEditor : rightEditor) as never,
      groupId,
      monacoApi: monaco,
      onModelContentChange,
      onMarkerUrisChanged,
      providerDependencies: {
        featuresGateway,
        monacoApi: monaco,
        workspaceRoot,
      },
      routing: {
        activeDocumentRef: currentRef,
        javaScriptTypeScriptProviderContext: {
          featuresGateway,
          flushPendingDocumentChange: vi.fn(async () => undefined),
          getActiveJavaScriptTypeScriptOwnerEpoch: () =>
            runtime?.getActiveJavaScriptTypeScriptOwnerEpoch() ?? 0,
          getActiveJavaScriptTypeScriptOwnerIdentity: () =>
            runtime?.getActiveJavaScriptTypeScriptOwnerIdentity() ?? null,
          getActiveDocument: () => currentRef.current,
          getRuntimeStatus: () => null,
          getWorkspaceRoot: () => workspaceRoot,
          reportError: vi.fn(),
        },
        providerRefs,
        resolveDocumentForModel: (candidate: Monaco.editor.ITextModel) =>
          candidate === model ? document : null,
      },
      retainPaths: [document.path],
      toMarker: () => ({
        endColumn: 1,
        endLineNumber: 1,
        message: "warning",
        severity: 4,
        startColumn: 1,
        startLineNumber: 1,
      }),
      typescriptJavascriptDefaults: {
        managedLanguageServerActive: false,
        validationEnabled,
      },
      workspaceIdentityDescriptor: null,
      workspaceRoot,
    } as unknown as EditorRuntimeSurfaceRegistration;
    registrationRef.current = registration;

    return runtime?.registerSurface(groupId, registration);
  }, [
    document,
    featuresGateway,
    groupId,
    leftEditor,
    model,
    monaco,
    onMarkerUrisChanged,
    onModelContentChange,
    phpCodeActions,
    rightEditor,
    runtime,
    validationEnabled,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!localMarkers) {
      return;
    }

    runtime?.writeLocalPhpMarkers(groupId, monaco, model, localMarkers);
  }, [groupId, localMarkers, model, monaco, runtime]);

  return (
    <>
      <button data-group={groupId} onClick={() => runtime?.focusGroup(groupId)} />
      <button
        data-update={groupId}
        onClick={() => {
          const registration = registrationRef.current;
          if (registration) {
            const updatedDocument = {
              ...registration.routing.activeDocumentRef.current!,
              name: `${registration.routing.activeDocumentRef.current!.name} updated`,
            };
            const updatedDocumentRef = { current: updatedDocument };
            runtime?.updateSurface(groupId, {
              ...registration,
              routing: {
                ...registration.routing,
                activeDocumentRef: updatedDocumentRef,
                javaScriptTypeScriptProviderContext: {
                  ...registration.routing.javaScriptTypeScriptProviderContext,
                  getActiveDocument: () => updatedDocumentRef.current,
                },
                providerRefs: providerRefsFor(updatedDocumentRef),
                resolveDocumentForModel: (candidate) =>
                  candidate === model ? updatedDocument : null,
              },
            });
          }
        }}
      />
      {transitionWorkspaceRoot ? (
        <button
          data-transition={groupId}
          onClick={() => {
            const registration = registrationRef.current;
            if (!registration) {
              return;
            }

            const transitioned = {
              ...registration,
              providerDependencies: {
                ...registration.providerDependencies,
                workspaceRoot: transitionWorkspaceRoot,
              },
              routing: {
                ...registration.routing,
                javaScriptTypeScriptProviderContext: {
                  ...registration.routing.javaScriptTypeScriptProviderContext,
                  getWorkspaceRoot: () => transitionWorkspaceRoot,
                },
              },
              workspaceRoot: transitionWorkspaceRoot,
            };
            registrationRef.current = transitioned;
            runtime?.updateSurface(groupId, transitioned);
          }}
        />
      ) : null}
      {transitionContentSync ? (
        <button
          data-content-sync-transition={groupId}
          onClick={() => {
            const registration = registrationRef.current;
            if (!registration) {
              return;
            }
            transitionContentSync.prepareTransition();
            runtime?.updateSurface(groupId, {
              ...registration,
              activePath: transitionContentSync.nextPath,
              editor: transitionContentSync.nextEditor,
            });
            transitionContentSync.emitOldContentChange();
          }}
        />
      ) : null}
    </>
  );
}

function localPhpMarker(message: string): Monaco.editor.IMarkerData {
  return {
    endColumn: 2,
    endLineNumber: 1,
    message,
    severity: 8,
    startColumn: 1,
    startLineNumber: 1,
  };
}

function runtimeFixture(
  workspaceRoot: string | null = "/workspace",
  monacoOverride?: typeof Monaco,
  modelOverride?: Monaco.editor.ITextModel,
  pathOverride?: string,
) {
  const path = pathOverride ?? `${workspaceRoot}/shared.php`;
  const model =
    modelOverride ??
    (workspaceRoot
      ? runtimeModel(workspaceRoot, path)
      : ({
          dispose: vi.fn(),
          uri: URI.parse(`file://${path}`),
        } as unknown as Monaco.editor.ITextModel));
  let leftContentChangeHandler: ((event: Monaco.editor.IModelContentChangedEvent) => void) | null =
    null;
  let rightContentChangeHandler: ((event: Monaco.editor.IModelContentChangedEvent) => void) | null =
    null;
  const leftModelChangeHandlers = new Set<() => void>();
  const rightModelChangeHandlers = new Set<() => void>();
  const emitModelContentChange = (
    handler: ((event: Monaco.editor.IModelContentChangedEvent) => void) | null,
  ) => {
    (
      model as Monaco.editor.ITextModel & {
        applyContentChange?(): void;
      }
    ).applyContentChange?.();
    handler?.(modelContentChangeEvent(model.getVersionId?.() ?? 1));
  };
  const leftEditor = {
    emitModelContentChange: () => emitModelContentChange(leftContentChangeHandler),
    emitModelChange: () => [...leftModelChangeHandlers].forEach((handler) => handler()),
    focus: vi.fn(),
    getModel: vi.fn(() => model),
    onDidChangeModelContent: vi.fn(
      (handler: (event: Monaco.editor.IModelContentChangedEvent) => void) => {
        leftContentChangeHandler = handler;
        return {
          dispose: vi.fn(() => {
            if (leftContentChangeHandler === handler) leftContentChangeHandler = null;
          }),
        };
      },
    ),
    onDidChangeModel: vi.fn((handler: () => void) => {
      leftModelChangeHandlers.add(handler);
      return {
        dispose: vi.fn(() => leftModelChangeHandlers.delete(handler)),
      };
    }),
    trigger: vi.fn(),
  };
  const rightEditor = {
    emitModelContentChange: () => emitModelContentChange(rightContentChangeHandler),
    emitModelChange: () => [...rightModelChangeHandlers].forEach((handler) => handler()),
    focus: vi.fn(),
    getModel: vi.fn(() => model),
    onDidChangeModelContent: vi.fn(
      (handler: (event: Monaco.editor.IModelContentChangedEvent) => void) => {
        rightContentChangeHandler = handler;
        return {
          dispose: vi.fn(() => {
            if (rightContentChangeHandler === handler) rightContentChangeHandler = null;
          }),
        };
      },
    ),
    onDidChangeModel: vi.fn((handler: () => void) => {
      rightModelChangeHandlers.add(handler);
      return {
        dispose: vi.fn(() => rightModelChangeHandlers.delete(handler)),
      };
    }),
    trigger: vi.fn(),
  };
  const markerChanges = runtimeMarkerChanges();
  const monaco = monacoOverride ?? runtimeMonaco([model], markerChanges);

  return {
    featuresGateway: {},
    leftEditor,
    model,
    monaco,
    markerChanges,
    path,
    rightEditor,
    workspaceRoot,
  };
}

function providerRefsFor(
  activeDocumentRef: { current: EditorDocument },
  overrides: {
    phpCodeActions?: EditorSurfaceLanguageProviderRegistrationRefs["phpCodeActionsRef"]["current"];
  } = {},
): EditorRuntimeSurfaceRouting["providerRefs"] {
  return new Proxy({} as Record<string, { current: unknown }>, {
    get(_target, property) {
      if (property === "activeDocumentRef") {
        return activeDocumentRef;
      }
      if (property === "phpCodeActionsRef" && overrides.phpCodeActions) {
        return { current: overrides.phpCodeActions };
      }
      return { current: vi.fn() };
    },
  }) as unknown as EditorRuntimeSurfaceRouting["providerRefs"];
}

function runtimeModel(workspaceRoot: string, path: string) {
  let disposed = false;
  let contentChangeHandler: (() => void) | null = null;
  const willDisposeHandlers = new Set<() => void>();
  let version = 1;
  let alternativeVersion = 1;
  const content = "<?php";
  const model = {
    applyContentChange() {
      version += 1;
      alternativeVersion += 1;
      contentChangeHandler?.();
    },
    emitContentChange() {
      contentChangeHandler?.();
    },
    dispose: vi.fn(() => {
      for (const handler of [...willDisposeHandlers]) handler();
      disposed = true;
    }),
    getAlternativeVersionId: vi.fn(() => alternativeVersion),
    getValue: vi.fn(() => {
      if (disposed) {
        throw new Error("Model is disposed!");
      }
      return content;
    }),
    getValueLength: vi.fn(() => content.length),
    getVersionId: vi.fn(() => version),
    isDisposed: vi.fn(() => disposed),
    onDidChangeContent: vi.fn((handler: () => void) => {
      contentChangeHandler = handler;
      return {
        dispose: vi.fn(() => {
          if (contentChangeHandler === handler) {
            contentChangeHandler = null;
          }
        }),
      };
    }),
    onWillDispose: vi.fn((handler: () => void) => {
      willDisposeHandlers.add(handler);
      return { dispose: vi.fn(() => willDisposeHandlers.delete(handler)) };
    }),
    uri: URI.parse(workspaceModelUri(workspaceRoot, path)!),
  };
  return model as unknown as Monaco.editor.ITextModel & {
    applyContentChange(): void;
    emitContentChange(): void;
    getValue: ReturnType<typeof vi.fn>;
  };
}

function modelContentChangeEvent(versionId: number): Monaco.editor.IModelContentChangedEvent {
  return {
    changes: [
      {
        forceMoveMarkers: false,
        range: {
          containsPosition: () => false,
          containsRange: () => false,
          delta: () => {
            throw new Error("unused");
          },
          endColumn: 1,
          endLineNumber: 1,
          equalsRange: () => false,
          getEndPosition: () => ({ column: 1, lineNumber: 1 }),
          getStartPosition: () => ({ column: 1, lineNumber: 1 }),
          isEmpty: () => true,
          plusRange: () => {
            throw new Error("unused");
          },
          setEndPosition: () => {
            throw new Error("unused");
          },
          setStartPosition: () => {
            throw new Error("unused");
          },
          startColumn: 1,
          startLineNumber: 1,
          strictContainsRange: () => false,
          toString: () => "[1,1 -> 1,1]",
        },
        rangeLength: 0,
        rangeOffset: 0,
        text: "",
      },
    ],
    eol: "\n",
    isEolChange: false,
    isFlush: false,
    isRedoing: false,
    isUndoing: false,
    versionId,
  } as unknown as Monaco.editor.IModelContentChangedEvent;
}

function liveSessionAuthority(groupId: string, path: string): EditorGroupDocumentSessionAuthority {
  const store = new DocumentSessionStore();
  const sidecar = new EditorSessionDocumentAuthoritySidecar(store);
  const relativePath = path.replace(/^\/workspace\/?/, "");
  const activated = sidecar.activateOwner(
    {
      canonicalRoot: "/workspace",
      ownerKey: createLegacyEditorSessionOwnerKey("/workspace"),
      rootPath: "/workspace",
      workspaceId: "/workspace",
    },
    (_rootPath, candidate) =>
      candidate === path
        ? createRegisteredDocumentSaveIdentity("/workspace", "/workspace", relativePath)
        : null,
    {
      [path]: {
        content: "<?php",
        language: "typescript",
        name: path.split("/").pop() ?? path,
        path,
        savedContent: "<?php",
      },
    },
  );
  const lifecycle = activated ? sidecar.resolveLifecycle(path) : null;
  const authority = lifecycle
    ? sidecar.createGroupAuthority(lifecycle, groupId, path, Object.freeze({}))
    : null;
  if (!authority || !lifecycle) throw new Error("Expected exact test group authority");
  liveSessionAuthorityContexts.set(authority, { lifecycle, sidecar });
  return authority;
}

const liveSessionAuthorityContexts = new WeakMap<
  EditorGroupDocumentSessionAuthority,
  {
    readonly lifecycle: NonNullable<
      ReturnType<EditorSessionDocumentAuthoritySidecar["resolveLifecycle"]>
    >;
    readonly sidecar: EditorSessionDocumentAuthoritySidecar;
  }
>();

function peerSessionAuthority(
  authority: EditorGroupDocumentSessionAuthority,
  groupId: string,
): EditorGroupDocumentSessionAuthority {
  const context = liveSessionAuthorityContexts.get(authority);
  const peer = context?.sidecar.createGroupAuthority(
    context.lifecycle,
    groupId,
    authority.path,
    Object.freeze({}),
  );
  if (!peer || !context) throw new Error("Expected peer test group authority");
  liveSessionAuthorityContexts.set(peer, context);
  return peer;
}

const noopModelContentChange = () => undefined;

function runtimeMonaco(
  models: readonly Monaco.editor.ITextModel[],
  markerChanges = runtimeMarkerChanges(),
) {
  return {
    editor: {
      getModels: vi.fn(() => [...models]),
      onDidChangeMarkers: markerChanges.subscribe,
      setModelMarkers: vi.fn(),
    },
  } as unknown as typeof Monaco;
}

function runtimeMarkerChanges() {
  let listener: ((uris: readonly Monaco.Uri[]) => void) | null = null;
  const dispose = vi.fn(() => {
    listener = null;
  });
  const subscribe = vi.fn((next: (uris: readonly Monaco.Uri[]) => void) => {
    listener = next;
    return { dispose };
  });

  return {
    dispose,
    emit(uris: readonly Monaco.Uri[]) {
      listener?.(uris);
    },
    subscribe,
  };
}

function animationFrameFixture() {
  let nextFrameId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      callbacks.set(frameId, callback);
      return frameId;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((frameId: number) => {
      callbacks.delete(frameId);
    }),
  );

  return {
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(performance.now()));
    },
  };
}
