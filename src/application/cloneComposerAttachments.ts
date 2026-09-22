import { MAX_AGENT_TURN_ATTACHMENTS, isAgentImageMime } from "../domain/agentAttachment";
import {
  agentPasteClaim,
  classifyAgentAttachmentCandidate,
  isAttachableAgentReferencePath,
  planAgentAttachmentIntake,
  sanitizeAgentAttachmentName,
} from "../domain/agentAttachmentIntake";
import type {
  AgentAttachmentSource,
  AgentComposerAttachmentDraft,
  AgentComposerAttachmentsSurface,
} from "./useAgentComposerAttachments";

type Mode = "local" | "remote";
interface Entry {
  readonly source: AgentAttachmentSource;
  readonly draft: AgentComposerAttachmentDraft;
}
export interface CloneAttachmentBinding {
  readonly projectKey: string;
  /** Immutable accessor to a dedicated clone-only scope; never an active-project getter. */
  readonly getTarget: () => AgentComposerAttachmentsSurface;
  readonly isCurrent: () => boolean;
}
interface Store {
  readonly mode: Mode;
  readonly entries: Map<string, Entry>;
  refusal: string | null;
  transferring: boolean;
  cleanupTarget: (() => void) | null;
}
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_ENTRIES = 32;
const MAX_CLONES = 32;

