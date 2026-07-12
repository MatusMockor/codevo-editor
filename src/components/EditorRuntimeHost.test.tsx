// @vitest-environment jsdom

import { act, StrictMode, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { URI } from "monaco-editor/esm/vs/base/common/uri.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { EditorDocument } from "../domain/workspace";
import type { EditorGroupFocusRunner } from "../application/editorGroupFocusPort";
import { workspaceModelUri } from "./phpMonacoDocumentContext";
import {
  EditorRuntimeHost,
  useEditorRuntimeContext,
  type EditorRuntimeSurfaceRegistration,
  type EditorRuntimeSurfaceRouting,
} from "./EditorRuntimeHost";

const runtimeMocks = vi.hoisted(() => ({
  javaScriptContext: null as {
    getActiveDocument(): EditorDocument | null;
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
vi.mock(
  "./javascriptTypescriptLanguageServerMonacoProviders",
  async (importOriginal) => ({
    ...(await importOriginal()),
    registerJavaScriptTypeScriptLanguageServerMonacoProviders:
      runtimeMocks.registerJavaScriptTypeScript,
  }),
);

describe("EditorRuntimeHost", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    runtimeMocks.javaScriptContext = null;
    runtimeMocks.providerContext = null;
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
    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe(
      "left.php",
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-group='right']")?.click();
    });

    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe(
      "right.php",
    );
    expect(
      runtimeMocks.providerContext?.getDocumentForModel?.(fixture.model)?.name,
    ).toBe("right.php");

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface
            {...fixture}
            groupId="right"
            key="right"
            name="right.php"
          />
        </EditorRuntimeHost>,
      );
    });

    expect(runtimeMocks.registerLanguage).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.registerJavaScriptTypeScript).toHaveBeenCalledTimes(1);
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
    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe(
      "right.php",
    );
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
    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe(
      "left.php",
    );
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
    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe(
      "second.php",
    );
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
    const modelReadsBeforeStableUpdate = vi.mocked(
      fixture.monaco.editor.getModels,
    ).mock.calls.length;

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-update='left']")
        ?.click();
    });
    expect(fixture.monaco.editor.getModels).toHaveBeenCalledTimes(
      modelReadsBeforeStableUpdate,
    );
    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe(
      "shared.php updated",
    );
    expect(runtimeMocks.javaScriptContext?.getActiveDocument()?.name).toBe(
      "shared.php updated",
    );

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

  it("keeps a shared model alive when StrictMode splits one surface into two", async () => {
    const fixture = runtimeFixture();

    function SplitHarness() {
      const [split, setSplit] = useState(false);
      return (
        <EditorRuntimeHost>
          <RuntimeSurface {...fixture} groupId="left" key="left" name="shared.php" />
          {split ? (
            <RuntimeSurface
              {...fixture}
              groupId="right"
              key="right"
              name="shared.php"
            />
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
      const left = (
        <RuntimeSurface
          {...fixture}
          groupId="left"
          key="left"
          name="shared.php"
        />
      );
      const right = (
        <RuntimeSurface
          {...fixture}
          groupId="right"
          key="right"
          name="shared.php"
        />
      );

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
      expect(
        runtimeMocks.providerContext?.getDocumentForModel?.(fixture.model),
      ).toEqual(expect.objectContaining({ path: fixture.path }));
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
    const second = runtimeFixture(
      "/workspace",
      secondMonaco,
      secondModel,
      first.path,
    );

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
          <RuntimeSurface
            {...second}
            groupId="second"
            key="second"
            name="second.php"
          />
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
      container
        .querySelector<HTMLButtonElement>("[data-group='second']")
        ?.click();
    });

    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe(
      "first.php",
    );
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
    const rootless = runtimeFixture(
      null,
      monaco,
      foreignModel,
      "/foreign/shared.php",
    );
    const admitted = runtimeFixture("/workspace", monaco, admittedModel);

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface
            {...admitted}
            groupId="admitted"
            key="admitted"
            name="admitted.php"
          />
        </EditorRuntimeHost>,
      );
    });

    const modelReadsAfterAdmission = vi.mocked(monaco.editor.getModels).mock
      .calls.length;

    await act(async () => {
      root.render(
        <EditorRuntimeHost>
          <RuntimeSurface
            {...admitted}
            groupId="admitted"
            key="admitted"
            name="admitted.php"
          />
          <RuntimeSurface
            {...rootless}
            groupId="rootless"
            key="rootless"
            name="foreign.php"
          />
        </EditorRuntimeHost>,
      );
    });

    expect(monaco.editor.getModels).toHaveBeenCalledTimes(
      modelReadsAfterAdmission,
    );
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-group='rootless']")
        ?.click();
    });

    expect(monaco.editor.getModels).toHaveBeenCalledTimes(
      modelReadsAfterAdmission,
    );
    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe(
      "admitted.php",
    );
    expect(foreignModel.dispose).not.toHaveBeenCalled();
  });

  it("activates only a rootless registration's workspace on its same-id transition", async () => {
    const workspaceModel = runtimeModel(
      "/workspace",
      "/workspace/shared.php",
    );
    const foreignModel = runtimeModel("/foreign", "/foreign/shared.php");
    const monaco = runtimeMonaco([workspaceModel, foreignModel]);
    const pending = runtimeFixture(
      null,
      monaco,
      workspaceModel,
      "/workspace/shared.php",
    );

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

    expect(monaco.editor.getModels).not.toHaveBeenCalled();
    expect(monaco.editor.setModelMarkers).not.toHaveBeenCalled();
    expect(runtimeMocks.registerLanguage).not.toHaveBeenCalled();
    expect(workspaceModel.dispose).not.toHaveBeenCalled();
    expect(foreignModel.dispose).not.toHaveBeenCalled();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-transition='pending']")
        ?.click();
    });

    expect(runtimeMocks.registerLanguage).toHaveBeenCalledTimes(1);
    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(
      workspaceModel,
      "php-language-server",
      expect.any(Array),
    );
    expect(
      vi.mocked(monaco.editor.setModelMarkers).mock.calls.some(
        ([model]) => model === foreignModel,
      ),
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
          <RuntimeSurface
            {...canonical}
            groupId="canonical"
            key="canonical"
            name="canonical.php"
          />
          <RuntimeSurface
            {...trailingSlashAlias}
            groupId="alias"
            key="alias"
            name="alias.php"
          />
        </EditorRuntimeHost>,
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-group='alias']")?.click();
    });

    expect(runtimeMocks.providerContext?.getActiveDocument()?.name).toBe(
      "alias.php",
    );
    expect(model.dispose).not.toHaveBeenCalled();
  });
});

