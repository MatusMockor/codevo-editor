import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { withBoundedEntry } from "../../domain/boundedKeyedMap";
import { validateGitBaseRef } from "../../domain/gitBranchDiff";
import type { GitSurfaceTarget } from "../../domain/gitSurfaceStatus";
import {
  classifyPullRequestError,
  pullRequestDraftDefaults,
  validatePullRequestBody,
  validatePullRequestTitle,
  type PullRequestContext,
  type PullRequestFailure,
  type PullRequestGateway,
  type PullRequestReceipt,
} from "../../domain/pullRequest";
import { useLatest } from "../../ui/foundation/useLatest";

export const PULL_REQUEST_BASE_REQUIRED = "Choose a base branch.";
export const PULL_REQUEST_BASE_INVALID = "Choose a valid base branch.";
export const MAX_REMEMBERED_SUBMITS = 16;

export type AgentPullRequestContextLoad =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: PullRequestContext }
  | { readonly kind: "failed"; readonly message: string };

export type AgentPullRequestSubmit =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "created"; readonly receipt: PullRequestReceipt }
  | { readonly kind: "failed"; readonly failure: PullRequestFailure };

export interface AgentPullRequestState {
  readonly context: AgentPullRequestContextLoad;
  readonly base: string | null;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
  readonly titleError: string | null;
  readonly bodyError: string | null;
  readonly baseError: string | null;
  readonly submit: AgentPullRequestSubmit;
  setBase(base: string): void;
  setTitle(title: string): void;
  setBody(body: string): void;
  setDraft(draft: boolean): void;
  create(): void;
  reload(): void;
}

export interface UseAgentPullRequestOptions {
  readonly ownerKey: string | null;
  readonly target: GitSurfaceTarget | null;
  readonly gateway: PullRequestGateway | null;
  readonly threadTitle: string | null;
}

interface FormState {
  readonly base: string | null;
  readonly title: string | null;
  readonly body: string | null;
  readonly draft: boolean;
  readonly titleError: string | null;
  readonly bodyError: string | null;
  readonly baseError: string | null;
}

interface OwnerSubmit {
  readonly head: string | null;
  readonly submit: AgentPullRequestSubmit;
}

interface KeyedLoad {
  readonly key: string | null;
  readonly load: AgentPullRequestContextLoad;
}

const EMPTY_FORM: FormState = {
  base: null,
  title: null,
  body: null,
  draft: false,
  titleError: null,
  bodyError: null,
  baseError: null,
};
const IDLE_LOAD: AgentPullRequestContextLoad = { kind: "idle" };
const IDLE_SUBMIT: AgentPullRequestSubmit = { kind: "idle" };

