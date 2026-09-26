import { useLayoutEffect, useRef, useState } from "react";
import { withBoundedEntry } from "../../domain/boundedKeyedMap";
import type { GitChangeStatus } from "../../domain/git";
import type { GitSurfaceTarget } from "../../domain/gitSurfaceStatus";
import {
  gitDiscardBlock,
  gitDiscardEffect,
  type GitDiscardEffect,
  type GitDiscardFile,
  type GitDiscardReceipt,
  type GitWorkingTreeGateway,
} from "../../domain/gitWorkingTree";
import { useLatest } from "../../ui/foundation/useLatest";
import type { AgentGitChangeRow, AgentGitNotice } from "./useAgentGitSurface";

export const MAX_REMEMBERED_DISCARD_NOTICES = 16;
export const DISCARD_CHANGED_MESSAGE =
  "The file changed since you opened the dialog. Review it and try again.";
const DISCARD_FAILURE = "Git could not discard the changes.";

export interface AgentGitDiscardPending {
  readonly relativePath: string;
  readonly oldRelativePath: string | null;
  readonly status: GitChangeStatus;
  readonly effect: Exclude<GitDiscardEffect, "blocked">;
  readonly busy: boolean;
  readonly ready: boolean;
}

export interface AgentGitDiscardFocus {
  readonly index: number;
  readonly removedKey: string;
  readonly sequence: number;
}

export interface AgentGitDiscardState {
  readonly available: boolean;
  readonly pending: AgentGitDiscardPending | null;
  readonly notice: AgentGitNotice | null;
  readonly focusAfter: AgentGitDiscardFocus | null;
  request(row: AgentGitChangeRow): void;
  cancel(): void;
  confirm(): void;
  dismissNotice(): void;
}

export interface UseAgentGitDiscardOptions {
  readonly ownerKey: string | null;
  readonly target: GitSurfaceTarget | null;
  readonly gateway: Pick<GitWorkingTreeGateway, "prepareDiscard" | "discardFile"> | null;
  readonly rows: ReadonlyArray<AgentGitChangeRow>;
  onDiscarded(): void;
}

interface Authority {
  readonly key: string | null;
  readonly generation: number;
}

interface PendingDiscard {
  readonly key: string;
  readonly generation: number;
  readonly file: GitDiscardFile;
  readonly effect: Exclude<GitDiscardEffect, "blocked">;
  readonly busy: boolean;
  readonly token: number;
  readonly rowKey: string;
  readonly fingerprint: string | null;
  readonly index: number;
}

