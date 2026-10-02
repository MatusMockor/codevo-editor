import Editor from "@monaco-editor/react";
import { useEffect, useState, type ComponentProps } from "react";
import type { editor } from "monaco-editor";
import { revealRemoteEditorLocation, type RemoteEditorRevealTarget } from "./remoteEditorReveal";

export type RemoteFileEditorProps = Omit<ComponentProps<typeof Editor>, "onMount"> & {
  readonly reveal: RemoteEditorRevealTarget | null;
};

export default function RemoteFileEditor({ reveal, ...props }: RemoteFileEditorProps) {
  const [instance, setInstance] = useState<editor.IStandaloneCodeEditor | null>(null);
  useEffect(() => {
    if (instance === null || reveal === null) return;
    revealRemoteEditorLocation(instance, reveal);
  }, [instance, reveal]);
  return <Editor {...props} onMount={setInstance} />;
}
