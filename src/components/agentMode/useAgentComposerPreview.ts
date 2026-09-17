import { useCallback, useEffect, useState } from "react";
import type { AgentComposerAttachmentDraft } from "../../application/useAgentComposerAttachments";
import type { AgentTurnAttachmentImagePort } from "./AgentTurnAttachments";
import type { AgentAttachmentLightboxEntry } from "./useAgentAttachmentLightbox";

interface Preview {
  readonly entry: AgentAttachmentLightboxEntry;
  readonly urls: ReadonlyMap<string, string>;
}

export function useAgentComposerPreview(drafts: ReadonlyArray<AgentComposerAttachmentDraft>) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const close = useCallback(() => setPreview(null), []);
  const current =
    preview !== null &&
    [...preview.urls].every(([id, url]) =>
      drafts.some(
        (draft) => draft.draftId === id && draft.previewUrl === url && draft.state === "ready",
      ),
    );
  useEffect(() => {
    if (!current) close();
  }, [close, current]);

  const images: AgentTurnAttachmentImagePort = {
    stateOf: (id) => {
      const url = current ? preview?.urls.get(id) : undefined;
      return url === undefined ? undefined : { kind: "ready", url };
    },
    ensure: () => undefined,
    reveal: () => undefined,
  };
  const open = (draft: AgentComposerAttachmentDraft, origin: HTMLElement): void => {
    const ready = drafts.filter(
      (item) => item.kind === "image" && item.state === "ready" && item.previewUrl !== null,
    );
    const index = ready.findIndex((item) => item === draft);
    if (index < 0) return;
    setPreview({
      urls: new Map(ready.map((item) => [item.draftId, item.previewUrl!])),
      entry: {
        origin,
        host: origin.closest(".workbench-frame") ?? document.body,
        index,
        items: ready.map((item) => ({
          workspaceId: "draft",
          threadId: "draft",
          attachmentId: item.draftId,
          name: item.name,
          width: item.width ?? undefined,
          height: item.height ?? undefined,
        })),
      },
    });
  };
  const select = (index: number): void => {
    if (!current || !Number.isInteger(index)) return;
    setPreview((state) =>
      state?.entry.items[index] === undefined
        ? state
        : {
            ...state,
            entry: { ...state.entry, index },
          },
    );
  };
  return { entry: current ? (preview?.entry ?? null) : null, images, open, close, select };
}
