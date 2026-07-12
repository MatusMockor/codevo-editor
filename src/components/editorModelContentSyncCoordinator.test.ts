import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { EditorModelContentSyncCoordinator } from "./editorModelContentSyncCoordinator";

describe("EditorModelContentSyncCoordinator", () => {
  it.each([1, 2, 4])(
    "routes one model edit exactly once across %i visible panes",
    (paneCount) => {
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

      expect(fixture.onDidChangeContent).toHaveBeenCalledTimes(1);
      fixture.edit("after");
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("after");
    },
  );

  it("keeps the latest callback and disposes once across unmount and remount", () => {
    const fixture = contentSyncFixture("/workspace/shared.ts", "before");
    const firstOnChange = vi.fn();
    const latestOnChange = vi.fn();
    const coordinator = new EditorModelContentSyncCoordinator();
    const editor = fixture.editor();

    coordinator.update(
      [{ activePath: "/workspace/shared.ts", editor, getModel: () => editor.getModel(), groupId: "left", onChange: firstOnChange }],
      "left",
    );
    coordinator.update(
      [{ activePath: "/workspace/shared.ts", editor, getModel: () => editor.getModel(), groupId: "left", onChange: latestOnChange }],
      "left",
    );
    fixture.edit("current");
    expect(firstOnChange).not.toHaveBeenCalled();
    expect(latestOnChange).toHaveBeenCalledOnce();

    coordinator.update([], null);
    expect(fixture.modelDispose).toHaveBeenCalledOnce();
    coordinator.update(
      [{ activePath: "/workspace/shared.ts", editor, getModel: () => editor.getModel(), groupId: "left", onChange: latestOnChange }],
      "left",
    );
    expect(fixture.onDidChangeContent).toHaveBeenCalledTimes(2);
    coordinator.dispose();
    expect(fixture.modelDispose).toHaveBeenCalledTimes(2);
  });

  it("disposes the old path/model once and subscribes to the replacement once", () => {
    const first = contentSyncFixture("/workspace/first.ts", "first");
    const second = contentSyncFixture("/workspace/second.ts", "second");
    const onChange = vi.fn();
    const coordinator = new EditorModelContentSyncCoordinator();
    const editor = first.switchableEditor();

    coordinator.update(
      [{ activePath: "/workspace/first.ts", editor, getModel: () => editor.getModel(), groupId: "left", onChange }],
      "left",
    );
    editor.setModel(second.model);
    coordinator.update(
      [{ activePath: "/workspace/second.ts", editor, getModel: () => editor.getModel(), groupId: "left", onChange }],
      "left",
    );

    expect(first.modelDispose).toHaveBeenCalledOnce();
    expect(second.onDidChangeContent).toHaveBeenCalledOnce();
    second.edit("second edited");
    expect(onChange).toHaveBeenCalledOnce();
  });
});

function contentSyncFixture(path: string, initialValue: string) {
  let value = initialValue;
  let contentHandler: (() => void) | null = null;
  const modelDispose = vi.fn(() => {
    contentHandler = null;
  });
  const onDidChangeContent = vi.fn((handler: () => void) => {
    contentHandler = handler;
    return { dispose: modelDispose };
  });
  const model = {
    getValue: vi.fn(() => value),
    onDidChangeContent,
    uri: { path },
  } as unknown as Monaco.editor.ITextModel;

  const switchableEditor = () => {
    let currentModel = model;
    let modelHandler: (() => void) | null = null;
    return {
      getModel: vi.fn(() => currentModel),
      onDidChangeModel: vi.fn((handler: () => void) => {
        modelHandler = handler;
        return { dispose: vi.fn(() => { modelHandler = null; }) };
      }),
      setModel(next: Monaco.editor.ITextModel) {
        currentModel = next;
        modelHandler?.();
      },
    } as unknown as Monaco.editor.IStandaloneCodeEditor & {
      setModel(next: Monaco.editor.ITextModel): void;
    };
  };

  return {
    edit(next: string) {
      value = next;
      contentHandler?.();
    },
    editor: switchableEditor,
    model,
    modelDispose,
    onDidChangeContent,
    switchableEditor,
  };
}