/** Owns deferred sources until the clone has an exact registered project identity. */
export function createCloneComposerAttachments() {
  const stores = new Map<string, Store>();
  const bindings = new Map<string, CloneAttachmentBinding>();
  const bindingFor = (key: string) => {
    const binding = bindings.get(key);
    return binding?.isCurrent() ? binding : undefined;
  };
  const listeners = new Set<() => void>();
  let sequence = 0;
  let revision = 0;
  const publish = () => {
    revision += 1;
    listeners.forEach((listener) => listener());
  };
  const retained = () => [...stores.values()].flatMap((store) => [...store.entries.values()]);
  const clear = (store: Store) => {
    store.entries.clear();
    store.refusal = null;
    publish();
  };
  const forClone = (key: string, mode: Mode): AgentComposerAttachmentsSurface => {
    let existing = stores.get(key);
    if (!existing) {
      if (stores.size >= MAX_CLONES) throw new Error("Too many pending clone drafts.");
      existing = {
        mode,
        entries: new Map(),
        refusal: null,
        transferring: false,
        cleanupTarget: null,
      };
      stores.set(key, existing);
    }
    const store = existing;
    if (store.mode !== mode) throw new Error("Clone attachment destination changed.");
    const current = () => stores.get(key) === store;
    const refuse = (reason: string) => {
      if (!current()) return;
      store.refusal = reason;
      publish();
    };
    const add = async (target: string, sources: ReadonlyArray<AgentAttachmentSource>) => {
      if (
        !current() ||
        (target !== key && target !== bindingFor(key)?.projectKey) ||
        store.transferring
      )
        return;
      for (const source of sources.slice(0, MAX_AGENT_TURN_ATTACHMENTS + 1)) {
        const entries = retained();
        if (store.entries.size >= MAX_AGENT_TURN_ATTACHMENTS || entries.length >= MAX_ENTRIES) {
          refuse("Attachment draft storage is full. Remove an attachment first.");
          break;
        }
        if (source.kind === "path" && !isAttachableAgentReferencePath(source.path)) {
          refuse("Path is not attachable.");
          continue;
        }
        const name = sanitizeAgentAttachmentName(
          source.kind === "path" ? source.path : source.name,
        );
        const bytes = source.kind === "bytes" ? source.bytes.byteLength : 0;
        const candidate = {
          name,
          mime: source.kind === "bytes" ? source.mime : "",
          bytes,
          hasPath: source.kind === "path",
        };
        const classified = classifyAgentAttachmentCandidate(candidate);
        const plan = planAgentAttachmentIntake(candidate);
        if (mode === "remote" && (source.kind !== "bytes" || classified.kind !== "image")) {
          refuse("Only images can be attached to a server conversation.");
          continue;
        }
        if (plan.kind === "refused") {
          refuse(plan.reason);
          continue;
        }
        if (entries.reduce((total, entry) => total + entry.draft.bytes, 0) + bytes > MAX_BYTES) {
          refuse("Pending clone attachments exceed 40 MiB. Remove an attachment first.");
          continue;
        }
        const draftId = `clone-attachment-${++sequence}`;
        const mime =
          classified.kind === "image" && isAgentImageMime(classified.mime) ? classified.mime : null;
        // Copy byte buffers: callers cannot mutate a retained source after admission.
        const owned =
          source.kind === "bytes" ? { ...source, bytes: source.bytes.slice(0) } : source;
        store.entries.set(draftId, {
          source: owned,
          draft: {
            draftId,
            kind:
              classified.kind === "image" ? "image" : source.kind === "path" ? "reference" : "file",
            state: "ready",
            name,
            bytes,
            mime,
            width: null,
            height: null,
            attachmentId: null,
            path: null,
            previewUrl: null,
            failure: null,
            notice: "Will attach when cloning finishes",
            missing: false,
            promptLineBytesMax: 0,
          },
        });
      }
      publish();
    };
    return {
      forDraft: () => forClone(key, mode),
      drafts: [
        ...(bindingFor(key)?.getTarget().drafts ?? []),
        ...[...store.entries.values()].map((entry) => entry.draft),
      ],
      projectRootKey: bindingFor(key)?.projectKey ?? key,
      staging: store.transferring || (bindingFor(key)?.getTarget().staging ?? false),
      blocked: store.transferring || (bindingFor(key)?.getTarget().blocked ?? false),
      refusal: store.refusal ?? bindingFor(key)?.getTarget().refusal ?? null,
      promptLineBytes: bindingFor(key)?.getTarget().promptLineBytes ?? 0,
      add,
      captureIntake: (target, isCurrent = () => true) =>
        (target !== key && target !== bindingFor(key)?.projectKey) || !current()
          ? null
          : async (sources) => {
              if (isCurrent()) await add(target, sources);
            },
      claimPaste: agentPasteClaim,
      remove: (id) => {
        if (current() && !store.transferring) {
          if (!store.entries.delete(id)) bindingFor(key)?.getTarget().remove(id);
          publish();
        }
      },
      clear: () => {
        if (current() && !store.transferring) {
          bindingFor(key)?.getTarget().clear();
          clear(store);
        }
      },
      markSent: (ids) => {
        bindingFor(key)?.getTarget().markSent(ids);
        publish();
      },
      refuse,
      dismissRefusal: () => {
        if (current()) {
          store.refusal = null;
          publish();
        }
      },
      prepareTurn: async (projectKey) => {
        const binding = bindingFor(key);
        if (!binding || binding.projectKey !== projectKey) return null;
        const valid = () => bindingFor(key) === binding && current();
        if (!(await coordinator.transfer(key, projectKey, binding.getTarget, valid)) || !valid())
          return null;
        const prepared = await binding.getTarget().prepareTurn(projectKey);
        return valid() ? prepared : null;
      },
    };
  };
  const coordinator = {
    forClone,
    getSnapshot: () => revision,
    bind(key: string, binding: CloneAttachmentBinding | null) {
      if (binding) bindings.set(key, binding);
      else bindings.delete(key);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    removeClone(key: string) {
      stores.get(key)?.cleanupTarget?.();
      bindings.delete(key);
      stores.delete(key);
      publish();
    },
    clear() {
      for (const store of stores.values()) store.cleanupTarget?.();
      bindings.clear();
      stores.clear();
      publish();
    },
    async transfer(
      key: string,
      projectKey: string,
      getTarget: () => AgentComposerAttachmentsSurface,
      isCurrent: () => boolean,
    ): Promise<boolean> {
      const store = stores.get(key);
      if (!store) return true;
      if (store.transferring || !isCurrent()) return false;
      const valid = () => stores.get(key) === store && isCurrent();
      store.transferring = true;
      publish();
      try {
        for (const [id, entry] of store.entries) {
          if (!valid()) return false;
          const target = getTarget();
          store.cleanupTarget = target.clear;
          const previous = new Set(target.drafts.map((draft) => draft.draftId));
          const intake = target.captureIntake?.(projectKey, valid);
          if (!intake) {
            store.refusal = "The attachment draft is unavailable. Try again.";
            return false;
          }
          await intake([entry.source]);
          const settled = getTarget();
          const added = settled.drafts.filter((draft) => !previous.has(draft.draftId));
          if (!valid()) {
            // Compensate only the draft created by this transfer, never unrelated attachments.
            added.forEach((draft) => target.remove(draft.draftId));
            return false;
          }
          if (added.length !== 1 || added[0].state !== "ready") {
            added.forEach((draft) => target.remove(draft.draftId));
            store.refusal =
              settled.refusal ?? "Unable to attach this file. Try again or remove it.";
            return false;
          }
          store.entries.delete(id);
        }
        store.refusal = null;
        return true;
      } catch (error: unknown) {
        if (valid())
          store.refusal = error instanceof Error ? error.message : "Unable to attach this file.";
        return false;
      } finally {
        store.transferring = false;
        publish();
      }
    },
  };
  return coordinator;
}