export function useAgentPullRequest(options: UseAgentPullRequestOptions): AgentPullRequestState {
  const { ownerKey, target, threadTitle } = options;
  const identity =
    ownerKey === null || target === null
      ? null
      : JSON.stringify([ownerKey, target.repositoryRoot, target.worktreePath]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loaded, setLoaded] = useState<KeyedLoad>({ key: null, load: IDLE_LOAD });
  const [submits, setSubmits] = useState<ReadonlyMap<string, OwnerSubmit>>(() => new Map());
  const [nonce, setNonce] = useState(0);
  const inFlight = useRef<Set<string>>(new Set());
  const loadGeneration = useRef(0);
  const gatewayRef = useLatest(options.gateway);
  const targetRef = useLatest(target);
  const requested = form.base;
  const loadKey = identity === null ? null : JSON.stringify([identity, requested]);

  useLayoutEffect(() => {
    setForm(EMPTY_FORM);
  }, [identity]);

  useEffect(() => {
    loadGeneration.current += 1;
    const current = loadGeneration.current;
    const gateway = gatewayRef.current;
    const activeTarget = targetRef.current;
    if (loadKey === null || gateway === null || activeTarget === null) {
      setLoaded({ key: loadKey, load: IDLE_LOAD });
      return;
    }
    setLoaded({ key: loadKey, load: { kind: "loading" } });
    gateway
      .getContext({
        repositoryRoot: activeTarget.repositoryRoot,
        worktreePath: activeTarget.worktreePath,
        base: requested,
      })
      .then(
        (value) => {
          if (loadGeneration.current !== current) return;
          setLoaded({ key: loadKey, load: { kind: "ready", value } });
        },
        (error: unknown) => {
          if (loadGeneration.current !== current) return;
          setLoaded({
            key: loadKey,
            load: { kind: "failed", message: classifyPullRequestError(error).message },
          });
        },
      );
  }, [gatewayRef, loadKey, nonce, requested, targetRef]);

  const context = loaded.key === loadKey && loadKey !== null ? loaded.load : idleOrLoading(loadKey);
  const value = context.kind === "ready" ? context.value : null;
  const defaults = useMemo(
    () => (value === null ? { title: "", body: "" } : pullRequestDraftDefaults(value, threadTitle)),
    [threadTitle, value],
  );
  const base = form.base ?? value?.base ?? value?.defaultBase ?? null;
  const title = form.title ?? defaults.title;
  const body = form.body ?? defaults.body;

  const submit = visibleSubmit(identity === null ? undefined : submits.get(identity), value);
  const snapshotRef = useLatest({
    base,
    title,
    body,
    draft: form.draft,
    submit,
    identity,
    head: value?.headBranch ?? null,
  });

  const setBase = useCallback((next: string) => {
    if (!validBase(next)) {
      setForm((current) => ({ ...current, baseError: PULL_REQUEST_BASE_INVALID }));
      return;
    }
    setForm((current) => ({ ...current, base: next, baseError: null }));
  }, []);

  const create = useCallback(() => {
    const snapshot = snapshotRef.current;
    const gateway = gatewayRef.current;
    const activeTarget = targetRef.current;
    if (snapshot.identity === null || gateway === null || activeTarget === null) return;
    if (snapshot.submit.kind === "created" || inFlight.current.has(snapshot.identity)) return;
    const titleResult = validatePullRequestTitle(snapshot.title);
    const bodyResult = validatePullRequestBody(snapshot.body);
    const baseError = baseProblem(snapshot.base);
    setForm((current) => ({
      ...current,
      titleError: titleResult.kind === "invalid" ? titleResult.reason : null,
      bodyError: bodyResult.kind === "invalid" ? bodyResult.reason : null,
      baseError,
    }));
    if (titleResult.kind === "invalid" || bodyResult.kind === "invalid") return;
    if (baseError !== null || snapshot.base === null) return;
    const owner = snapshot.identity;
    const head = snapshot.head;
    const record = (next: AgentPullRequestSubmit): void =>
      setSubmits((current) =>
        withBoundedEntry(current, owner, { head, submit: next }, MAX_REMEMBERED_SUBMITS),
      );
    const settle = (next: AgentPullRequestSubmit): void => {
      inFlight.current.delete(owner);
      record(next);
    };
    inFlight.current.add(owner);
    record({ kind: "submitting" });
    gateway
      .create({
        repositoryRoot: activeTarget.repositoryRoot,
        worktreePath: activeTarget.worktreePath,
        base: snapshot.base,
        title: titleResult.title,
        body: bodyResult.body,
        draft: snapshot.draft,
      })
      .then(
        (receipt) => settle({ kind: "created", receipt }),
        (error: unknown) => settle({ kind: "failed", failure: classifyPullRequestError(error) }),
      );
  }, [gatewayRef, snapshotRef, targetRef]);

  return {
    context,
    base,
    title,
    body,
    draft: form.draft,
    titleError: form.titleError,
    bodyError: form.bodyError,
    baseError: form.baseError,
    submit,
    setBase,
    setTitle: (next) => setForm((current) => ({ ...current, title: next, titleError: null })),
    setBody: (next) => setForm((current) => ({ ...current, body: next, bodyError: null })),
    setDraft: (next) => setForm((current) => ({ ...current, draft: next })),
    create,
    reload: () => setNonce((current) => current + 1),
  };
}

function visibleSubmit(
  entry: OwnerSubmit | undefined,
  context: PullRequestContext | null,
): AgentPullRequestSubmit {
  if (entry === undefined) return IDLE_SUBMIT;
  if (context !== null && context.headBranch !== entry.head) return IDLE_SUBMIT;
  return entry.submit;
}

function idleOrLoading(loadKey: string | null): AgentPullRequestContextLoad {
  if (loadKey === null) return IDLE_LOAD;
  return { kind: "loading" };
}

function baseProblem(base: string | null): string | null {
  if (base === null) return PULL_REQUEST_BASE_REQUIRED;
  if (!validBase(base)) return PULL_REQUEST_BASE_INVALID;
  return null;
}

function validBase(base: string): boolean {
  try {
    validateGitBaseRef(base);
    return true;
  } catch {
    return false;
  }
}
