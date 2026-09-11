import type { AgentAttachmentSource } from "../../application/useAgentComposerAttachments";
import { MAX_AGENT_TURN_ATTACHMENTS } from "../../domain/agentAttachment";
import { planAgentAttachmentIntake } from "../../domain/agentAttachmentIntake";

export const AGENT_ATTACHMENT_PASTE_READ_FAILURE = "The pasted files could not be read.";
export const AGENT_ATTACHMENT_PICKER_FAILURE = "The file picker could not be opened.";
export const AGENT_ATTACHMENT_DROP_UNAVAILABLE = "Drag and drop is unavailable in this window.";

export interface AgentComposerDragDropEvent {
  readonly kind: "over" | "drop" | "leave";
  readonly x: number;
  readonly y: number;
  readonly paths: ReadonlyArray<string>;
}

export type AgentComposerDragDropListener = (event: AgentComposerDragDropEvent) => void;

export type AgentComposerDragDropSubscribe = (
  listener: AgentComposerDragDropListener,
) => Promise<() => void>;

export type AgentComposerFilePicker = () => Promise<ReadonlyArray<string>>;

export const MAX_AGENT_COMPOSER_PASTED_FILES = MAX_AGENT_TURN_ATTACHMENTS + 1;

class AgentAttachmentPasteRefusal extends Error {}

export function agentAttachmentPasteFailureMessage(error: unknown): string {
  return error instanceof AgentAttachmentPasteRefusal
    ? error.message
    : AGENT_ATTACHMENT_PASTE_READ_FAILURE;
}

export function agentAttachmentSourcesFromPaths(
  paths: ReadonlyArray<string>,
): ReadonlyArray<AgentAttachmentSource> {
  return paths.filter((path) => path !== "").map((path) => ({ kind: "path", path }));
}

export async function agentAttachmentSourcesFromFiles(
  files: ReadonlyArray<File>,
): Promise<ReadonlyArray<AgentAttachmentSource>> {
  const admittedFiles = files.slice(0, MAX_AGENT_COMPOSER_PASTED_FILES);
  for (const file of admittedFiles) {
    const plan = planAgentAttachmentIntake({
      name: file.name,
      mime: file.type,
      hasPath: false,
      bytes: file.size,
    });
    if (plan.kind === "refused") throw new AgentAttachmentPasteRefusal(plan.reason);
  }
  const sources: AgentAttachmentSource[] = [];
  for (const file of admittedFiles) {
    sources.push({
      kind: "bytes",
      name: file.name,
      mime: file.type,
      bytes: await file.arrayBuffer(),
    });
  }
  return sources;
}

export async function openAgentAttachmentPicker(): Promise<ReadonlyArray<string>> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple: true, title: "Attach files" });
  if (selected === null) return [];
  if (Array.isArray(selected)) return selected;
  return [selected];
}

export async function subscribeAgentAttachmentDragDrop(
  listener: AgentComposerDragDropListener,
): Promise<() => void> {
  const { isTauri } = await import("@tauri-apps/api/core");
  if (!isTauri()) return () => undefined;
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((event) => {
    listener(dragDropEvent(event.payload));
  });
}

interface TauriDragDropPayload {
  readonly type: string;
  readonly position?: { readonly x: number; readonly y: number };
  readonly paths?: ReadonlyArray<string>;
}

function dragDropEvent(payload: TauriDragDropPayload): AgentComposerDragDropEvent {
  if (payload.type === "leave") return { kind: "leave", x: -1, y: -1, paths: [] };
  const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const position = payload.position ?? { x: -1, y: -1 };
  return {
    kind: payload.type === "drop" ? "drop" : "over",
    x: position.x / ratio,
    y: position.y / ratio,
    paths: payload.type === "drop" ? (payload.paths ?? []) : [],
  };
}
