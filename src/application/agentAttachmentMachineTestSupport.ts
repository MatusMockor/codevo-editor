import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, vi } from "vitest";
import type { AgentImageSurfacePort } from "../domain/agentImageShrink";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import {
  useAgentComposerAttachments,
  type AgentAttachmentOwner,
  type AgentAttachmentSource,
  type AgentComposerAttachmentsSurface,
} from "./useAgentComposerAttachments";

export const IMAGE_SURFACE: AgentImageSurfacePort = {
  decode: async () => ({ width: 10, height: 10 }),
  encodeMime: async () => "image/png",
  encode: async () => new ArrayBuffer(4),
  release: () => undefined,
};

export interface Gate {
  readonly promise: Promise<void>;
  open(): void;
}

export function gate(): Gate {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

export interface Machine {
  readonly gateway: AgentAttachmentGateway;
  readonly owners: Map<string, AgentAttachmentOwner>;
  readonly staged: { readonly workspaceId: string; readonly attachmentId: string }[];
  readonly released: string[];
  readonly issued: string[];
  readonly revoked: string[];
  readonly errors: unknown[];
  stageError: Error | null;
  stageGate: Gate | null;
  stagedBytes: number | null;
  inspectError: Error | null;
  inspectGate: Gate | null;
  scope(draftKey: string): AgentComposerAttachmentsSurface;
  unmount(): void;
}

export function owner(projectRootKey: string, generation = 1): AgentAttachmentOwner {
  return {
    projectRootKey,
    ownerId: `owner:${projectRootKey}`,
    generation,
    workspaceId: `workspace:${projectRootKey}`,
  };
}

export function mountMachine(name: string, projectRootKey: string): Machine {
  let sequence = 0;
  let surface: AgentComposerAttachmentsSurface | null = null;
  const machine: Machine = {
    owners: new Map([[projectRootKey, owner(projectRootKey)]]),
    staged: [],
    released: [],
    issued: [],
    revoked: [],
    errors: [],
    stageError: null,
    stageGate: null,
    stagedBytes: null,
    inspectError: null,
    inspectGate: null,
    gateway: {
      stageAgentAttachmentBytes: vi.fn(async ({ workspaceId, name: fileName, mime, bytes }) => {
        const held = machine.stageGate;
        if (held !== null) await held.promise;
        if (machine.stageError !== null) return Promise.reject(machine.stageError);
        sequence += 1;
        const attachmentId = `${name}-${sequence}`;
        machine.staged.push({ workspaceId, attachmentId });
        return {
          attachmentId,
          name: fileName,
          mime,
          bytes: machine.stagedBytes ?? bytes.byteLength,
          width: mime === null ? null : 10,
          height: mime === null ? null : 10,
          promptLineBytesMax: 40,
        };
      }),
      inspectAgentAttachmentCandidate: vi.fn(async () => {
        const held = machine.inspectGate;
        if (held !== null) await held.promise;
        if (machine.inspectError !== null) return Promise.reject(machine.inspectError);
        return {
          bytes: 2_048,
          isRegularFile: true,
          isDirectory: false,
          extensionMime: "application/pdf",
        };
      }),
      readAgentAttachmentCandidate: vi.fn(async () => new ArrayBuffer(8)),
      claimAgentAttachments: vi.fn(async () => []),
      releaseAgentAttachment: vi.fn(async ({ attachmentId }) => {
        machine.released.push(attachmentId);
      }),
      readAgentAttachment: vi.fn(async () => new ArrayBuffer(0)),
      revealAgentAttachment: vi.fn(async () => undefined),
    },
    scope: (draftKey) => {
      expect(surface).not.toBeNull();
      const scoped = surface?.forDraft?.(draftKey);
      expect(scoped).toBeDefined();
      return scoped as AgentComposerAttachmentsSurface;
    },
    unmount: () => act(() => root.unmount()),
  };
  let draftSequence = 0;
  function Probe() {
    surface = useAgentComposerAttachments({
      gateway: machine.gateway,
      imageSurface: IMAGE_SURFACE,
      resolveOwner: (key) => machine.owners.get(key) ?? null,
      reportError: (_source, error) => machine.errors.push(error),
      createDraftId: () => `${name}-draft-${(draftSequence += 1)}`,
      createObjectUrl: () => {
        const url = `blob:${name}-${machine.issued.length + 1}`;
        machine.issued.push(url);
        return url;
      },
      revokeObjectUrl: (url) => machine.revoked.push(url),
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return machine;
}

export function image(name = "shot.png"): AgentAttachmentSource {
  return { kind: "bytes", name, mime: "image/png", bytes: new ArrayBuffer(4) };
}

export function textFile(name = "notes.txt"): AgentAttachmentSource {
  return {
    kind: "bytes",
    name,
    mime: "text/plain;charset=utf-8",
    bytes: new TextEncoder().encode("carry me").buffer,
  };
}

export function states(surface: AgentComposerAttachmentsSurface): ReadonlyArray<string> {
  return surface.drafts.map((draft) => `${draft.name}:${draft.state}`);
}

export function settle(assertion: () => void): Promise<void> {
  return act(async () => {
    await vi.waitFor(assertion);
  });
}
