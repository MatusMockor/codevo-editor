import { DiffEditor } from "@monaco-editor/react";
import { useLayoutEffect, useRef, type ComponentProps } from "react";
import type { editor } from "monaco-editor";

export default function RemoteFileComparison(props: ComponentProps<typeof DiffEditor>) {
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  useLayoutEffect(
    () => () => {
      const instance = editorRef.current;
      editorRef.current = null;
      if (!instance) return;
      const models = instance.getModel();
      // Monaco must release its diff observers before either text model is disposed.
      // The React adapter otherwise disposes models before resetting the editor.
      instance.setModel(null);
      if (!models) return;
      if (!models.original.isDisposed()) models.original.dispose();
      if (models.modified !== models.original && !models.modified.isDisposed()) {
        models.modified.dispose();
      }
    },
    [],
  );

  return (
    <DiffEditor
      {...props}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={(instance, monaco) => {
        editorRef.current = instance;
        props.onMount?.(instance, monaco);
      }}
    />
  );
}