function RuntimeSurface({
  groupId,
  featuresGateway,
  leftEditor,
  model,
  monaco,
  name,
  path,
  rightEditor,
  transitionWorkspaceRoot,
  workspaceRoot,
}: ReturnType<typeof runtimeFixture> & {
  groupId: string;
  name: string;
  transitionWorkspaceRoot?: string;
}) {
  const runtime = useEditorRuntimeContext();
  const registrationRef = useRef<EditorRuntimeSurfaceRegistration | null>(null);
  const document: EditorDocument = {
    content: "<?php",
    language: "php",
    name,
    path,
    savedContent: "<?php",
  };

  useEffect(() => {
    const currentRef = { current: document };
    const providerRefs = providerRefsFor(currentRef);
    const registration = {
      activePath: document.path,
      diagnosticsByPath: {
        [document.path]: [
          { character: 0, line: 0, message: "warning", severity: "warning" },
        ],
      },
      editor: (groupId === "left" ? leftEditor : rightEditor) as never,
      groupId,
      monacoApi: monaco,
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
      workspaceIdentityDescriptor: null,
      workspaceRoot,
    } as unknown as EditorRuntimeSurfaceRegistration;
    registrationRef.current = registration;

    return runtime?.registerSurface(groupId, registration);
  }, [
    document.path,
    featuresGateway,
    groupId,
    leftEditor,
    model,
    monaco,
    rightEditor,
    runtime,
    workspaceRoot,
  ]);

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
    </>
  );
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
  const leftEditor = { focus: vi.fn(), getModel: vi.fn(() => model) };
  const rightEditor = { focus: vi.fn(), getModel: vi.fn(() => model) };
  const monaco = monacoOverride ?? runtimeMonaco([model]);

  return {
    featuresGateway: {},
    leftEditor,
    model,
    monaco,
    path,
    rightEditor,
    workspaceRoot,
  };
}

function providerRefsFor(
  activeDocumentRef: { current: EditorDocument },
): EditorRuntimeSurfaceRouting["providerRefs"] {
  return new Proxy({} as Record<string, { current: unknown }>, {
    get(_target, property) {
      if (property === "activeDocumentRef") {
        return activeDocumentRef;
      }
      return { current: vi.fn() };
    },
  }) as unknown as EditorRuntimeSurfaceRouting["providerRefs"];
}

function runtimeModel(workspaceRoot: string, path: string) {
  let disposed = false;
  return {
    dispose: vi.fn(() => {
      disposed = true;
    }),
    getValue: vi.fn(() => {
      if (disposed) {
        throw new Error("Model is disposed!");
      }
      return "<?php";
    }),
    isDisposed: vi.fn(() => disposed),
    uri: URI.parse(workspaceModelUri(workspaceRoot, path)!),
  } as unknown as Monaco.editor.ITextModel;
}

function runtimeMonaco(models: readonly Monaco.editor.ITextModel[]) {
  return {
    editor: {
      getModels: vi.fn(() => [...models]),
      setModelMarkers: vi.fn(),
    },
  } as unknown as typeof Monaco;
}

function animationFrameFixture() {
  let nextFrameId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    callbacks.set(frameId, callback);
    return frameId;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((frameId: number) => {
    callbacks.delete(frameId);
  }));

  return {
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(performance.now()));
    },
  };
}
