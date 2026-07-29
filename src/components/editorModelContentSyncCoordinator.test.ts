import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type {
  LiveModelRevision,
  LiveModelSourceHandle,
} from "../application/liveModelIngressCoordinator";
import { LEGACY_REQUIRED_EDITOR_LIVE_EDIT } from "../application/editorLiveEditArbitration";
import { EditorModelContentSyncCoordinator } from "./editorModelContentSyncCoordinator";

describe("EditorModelContentSyncCoordinator", () => {
  it.each([1, 2, 4])("routes one model edit exactly once across %i visible panes", (paneCount) => {
    const fixture = contentSyncFixture("/workspace/shared.ts", "before");
    const onChange = vi.fn();
    const coordinator = new EditorModelContentSyncCoordinator();

    coordinator.update(
      Array.from({ length: paneCount }, (_, index) => ({
        activePath: "/workspace/shared.ts",
        editor: fixture.editor(),
        getModel: () => fixture.model,
        groupId: `group-${index}`,
        onChange,
      })),
      "group-0",
    );

    expect(fixture.onDidChangeModelContent).toHaveBeenCalledTimes(1);
    fixture.edit("after");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("after");
  });

  it("keeps the latest callback and disposes once across unmount and remount", () => {
    const fixture = contentSyncFixture("/workspace/shared.ts", "before");
    const firstOnChange = vi.fn();
    const latestOnChange = vi.fn();
    const coordinator = new EditorModelContentSyncCoordinator();
    const editor = fixture.editor();

    coordinator.update(
      [
        {
          activePath: "/workspace/shared.ts",
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          onChange: firstOnChange,
        },
      ],
      "left",
    );
    coordinator.update(
      [
        {
          activePath: "/workspace/shared.ts",
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          onChange: latestOnChange,
        },
      ],
      "left",
    );
    fixture.edit("current");
    expect(firstOnChange).not.toHaveBeenCalled();
    expect(latestOnChange).toHaveBeenCalledOnce();

    coordinator.update([], null);
    expect(fixture.modelDispose).toHaveBeenCalledOnce();
    coordinator.update(
      [
        {
          activePath: "/workspace/shared.ts",
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          onChange: latestOnChange,
        },
      ],
      "left",
    );
    expect(fixture.onDidChangeModelContent).toHaveBeenCalledTimes(2);
    coordinator.dispose();
    expect(fixture.modelDispose).toHaveBeenCalledTimes(2);
  });

  it("disposes the old path/model once and subscribes to the replacement once", () => {
    const first = contentSyncFixture("/workspace/first.ts", "first");
    const second = contentSyncFixture("/workspace/second.ts", "second");
    const onChange = vi.fn();
    const coordinator = new EditorModelContentSyncCoordinator();
    const editor = first.switchableEditor();
    const firstBinding = Object.freeze({});
    const secondBinding = Object.freeze({});

    coordinator.update(
      [
        {
          activePath: "/workspace/first.ts",
          boundModel: first.model,
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          modelBindingAuthority: firstBinding,
          onChange,
        },
      ],
      "left",
    );
    editor.setModel(second.model);
    coordinator.update(
      [
        {
          activePath: "/workspace/second.ts",
          boundModel: second.model,
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          modelBindingAuthority: secondBinding,
          onChange,
        },
      ],
      "left",
    );

    expect(first.modelDispose).toHaveBeenCalledOnce();
    expect(first.onDidChangeModelContent).toHaveBeenCalledTimes(2);
    second.edit("second edited");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("suspends a replacement model until an explicit registration update", () => {
    const first = contentSyncFixture("/workspace/first.ts", "first");
    const second = contentSyncFixture("/workspace/second.ts", "second");
    const onChange = vi.fn();
    const coordinator = new EditorModelContentSyncCoordinator();
    const editor = first.switchableEditor();
    const firstBinding = Object.freeze({});
    const secondBinding = Object.freeze({});
    coordinator.update(
      [
        {
          activePath: "/workspace/first.ts",
          boundModel: first.model,
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          modelBindingAuthority: firstBinding,
          onChange,
        },
      ],
      "left",
    );

    editor.setModel(second.model);
    second.edit("gap edit");
    expect(onChange).not.toHaveBeenCalled();

    coordinator.update(
      [
        {
          activePath: "/workspace/first.ts",
          boundModel: first.model,
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          modelBindingAuthority: firstBinding,
          onChange,
        },
      ],
      "left",
    );
    second.edit("after stale update");
    expect(onChange).not.toHaveBeenCalled();

    coordinator.update(
      [
        {
          activePath: "/workspace/second.ts",
          boundModel: second.model,
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          modelBindingAuthority: secondBinding,
          onChange,
        },
      ],
      "left",
    );
    second.edit("after update");
    expect(onChange).toHaveBeenCalledWith("after update");

    onChange.mockClear();
    editor.setModel(first.model);
    coordinator.update(
      [
        {
          activePath: "/workspace/second.ts",
          boundModel: second.model,
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          modelBindingAuthority: secondBinding,
          onChange,
        },
      ],
      "left",
    );
    first.edit("after stale B update");
    expect(onChange).not.toHaveBeenCalled();

    coordinator.update(
      [
        {
          activePath: "/workspace/first.ts",
          boundModel: first.model,
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          modelBindingAuthority: firstBinding,
          onChange,
        },
      ],
      "left",
    );
    first.edit("after A rebound");
    expect(onChange).toHaveBeenCalledWith("after A rebound");
  });

  it("ignores a stale model-change callback after editor disposal", () => {
    const first = contentSyncFixture("/workspace/first.ts", "first");
    const second = contentSyncFixture("/workspace/second.ts", "second");
    const editor = first.switchableEditor();
    const coordinator = new EditorModelContentSyncCoordinator();
    coordinator.update(
      [
        {
          activePath: "/workspace/first.ts",
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          onChange: vi.fn(),
        },
      ],
      "left",
    );
    coordinator.update([], null);

    editor.setModel(second.model);
    editor.emitStaleModelChange();

    expect(first.onDidChangeModelContent).toHaveBeenCalledOnce();
    expect(first.modelDispose).toHaveBeenCalledOnce();
  });

  it("resumes an exact coalesced A-B-A return without intermediate metadata", () => {
    const first = contentSyncFixture("/workspace/first.ts", "first");
    const second = contentSyncFixture("/workspace/second.ts", "second");
    const editor = first.switchableEditor();
    const onChange = vi.fn();
    const coordinator = new EditorModelContentSyncCoordinator();
    const firstBinding = Object.freeze({});
    coordinator.update(
      [
        {
          activePath: "/workspace/first.ts",
          boundModel: first.model,
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          modelBindingAuthority: firstBinding,
          onChange,
        },
      ],
      "left",
    );

    editor.setModel(second.model);
    editor.setModel(first.model);
    coordinator.update(
      [
        {
          activePath: "/workspace/first.ts",
          boundModel: first.model,
          editor,
          getModel: () => editor.getModel(),
          groupId: "left",
          modelBindingAuthority: firstBinding,
          onChange,
        },
      ],
      "left",
    );
    first.edit("after coalesced return");

    expect(onChange).toHaveBeenCalledWith("after coalesced return");
  });

  it("promotes the remaining editor listener when the canonical pane is removed", () => {
    const fixture = contentSyncFixture("/workspace/shared.ts", "before");
    const firstEditor = fixture.editor();
    const secondEditor = fixture.editor();
    const firstChange = vi.fn();
    const secondChange = vi.fn();
    const coordinator = new EditorModelContentSyncCoordinator();
    coordinator.update(
      [
        {
          activePath: "/workspace/shared.ts",
          editor: firstEditor,
          getModel: () => firstEditor.getModel(),
          groupId: "left",
          onChange: firstChange,
        },
        {
          activePath: "/workspace/shared.ts",
          editor: secondEditor,
          getModel: () => secondEditor.getModel(),
          groupId: "right",
          onChange: secondChange,
        },
      ],
      "left",
    );

    coordinator.update(
      [
        {
          activePath: "/workspace/shared.ts",
          editor: secondEditor,
          getModel: () => secondEditor.getModel(),
          groupId: "right",
          onChange: secondChange,
        },
      ],
      "right",
    );
    fixture.edit("after");

    expect(fixture.onDidChangeModelContent).toHaveBeenCalledTimes(2);
    expect(fixture.modelDispose).toHaveBeenCalledOnce();
    expect(firstChange).not.toHaveBeenCalled();
    expect(secondChange).toHaveBeenCalledWith("after");
  });

  it.each([1, 2, 4])(
    "records one bounded delta before the legacy read across %i visible panes",
    (paneCount) => {
      const fixture = contentSyncFixture("/workspace/shared.ts", "a");
      const order: string[] = [];
      const revision = liveRevision(2, 2);
      const ingress = liveHandle("committed", revision, order);
      const onLiveRevision = vi.fn();
      const inactiveObservers = Array.from({ length: Math.max(0, paneCount - 1) }, () => vi.fn());
      const coordinator = new EditorModelContentSyncCoordinator();

      coordinator.update(
        Array.from({ length: paneCount }, (_, index) => ({
          activePath: "/workspace/shared.ts",
          editor: fixture.editor(),
          getModel: () => fixture.model,
          groupId: `group-${index}`,
          liveIngress: ingress,
          onChange: () => {
            order.push("legacy");
          },
          onLiveRevision: index === 0 ? onLiveRevision : inactiveObservers[index - 1],
        })),
        "group-0",
      );

      fixture.edit("ab");

      expect(fixture.onDidChangeModelContent).toHaveBeenCalledOnce();
      expect(ingress.recordChange).toHaveBeenCalledOnce();
      expect(fixture.getValue).toHaveBeenCalledOnce();
      expect(order).toEqual(["live", "legacy"]);
      expect(onLiveRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          contentEvent: expect.objectContaining({
            alternativeVersionId: 2,
            eol: "\n",
            versionId: 2,
          }),
          groupId: "group-0",
          path: "/workspace/shared.ts",
          revision,
          sourceHandleAuthority: ingress.handleAuthority,
        }),
      );
      for (const observer of inactiveObservers) {
        expect(observer).not.toHaveBeenCalled();
      }
    },
  );

  it("contains shadow ingress failures and preserves the legacy path", () => {
    const fixture = contentSyncFixture("/workspace/shared.ts", "a");
    const onChange = vi.fn();
    const ingress = liveHandle("throw", liveRevision(2, 2));
    const coordinator = new EditorModelContentSyncCoordinator();

    coordinator.update(
      [
        {
          activePath: "/workspace/shared.ts",
          editor: fixture.editor(),
          getModel: () => fixture.model,
          groupId: "left",
          liveIngress: ingress,
          onChange,
        },
      ],
      "left",
    );
    fixture.edit("ab");

    expect(ingress.recordChange).toHaveBeenCalledOnce();
    expect(fixture.getValue).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("ab");
  });

  it("contains throwing compact revision inspection after a committed delta", () => {
    const fixture = contentSyncFixture("/workspace/shared.ts", "a");
    const onChange = vi.fn();
    const onLiveRevision = vi.fn();
    const ingress = liveHandle("committed", liveRevision(2, 2));
    vi.mocked(ingress.currentRevision).mockImplementation(() => {
      throw new Error("revision inspection failed");
    });
    const coordinator = new EditorModelContentSyncCoordinator();
    coordinator.update(
      [
        {
          activePath: "/workspace/shared.ts",
          editor: fixture.editor(),
          getModel: () => fixture.model,
          groupId: "left",
          liveIngress: ingress,
          onChange,
          onLiveRevision,
        },
      ],
      "left",
    );

    expect(() => fixture.edit("ab")).not.toThrow();
    expect(ingress.recordChange).toHaveBeenCalledOnce();
    expect(fixture.getValue).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("ab");
    expect(onLiveRevision).not.toHaveBeenCalled();
  });

  it("publishes compact revisions before legacy delivery under reentrant edits", () => {
    const fixture = contentSyncFixture("/workspace/shared.ts", "a");
    const values: string[] = [];
    let revision = liveRevision(1, 1);
    const ingress = liveHandle("committed", revision);
    vi.mocked(ingress.recordChange).mockImplementation((event) => {
      revision = liveRevision(event.modelVersionId, event.postUtf16Length);
      vi.mocked(ingress.currentRevision).mockReturnValue(revision);
      return { revision, status: "committed" };
    });
    const onLiveRevision = vi.fn(() => {
      if (onLiveRevision.mock.calls.length === 1) {
        fixture.append("c");
      }
      return LEGACY_REQUIRED_EDITOR_LIVE_EDIT;
    });
    const coordinator = new EditorModelContentSyncCoordinator();
    coordinator.update(
      [
        {
          activePath: "/workspace/shared.ts",
          editor: fixture.editor(),
          getModel: () => fixture.model,
          groupId: "left",
          liveIngress: ingress,
          onChange: (content) => {
            values.push(content);
          },
          onLiveRevision,
        },
      ],
      "left",
    );

    fixture.edit("ab");

    expect(values).toEqual(["abc", "abc"]);
    expect(onLiveRevision).toHaveBeenCalledTimes(2);
  });

  it("does not publish a foreign focused handle at the same numeric revision", () => {
    const fixture = contentSyncFixture("/workspace/shared.ts", "a");
    const committed = liveHandle("committed", liveRevision(2, 2));
    const foreign = liveHandle("stale", liveRevision(2, 2));
    const foreignObserver = vi.fn();
    const coordinator = new EditorModelContentSyncCoordinator();
    coordinator.update(
      [
        {
          activePath: "/workspace/shared.ts",
          editor: fixture.editor(),
          getModel: () => fixture.model,
          groupId: "left",
          liveIngress: committed,
          onChange: vi.fn(),
        },
        {
          activePath: "/workspace/shared.ts",
          editor: fixture.editor(),
          getModel: () => fixture.model,
          groupId: "right",
          liveIngress: foreign,
          onChange: vi.fn(),
          onLiveRevision: foreignObserver,
        },
      ],
      "right",
    );

    fixture.edit("ab");

    expect(committed.recordChange).toHaveBeenCalledOnce();
    expect(foreign.recordChange).not.toHaveBeenCalled();
    expect(foreignObserver).not.toHaveBeenCalled();
  });

  it("publishes through the focused joined handle for the same exact channel", () => {
    const fixture = contentSyncFixture("/workspace/shared.ts", "a");
    const channelAuthority = Object.freeze({});
    const modelAuthority = Object.freeze({});
    const committed = liveHandle(
      "committed",
      liveRevision(2, 2),
      [],
      channelAuthority,
      modelAuthority,
    );
    const joined = liveHandle("stale", liveRevision(2, 2), [], channelAuthority, modelAuthority);
    const joinedObserver = vi.fn();
    const coordinator = new EditorModelContentSyncCoordinator();
    coordinator.update(
      [
        {
          activePath: "/workspace/shared.ts",
          editor: fixture.editor(),
          getModel: () => fixture.model,
          groupId: "left",
          liveIngress: committed,
          onChange: vi.fn(),
        },
        {
          activePath: "/workspace/shared.ts",
          editor: fixture.editor(),
          getModel: () => fixture.model,
          groupId: "right",
          liveIngress: joined,
          onChange: vi.fn(),
          onLiveRevision: joinedObserver,
        },
      ],
      "right",
    );

    fixture.edit("ab");

    expect(joinedObserver).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceHandleAuthority: joined.handleAuthority,
      }),
    );
  });

  it("marks a large Monaco event snapshot-required without copying a partial batch", () => {
    const fixture = contentSyncFixture("/workspace/shared.ts", "a");
    const ingress = liveHandle("committed", liveRevision(2, 1));
    const coordinator = new EditorModelContentSyncCoordinator();
    coordinator.update(
      [
        {
          activePath: "/workspace/shared.ts",
          editor: fixture.editor(),
          getModel: () => fixture.model,
          groupId: "left",
          liveIngress: ingress,
          onChange: vi.fn(),
        },
      ],
      "left",
    );
    const event = contentEvent(2, 0, 0, "x");
    fixture.emit({
      ...event,
      changes: Array.from({ length: 100 }, (_, index) => ({
        ...event.changes[0]!,
        rangeOffset: index,
      })),
    });

    expect(ingress.recordChange).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [],
        isFlush: true,
      }),
    );
    const copied = vi.mocked(ingress.recordChange).mock.calls[0]?.[0];
    expect(copied?.changes).toHaveLength(0);
  });

  it("adds zero shadow full-content reads for 100 edits of a 1 MiB model", () => {
    const fixture = contentSyncFixture("/workspace/large.ts", "x".repeat(1024 * 1024));
    let revision = liveRevision(1, 1024 * 1024);
    const ingress = liveHandle("committed", revision);
    vi.mocked(ingress.recordChange).mockImplementation((event) => {
      revision = liveRevision(event.modelVersionId, event.postUtf16Length);
      vi.mocked(ingress.currentRevision).mockReturnValue(revision);
      return { revision, status: "committed" };
    });
    const coordinator = new EditorModelContentSyncCoordinator();
    coordinator.update(
      [
        {
          activePath: "/workspace/large.ts",
          editor: fixture.editor(),
          getModel: () => fixture.model,
          groupId: "left",
          liveIngress: ingress,
          onChange: vi.fn(),
        },
      ],
      "left",
    );

    for (let index = 0; index < 100; index += 1) {
      fixture.append("x");
    }

    expect(ingress.recordChange).toHaveBeenCalledTimes(100);
    expect(fixture.getValue).toHaveBeenCalledTimes(100);
    expect(fixture.getValueLength).toHaveBeenCalledTimes(100);
  });

  it("keeps nested model changes in synchronous delivery order", () => {
    const fixture = contentSyncFixture("/workspace/shared.ts", "a");
    const versions: number[] = [];
    const ingress = liveHandle("committed", liveRevision(2, 2));
    vi.mocked(ingress.recordChange).mockImplementation((event) => {
      versions.push(event.modelVersionId);
      const revision = liveRevision(event.modelVersionId, event.postUtf16Length);
      vi.mocked(ingress.currentRevision).mockReturnValue(revision);
      return { revision, status: "committed" };
    });
    const onChange = vi.fn(() => {
      if (versions.length === 1) {
        fixture.append("c");
      }
    });
    const coordinator = new EditorModelContentSyncCoordinator();
    coordinator.update(
      [
        {
          activePath: "/workspace/shared.ts",
          editor: fixture.editor(),
          getModel: () => fixture.model,
          groupId: "left",
          liveIngress: ingress,
          onChange,
        },
      ],
      "left",
    );

    fixture.append("b");

    expect(versions).toEqual([2, 3]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

interface EditorContentListener {
  readonly currentModel: () => Monaco.editor.ITextModel;
  readonly handler: (event: Monaco.editor.IModelContentChangedEvent) => void;
}

const editorContentListeners = new Set<EditorContentListener>();

function emitModelContent(
  model: Monaco.editor.ITextModel,
  event: Monaco.editor.IModelContentChangedEvent,
): void {
  for (const listener of [...editorContentListeners]) {
    if (listener.currentModel() === model) {
      listener.handler(event);
    }
  }
}

function contentSyncFixture(path: string, initialValue: string) {
  let value = initialValue;
  let version = 1;
  const modelDispose = vi.fn();
  const onDidChangeModelContent = vi.fn();
  const getValue = vi.fn(() => value);
  const getValueLength = vi.fn(() => value.length);
  const model = {
    getAlternativeVersionId: vi.fn(() => version),
    getValue,
    getValueLength,
    getVersionId: vi.fn(() => version),
    uri: { path },
  } as unknown as Monaco.editor.ITextModel;

  const switchableEditor = () => {
    let currentModel = model;
    let modelHandler: (() => void) | null = null;
    let lastModelHandler: (() => void) | null = null;
    return {
      emitStaleModelChange() {
        lastModelHandler?.();
      },
      getModel: vi.fn(() => currentModel),
      onDidChangeModelContent: vi.fn(
        (handler: (event: Monaco.editor.IModelContentChangedEvent) => void) => {
          onDidChangeModelContent();
          const listener = {
            currentModel: () => currentModel,
            handler,
          };
          editorContentListeners.add(listener);
          let active = true;
          return {
            dispose: () => {
              if (!active) {
                return;
              }
              active = false;
              editorContentListeners.delete(listener);
              modelDispose();
            },
          };
        },
      ),
      onDidChangeModel: vi.fn((handler: () => void) => {
        modelHandler = handler;
        lastModelHandler = handler;
        return {
          dispose: vi.fn(() => {
            modelHandler = null;
          }),
        };
      }),
      setModel(next: Monaco.editor.ITextModel) {
        currentModel = next;
        modelHandler?.();
      },
    } as unknown as Monaco.editor.IStandaloneCodeEditor & {
      emitStaleModelChange(): void;
      setModel(next: Monaco.editor.ITextModel): void;
    };
  };

  return {
    edit(next: string) {
      const previousLength = value.length;
      value = next;
      version += 1;
      emitModelContent(model, contentEvent(version, 0, previousLength, next));
    },
    append(text: string) {
      const rangeOffset = value.length;
      value += text;
      version += 1;
      emitModelContent(model, contentEvent(version, rangeOffset, 0, text));
    },
    emit(event: Monaco.editor.IModelContentChangedEvent) {
      emitModelContent(model, event);
    },
    editor: switchableEditor,
    getValue,
    getValueLength,
    model,
    modelDispose,
    onDidChangeModelContent,
    switchableEditor,
  };
}

function contentEvent(
  versionId: number,
  rangeOffset: number,
  rangeLength: number,
  text: string,
): Monaco.editor.IModelContentChangedEvent {
  return {
    changes: [
      {
        range: {
          endColumn: rangeLength + 1,
          endLineNumber: 1,
          startColumn: 1,
          startLineNumber: 1,
        },
        rangeLength,
        rangeOffset,
        text,
      },
    ],
    detailedReasonsChangeLengths: [],
    eol: "\n",
    isEolChange: false,
    isFlush: false,
    isRedoing: false,
    isUndoing: false,
    versionId,
  };
}

function liveRevision(modelVersionId: number, utf16Length: number): LiveModelRevision {
  return Object.freeze({
    alternativeVersionId: modelVersionId,
    contentVersion: modelVersionId,
    mode: "incremental",
    modelVersionId,
    utf16Length,
  });
}

function liveHandle(
  behavior: "committed" | "stale" | "throw",
  revision: LiveModelRevision,
  order: string[] = [],
  channelAuthority: object = Object.freeze({}),
  modelAuthority: object = Object.freeze({}),
): LiveModelSourceHandle {
  const recordChange = vi.fn(() => {
    order.push("live");
    if (behavior === "throw") {
      throw new Error("shadow ingress failed");
    }
    return behavior === "committed"
      ? ({ revision, status: "committed" } as const)
      : ({ status: "stale" } as const);
  });
  return {
    channelAuthority,
    currentRevision: vi.fn(() => revision),
    handleAuthority: Object.freeze({}),
    modelAuthority,
    recordChange,
    release: vi.fn(() => ({ status: "released" }) as const),
  };
}