export function useAgentGitDiscard(options: UseAgentGitDiscardOptions): AgentGitDiscardState {
  const { gateway, ownerKey, rows, target } = options;
  const key =
    ownerKey === null || target === null
      ? null
      : JSON.stringify([ownerKey, target.repositoryRoot, target.worktreePath]);
  const [pending, setPending] = useState<PendingDiscard | null>(null);
  const [notices, setNotices] = useState<ReadonlyMap<string, AgentGitNotice>>(() => new Map());
  const authority = useRef<Authority>({ key: null, generation: 0 });
  const inFlight = useRef(new Set<string>());
  const nextToken = useRef(0);
  const [focus, setFocus] = useState<(AgentGitDiscardFocus & { readonly key: string }) | null>(
    null,
  );
  const rowsRef = useLatest(rows);
  const targetRef = useLatest(target);
  const gatewayRef = useLatest(gateway);
  const onDiscardedRef = useLatest(options.onDiscarded);

  useLayoutEffect(() => {
    authority.current = { key, generation: authority.current.generation + 1 };
    setPending(null);
    return () => {
      authority.current = { key: null, generation: authority.current.generation + 1 };
    };
  }, [key]);

  const current = (candidate: PendingDiscard | null): PendingDiscard | null => {
    const now = authority.current;
    if (candidate === null) return null;
    if (candidate.key !== now.key || candidate.generation !== now.generation) return null;
    return candidate;
  };
  const isCurrent = (candidateKey: string, generation: number): boolean =>
    authority.current.key === candidateKey && authority.current.generation === generation;
  const visible = pending !== null && pending.key === key ? pending : null;
  const remember = (noticeKey: string, notice: AgentGitNotice | null): void =>
    setNotices((map) => withBoundedEntry(map, noticeKey, notice, MAX_REMEMBERED_DISCARD_NOTICES));

  const request = (row: AgentGitChangeRow): void => {
    const { generation, key: activeKey } = authority.current;
    const discardGateway = gatewayRef.current;
    const discardTarget = targetRef.current;
    if (activeKey === null || discardGateway === null || discardTarget === null) return;
    if (inFlight.current.has(activeKey)) return;
    const effect = gitDiscardEffect(row.status);
    if (effect === "blocked" || gitDiscardBlock(row.relativePath, row.status) !== null) return;
    remember(activeKey, null);
    nextToken.current += 1;
    const token = nextToken.current;
    const file: GitDiscardFile = {
      relativePath: row.relativePath,
      oldRelativePath: row.oldRelativePath,
      expectedStatus: row.status,
    };
    const index = rowsRef.current.findIndex((candidate) => candidate.key === row.key);
    setPending({
      key: activeKey,
      rowKey: row.key,
      generation,
      effect,
      busy: false,
      token,
      fingerprint: null,
      file,
      index,
    });
    const stillPending = (previous: PendingDiscard | null): boolean =>
      previous !== null && previous.key === activeKey && previous.token === token;
    discardGateway.prepareDiscard({ ...discardTarget, file }).then(
      (preparation) => {
        if (!isCurrent(activeKey, generation)) return;
        setPending((previous) =>
          stillPending(previous) && previous !== null
            ? { ...previous, fingerprint: preparation.fingerprint }
            : previous,
        );
      },
      (reason: unknown) => {
        if (!isCurrent(activeKey, generation)) return;
        setPending((previous) => (stillPending(previous) ? null : previous));
        remember(activeKey, { kind: "error", text: errorText(reason) });
      },
    );
  };

  const settle = (prepared: PendingDiscard, notice: AgentGitNotice, succeeded: boolean): void => {
    inFlight.current.delete(prepared.key);
    remember(prepared.key, notice);
    setPending((previous) => (previous?.key === prepared.key ? null : previous));
    if (!succeeded || !isCurrent(prepared.key, prepared.generation)) return;
    setFocus((previous) => ({
      key: prepared.key,
      index: Math.max(0, prepared.index),
      removedKey: prepared.rowKey,
      sequence: (previous?.sequence ?? 0) + 1,
    }));
    onDiscardedRef.current();
  };

  const confirm = (): void => {
    const prepared = current(pending);
    const discardGateway = gatewayRef.current;
    const discardTarget = targetRef.current;
    if (prepared === null || prepared.busy || discardGateway === null || discardTarget === null) {
      return;
    }
    const { fingerprint } = prepared;
    if (fingerprint === null) return;
    if (inFlight.current.has(prepared.key)) return;
    if (!rowStillMatches(rowsRef.current, prepared.file)) {
      setPending(null);
      remember(prepared.key, { kind: "error", text: DISCARD_CHANGED_MESSAGE });
      return;
    }
    inFlight.current.add(prepared.key);
    setPending({ ...prepared, busy: true });
    void discardGateway.discardFile({ ...discardTarget, file: prepared.file, fingerprint }).then(
      (receipt) => settle(prepared, successNotice(receipt), true),
      (reason: unknown) => settle(prepared, { kind: "error", text: errorText(reason) }, false),
    );
  };

  return {
    available: key !== null && gateway !== null,
    pending:
      visible === null
        ? null
        : {
            relativePath: visible.file.relativePath,
            oldRelativePath: visible.file.oldRelativePath,
            status: visible.file.expectedStatus,
            effect: visible.effect,
            busy: visible.busy,
            ready: visible.fingerprint !== null,
          },
    focusAfter:
      focus === null || focus.key !== key
        ? null
        : { index: focus.index, removedKey: focus.removedKey, sequence: focus.sequence },
    notice: key === null ? null : (notices.get(key) ?? null),
    request,
    cancel: () => setPending((previous) => (previous?.busy === true ? previous : null)),
    confirm,
    dismissNotice: () => {
      if (key !== null) remember(key, null);
    },
  };
}

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message.length > 0 ? reason.message : DISCARD_FAILURE;
}

function rowStillMatches(rows: ReadonlyArray<AgentGitChangeRow>, file: GitDiscardFile): boolean {
  return rows.some(
    (row) =>
      row.relativePath === file.relativePath &&
      row.status === file.expectedStatus &&
      row.oldRelativePath === file.oldRelativePath,
  );
}

function successNotice(receipt: GitDiscardReceipt): AgentGitNotice {
  if (receipt.action === "deleted") return { kind: "ok", text: `Deleted ${receipt.relativePath}.` };
  return { kind: "ok", text: `Discarded changes to ${receipt.relativePath}.` };
}
