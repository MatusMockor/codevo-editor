import type { DebugEvent } from "../domain/debug";
import {
  cloneVscodeNodeServerReadyActionRecipe,
  type VscodeNodeServerReadyActionRecipe,
} from "../domain/vscodeNodeLaunchConfiguration";
import {
  validateDebugServerReadyLoopbackUrl,
  type DebugServerReadyLoopbackUrl,
} from "../domain/debugServerReadyUrl";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

export const MAX_SERVER_READY_EARLY_SESSIONS = 16;
export const MAX_SERVER_READY_RETAINED_CHARACTERS = 1_100;
export const MAX_SERVER_READY_SCAN_CHUNK_CHARACTERS = 4_096;

const leaseBrand: unique symbol = Symbol("server-ready-action-lease");

export interface ServerReadyActionOwner {
  readonly configurationVersion: number;
  readonly rootPath: string;
  readonly workspaceEpoch: number;
  readonly workspaceId: string;
}

export interface ServerReadyActionLease {
  readonly attemptId: number;
  readonly [leaseBrand]: true;
}

export interface ServerReadyOpenRequest {
  readonly lease: ServerReadyActionLease;
  readonly owner: ServerReadyActionOwner;
  readonly url: DebugServerReadyLoopbackUrl;
}

interface EarlySession {
  lastSeq: number;
  matchedPort: number | null;
  retainedByStream: Record<"stdout" | "stderr", string>;
  terminated: boolean;
}

interface ActiveAction {
  readonly early: Map<number, EarlySession>;
  readonly isOwnerCurrent: (owner: ServerReadyActionOwner) => boolean;
  readonly lease: ServerReadyActionLease;
  readonly owner: ServerReadyActionOwner;
  readonly recipe: VscodeNodeServerReadyActionRecipe;
  adoptedSessionId: number | null;
  consumed: boolean;
  pendingRequest: ServerReadyOpenRequest | null;
  tainted: boolean;
}

/** Owns one private, one-shot `serverReadyAction` attempt. */
export class ServerReadyActionCoordinator {
  private active: ActiveAction | null = null;
  private nextAttemptId = 0;

  begin(request: {
    readonly isOwnerCurrent: (owner: ServerReadyActionOwner) => boolean;
    readonly owner: ServerReadyActionOwner;
    readonly recipe: VscodeNodeServerReadyActionRecipe;
  }): ServerReadyActionLease | null {
    this.active = null;
    const recipe = cloneVscodeNodeServerReadyActionRecipe(request.recipe);
    if (!validOwner(request.owner) || !recipe) return null;
    const owner = Object.freeze({ ...request.owner });
    if (!safelyCurrent(request.isOwnerCurrent, owner)) return null;
    const lease = Object.freeze({
      attemptId: this.nextAttemptId === Number.MAX_SAFE_INTEGER ? 1 : this.nextAttemptId + 1,
      [leaseBrand]: true as const,
    });
    this.nextAttemptId = lease.attemptId;
    this.active = {
      adoptedSessionId: null,
      consumed: false,
      early: new Map(),
      isOwnerCurrent: request.isOwnerCurrent,
      lease,
      owner,
      pendingRequest: null,
      recipe,
      tainted: false,
    };
    return lease;
  }

  observe(event: DebugEvent): ServerReadyOpenRequest | null {
    const active = this.active;
    if (
      !active ||
      active.consumed ||
      active.tainted ||
      normalizedWorkspaceRootKey(event.rootPath) !==
        normalizedWorkspaceRootKey(active.owner.rootPath) ||
      !validSessionId(event.sessionId) ||
      !Number.isSafeInteger(event.seq) ||
      event.seq < 0
    ) {
      return null;
    }
    if (!safelyCurrent(active.isOwnerCurrent, active.owner)) {
      this.active = null;
      return null;
    }
    if (active.adoptedSessionId !== null && event.sessionId !== active.adoptedSessionId) {
      return null;
    }
    let session = active.early.get(event.sessionId);
    if (!session) {
      if (active.early.size >= MAX_SERVER_READY_EARLY_SESSIONS) {
        active.tainted = true;
        active.early.clear();
        return null;
      }
      session = {
        lastSeq: -1,
        matchedPort: null,
        retainedByStream: { stderr: "", stdout: "" },
        terminated: false,
      };
      active.early.set(event.sessionId, session);
    }
    if (event.seq <= session.lastSeq) return null;
    session.lastSeq = event.seq;
    if (event.payload.kind === "terminated") {
      session.terminated = true;
      session.retainedByStream = { stderr: "", stdout: "" };
      session.matchedPort = null;
      if (active.adoptedSessionId === event.sessionId) this.active = null;
      return null;
    }
    if (event.payload.kind !== "output" || session.terminated || session.matchedPort !== null) {
      return null;
    }
    session.matchedPort = matchPort(
      active.recipe,
      session,
      event.payload.stream,
      event.payload.text,
    );
    return active.adoptedSessionId === event.sessionId && session.matchedPort !== null
      ? this.consume(active, session.matchedPort)
      : null;
  }

