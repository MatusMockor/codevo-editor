import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { detectKeymapPlatform } from "../../domain/keymap";
import { monacoDefaultEditorCommandsForKeybinding } from "../../infrastructure/monacoWorkbenchPolicy";
import {
  installDiffEditorKeymapBridge,
  onDiffEditorDisposed,
  type CodevoEditorKeymapHostActions,
} from "./installCodevoEditorKeymapBridge";
import {
  SecondaryEditorKeymapContext,
  type SecondaryEditorKeymapBinding,
} from "./secondaryEditorKeymapContext";

interface MountedDiffEditor {
  readonly editor: Monaco.editor.IStandaloneDiffEditor;
  readonly monaco: typeof Monaco;
}

export type AttachDiffEditorKeymapBridge = (
  editor: Monaco.editor.IStandaloneDiffEditor,
  monaco: typeof Monaco,
) => void;

interface BridgeInstallation extends Monaco.IDisposable {
  readonly binding: SecondaryEditorKeymapBinding;
}

const NO_HOST_ACTIONS: CodevoEditorKeymapHostActions = Object.freeze({});

export function useDiffEditorKeymapBridge(
  hostActions: CodevoEditorKeymapHostActions = NO_HOST_ACTIONS,
): AttachDiffEditorKeymapBridge {
  const binding = useContext(SecondaryEditorKeymapContext);
  const bindingRef = useRef(binding);
  const hostRef = useRef(hostActions);
  const targetRef = useRef<MountedDiffEditor | null>(null);
  const installationRef = useRef<BridgeInstallation | null>(null);
  useLayoutEffect(() => {
    hostRef.current = hostActions;
  });

  const release = useCallback(() => {
    installationRef.current?.dispose();
    installationRef.current = null;
  }, []);

  const install = useCallback(() => {
    release();
    const target = targetRef.current;
    const current = bindingRef.current;
    if (!target || !current) return;
    const bridge = installDiffEditorKeymapBridge(target.editor, {
      commandRunnerRef: { current: current.runCommand },
      defaultEditorCommandsForKeybinding: monacoDefaultEditorCommandsForKeybinding,
      hostRef,
      keymap: current.keymap,
      keymapPlatform: detectKeymapPlatform(),
      monaco: target.monaco,
    });
    const editorDisposal = onDiffEditorDisposed(target.editor, () => {
      if (targetRef.current === target) targetRef.current = null;
      release();
    });
    installationRef.current = {
      binding: current,
      dispose: () => {
        editorDisposal.dispose();
        bridge.dispose();
      },
    };
  }, [release]);

  useEffect(() => {
    bindingRef.current = binding;
    if (installationRef.current?.binding !== binding) install();
    return release;
  }, [binding, install, release]);

  return useCallback<AttachDiffEditorKeymapBridge>(
    (editor, monaco) => {
      const current = targetRef.current;
      if (current?.editor === editor && current.monaco === monaco) return;
      targetRef.current = { editor, monaco };
      install();
    },
    [install],
  );
}
