import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type RefObject,
} from "react";
import type { AgentQuestionAttachments } from "../../application/agentQuestionAttachments";
import type { AgentTurnAttachmentIntent } from "../../application/agentThreadPorts";
import {
  AGENT_ATTACHMENTS_DISCARDED_NOTICE,
  AGENT_ATTACHMENT_UNAVAILABLE_NOTICE,
} from "../../application/agentTurnAttachments";
import type { AgentComposerAttachmentsSurface } from "../../application/useAgentComposerAttachments";
import { agentPasteClaim } from "../../domain/agentAttachmentIntake";
import {
  agentQuestionAnswerWithAttachments,
  type AgentQuestionAnswer,
  type AgentQuestionRequest,
} from "../../domain/agentQuestion";
import {
  AGENT_ATTACHMENT_DROP_UNAVAILABLE,
  agentClipboardFiles,
  type AgentComposerDragDropSubscribe,
  type AgentComposerFilePicker,
} from "./agentComposerAttachmentPorts";
import { useAgentAttachmentIntake } from "./useAgentAttachmentIntake";
import { useAgentComposerDragDrop } from "./useAgentComposerDragDrop";

export type AgentQuestionAttachmentResolution =
  | { readonly kind: "ready"; readonly answers: readonly AgentQuestionAnswer[] }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "abandoned" };

export interface AgentQuestionAttachmentsOptions {
  readonly capability: AgentQuestionAttachments | null;
  readonly unavailableReason: string;
  readonly request: AgentQuestionRequest;
  readonly questionId: string;
  readonly enabled: boolean;
  readonly busy: boolean;
  readonly picker: AgentComposerFilePicker;
  readonly dragDrop: AgentComposerDragDropSubscribe;
  readonly dropTarget: RefObject<HTMLElement | null>;
}

export interface AgentQuestionAttachmentsView {
  readonly available: boolean;
  readonly surface: AgentComposerAttachmentsSurface | null;
  readonly dropActive: boolean;
  readonly notice: string | null;
  readonly blocked: boolean;
  blockedQuestion(questionId: string): boolean;
  reservedLineBytes(questionId: string): number;
  remove(draftId: string): void;
  open(): void;
  paste(event: ClipboardEvent<HTMLTextAreaElement>): void;
  resolve(answers: readonly AgentQuestionAnswer[]): Promise<AgentQuestionAttachmentResolution>;
  markSent(): void;
}

interface Session {
  readonly capability: AgentQuestionAttachments;
  readonly request: AgentQuestionRequest;
}