  adopt(lease: ServerReadyActionLease, sessionId: number): ServerReadyOpenRequest | null {
    const active = this.matching(lease);
    if (
      !active ||
      active.consumed ||
      active.tainted ||
      active.adoptedSessionId !== null ||
      !validSessionId(sessionId) ||
      !safelyCurrent(active.isOwnerCurrent, active.owner)
    ) {
      if (active && !safelyCurrent(active.isOwnerCurrent, active.owner)) this.active = null;
      return null;
    }
    active.adoptedSessionId = sessionId;
    for (const candidateId of [...active.early.keys()]) {
      if (candidateId !== sessionId) active.early.delete(candidateId);
    }
    const session = active.early.get(sessionId);
    if (session?.terminated) {
      this.active = null;
      return null;
    }
    return session?.matchedPort !== null && session?.matchedPort !== undefined
      ? this.consume(active, session.matchedPort)
      : null;
  }

  cancel(lease: ServerReadyActionLease): boolean {
    if (!this.matching(lease)) return false;
    this.active = null;
    return true;
  }

  cancelSession(rootPath: string, sessionId: number): boolean {
    const active = this.active;
    if (
      !active ||
      active.adoptedSessionId !== sessionId ||
      normalizedWorkspaceRootKey(active.owner.rootPath) !== normalizedWorkspaceRootKey(rootPath)
    ) {
      return false;
    }
    this.active = null;
    return true;
  }

  clear(): void {
    this.active = null;
  }

  /** Revalidates the exact lease immediately before its one allowed external side effect. */
  authorize(request: ServerReadyOpenRequest): DebugServerReadyLoopbackUrl | null {
    const active = this.active;
    if (
      !active ||
      active.pendingRequest !== request ||
      active.lease !== request.lease ||
      active.owner !== request.owner ||
      !safelyCurrent(active.isOwnerCurrent, active.owner)
    ) {
      if (active?.pendingRequest === request) this.active = null;
      return null;
    }
    this.active = null;
    return request.url;
  }

  private matching(lease: ServerReadyActionLease): ActiveAction | null {
    return this.active?.lease === lease ? this.active : null;
  }

  private consume(active: ActiveAction, port: number): ServerReadyOpenRequest | null {
    if (
      this.active !== active ||
      active.consumed ||
      !safelyCurrent(active.isOwnerCurrent, active.owner)
    ) {
      return null;
    }
    const validated = validateDebugServerReadyLoopbackUrl(
      `${active.recipe.uri.scheme}://${active.recipe.uri.host}:${port}${active.recipe.uri.path}`,
    );
    if (validated.kind !== "valid") {
      this.active = null;
      return null;
    }
    active.consumed = true;
    active.early.clear();
    const request = Object.freeze({
      lease: active.lease,
      owner: active.owner,
      url: validated.url,
    });
    active.pendingRequest = request;
    return request;
  }
}

function matchPort(
  recipe: VscodeNodeServerReadyActionRecipe,
  session: EarlySession,
  stream: "stdout" | "stderr",
  text: string,
): number | null {
  if (typeof text !== "string" || text.length === 0) return null;
  let retained = session.retainedByStream[stream];
  for (let offset = 0; offset < text.length; offset += MAX_SERVER_READY_SCAN_CHUNK_CHARACTERS) {
    const combined = retained + text.slice(offset, offset + MAX_SERVER_READY_SCAN_CHUNK_CHARACTERS);
    const port = matchPortInWindow(recipe, combined);
    if (port !== null) {
      session.retainedByStream[stream] = "";
      return port;
    }
    retained = retainedWindow(recipe, combined);
  }
  session.retainedByStream[stream] = retained;
  return null;
}

function matchPortInWindow(
  recipe: VscodeNodeServerReadyActionRecipe,
  combined: string,
): number | null {
  let searchFrom = 0;
  while (searchFrom < combined.length) {
    const prefixIndex = combined.indexOf(recipe.match.prefix, searchFrom);
    if (prefixIndex < 0) break;
    const portStart = prefixIndex + recipe.match.prefix.length;
    let portEnd = portStart;
    while (portEnd < combined.length && isAsciiDigit(combined.charCodeAt(portEnd))) portEnd += 1;
    const digitCount = portEnd - portStart;
    const port =
      digitCount >= 1 && digitCount <= 5 ? Number(combined.slice(portStart, portEnd)) : 0;
    const suffixMatches =
      recipe.match.suffix === ""
        ? portEnd < combined.length && !isAsciiDigit(combined.charCodeAt(portEnd))
        : combined.startsWith(recipe.match.suffix, portEnd);
    if (suffixMatches && port >= 1 && port <= 65_535) {
      return port;
    }
    searchFrom = prefixIndex + 1;
  }
  return null;
}

function retainedWindow(recipe: VscodeNodeServerReadyActionRecipe, combined: string): string {
  const retainedLimit = Math.min(
    MAX_SERVER_READY_RETAINED_CHARACTERS,
    recipe.match.prefix.length + recipe.match.suffix.length + 7,
  );
  return combined.slice(-retainedLimit);
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function validOwner(owner: ServerReadyActionOwner): boolean {
  return (
    typeof owner.rootPath === "string" &&
    owner.rootPath.length > 0 &&
    typeof owner.workspaceId === "string" &&
    owner.workspaceId.length > 0 &&
    Number.isSafeInteger(owner.workspaceEpoch) &&
    owner.workspaceEpoch >= 0 &&
    Number.isSafeInteger(owner.configurationVersion) &&
    owner.configurationVersion >= 0
  );
}

function safelyCurrent(
  predicate: (owner: ServerReadyActionOwner) => boolean,
  owner: ServerReadyActionOwner,
): boolean {
  try {
    return predicate(owner);
  } catch {
    return false;
  }
}

function validSessionId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
