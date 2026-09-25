import type * as Monaco from "monaco-editor";
import { decideEditorLinkOpen } from "../domain/editorLinkOpenPolicy";

type OpenUrl = (url: string) => Promise<void>;

const openWithTauri: OpenUrl = async (url) => {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
};

export function createMonacoLinkOpener(openUrl: OpenUrl = openWithTauri): {
  open(resource: Monaco.Uri): Promise<boolean>;
} {
  return {
    open: async (resource) => {
      const decision = decideEditorLinkOpen(resource.toString(true));
      if (decision.kind === "delegate-command") return false;
      if (decision.kind === "refuse") return true;
      try {
        await openUrl(decision.url);
      } catch {
        return true;
      }
      return true;
    },
  };
}

export function registerMonacoLinkOpener(
  monaco: typeof Monaco,
  opener: Monaco.editor.ILinkOpener = createMonacoLinkOpener(),
): Monaco.IDisposable | null {
  if (typeof monaco.editor.registerLinkOpener !== "function") return null;
  return monaco.editor.registerLinkOpener(opener);
}