export function useAgentQuestionAttachments(
  options: AgentQuestionAttachmentsOptions,
): AgentQuestionAttachmentsView {
  const { capability, request, questionId, enabled, busy } = options;
  const [unavailableNotice, setUnavailableNotice] = useState<{
    readonly questionId: string;
    readonly text: string;
  } | null>(null);
  const mounted = useRef(false);
  const claimedLines = useRef(new Map<string, string>());
  const claimedDrafts = useRef(new Map<string, ReadonlySet<string>>());
  const session = useRef<Session | null>(null);
  useLayoutEffect(() => {
    if (capability !== null) session.current = { capability, request };
  });
  useEffect(() => {
    const owned = claimedDrafts.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      const latest = session.current;
      if (latest !== null) releaseQuestionDrafts(latest, owned);
      owned.clear();
    };
  }, []);

  const surfaceOf = (id: string): AgentComposerAttachmentsSurface | null =>
    capability === null ? null : draftOf(capability, request, id);
  const surface = enabled ? surfaceOf(questionId) : null;
  const intake = useAgentAttachmentIntake({
    attachments: surface,
    target: capability?.targetKey ?? null,
    serverId: null,
    promptOwnerKey: JSON.stringify([request.taskId, request.id, questionId]),
    dispatching: busy,
    picker: options.picker,
  });
  const dropActive = useAgentComposerDragDrop({
    enabled: surface !== null && !busy,
    subscribe: options.dragDrop,
    targetRef: options.dropTarget,
    onDropPaths: (paths) => void intake.drop(paths),
    onUnavailable: () => surface?.refuse(AGENT_ATTACHMENT_DROP_UNAVAILABLE),
  });
  const customQuestions = request.questions.filter((question) => question.allowCustom);

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const data = event.clipboardData;
    if (busy || !enabled || data === null || data === undefined) return;
    const files = agentClipboardFiles(data);
    const candidates = files.map((file) => ({
      name: file.name,
      mime: file.type,
      hasPath: false,
      bytes: file.size,
    }));
    const claim = (surface?.claimPaste ?? agentPasteClaim)(
      candidates,
      data.getData("text/plain").length,
    );
    if (claim !== "claim") return;
    event.preventDefault();
    if (surface === null) {
      setUnavailableNotice({ questionId, text: options.unavailableReason });
      return;
    }
    void intake.paste(files);
  };

  const resolve = async (
    answers: readonly AgentQuestionAnswer[],
  ): Promise<AgentQuestionAttachmentResolution> => {
    if (capability === null) return { kind: "ready", answers };
    const resolved: AgentQuestionAnswer[] = [];
    for (const answer of answers) {
      const scope = surfaceOf(answer.questionId);
      if (scope === null || !scope.drafts.some((draft) => draft.state === "ready")) {
        resolved.push(answer);
        continue;
      }
      const prepared = await scope.prepareTurn(capability.targetKey);
      if (!mounted.current) return { kind: "abandoned" };
      if (prepared === null) return { kind: "refused", reason: AGENT_ATTACHMENTS_DISCARDED_NOTICE };
      const pending = prepared.intents.filter(
        (intent) => !claimedLines.current.has(intentKey(intent)),
      );
      let lines: ReadonlyArray<string>;
      try {
        lines = await capability.claim({ ...prepared, intents: pending });
      } catch {
        return mounted.current
          ? { kind: "refused", reason: AGENT_ATTACHMENT_UNAVAILABLE_NOTICE }
          : { kind: "abandoned" };
      }
      if (lines.length !== pending.length) {
        return { kind: "refused", reason: AGENT_ATTACHMENT_UNAVAILABLE_NOTICE };
      }
      pending.forEach((intent, index) =>
        claimedLines.current.set(intentKey(intent), lines[index] ?? ""),
      );
      claimedDrafts.current.set(answer.questionId, new Set(prepared.draftIds));
      if (!mounted.current) return { kind: "abandoned" };
      const attachmentLines = prepared.intents.map(
        (intent) => claimedLines.current.get(intentKey(intent)) ?? "",
      );
      resolved.push(agentQuestionAnswerWithAttachments(answer, attachmentLines));
    }
    return { kind: "ready", answers: resolved };
  };

  const remove = (draftId: string): void => {
    const draft = surface?.drafts.find((candidate) => candidate.draftId === draftId);
    const key = draft?.attachmentId === null ? null : `staged:${draft?.attachmentId ?? ""}`;
    if (surface === null || draft === undefined) return;
    if (key === null || !claimedLines.current.has(key)) {
      surface.remove(draftId);
      return;
    }
    claimedLines.current.delete(key);
    const owned = claimedDrafts.current.get(questionId);
    if (owned !== undefined) {
      claimedDrafts.current.set(
        questionId,
        new Set([...owned].filter((candidate) => candidate !== draftId)),
      );
    }
    surface.markSent([draftId]);
  };

  const blockedQuestion = (id: string): boolean =>
    customQuestions.some((question) => question.id === id) &&
    (surfaceOf(id)?.drafts.some((draft) => draft.state !== "ready") ?? false);

  const markSent = (): void => {
    for (const [id, draftIds] of claimedDrafts.current) surfaceOf(id)?.markSent([...draftIds]);
    claimedDrafts.current.clear();
  };

  return {
    available: surface !== null,
    surface,
    dropActive,
    notice:
      surface === null && enabled && unavailableNotice?.questionId === questionId
        ? unavailableNotice.text
        : null,
    blocked: customQuestions.some((question) => blockedQuestion(question.id)),
    blockedQuestion,
    remove,
    reservedLineBytes: (id: string): number =>
      customQuestions.some((question) => question.id === id)
        ? (surfaceOf(id)?.promptLineBytes ?? 0)
        : 0,
    open: () => void intake.open(),
    paste,
    resolve,
    markSent,
  };
}

function releaseQuestionDrafts(
  { capability, request }: Session,
  claimed: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  for (const question of request.questions) {
    if (!question.allowCustom) continue;
    const scope = draftOf(capability, request, question.id);
    const sent = [...(claimed.get(question.id) ?? [])];
    if (sent.length > 0) scope.markSent(sent);
    const settled = draftOf(capability, request, question.id);
    if (settled.drafts.length > 0 || settled.refusal !== null) settled.clear();
  }
}

function draftOf(
  capability: AgentQuestionAttachments,
  request: AgentQuestionRequest,
  questionId: string,
): AgentComposerAttachmentsSurface {
  return capability.draft(JSON.stringify([request.taskId, request.id, questionId]));
}

function intentKey(intent: AgentTurnAttachmentIntent): string {
  return intent.kind === "staged" ? `staged:${intent.attachmentId}` : `reference:${intent.path}`;
}
