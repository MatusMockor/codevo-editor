import type { WorkspaceTrustConfirmation, WorkspaceTrustOrigin } from "../domain/trust";

export type WorkspaceTrustDecision = "trust" | "notNow";

interface PendingTrustPrompt {
  readonly request: WorkspaceTrustConfirmation;
  readonly resolve: (decision: WorkspaceTrustDecision) => void;
}

const MAX_PATH_CHARS = 4096;
const MAX_LABEL_CHARS = 256;
const MAX_ORIGIN_CHARS = 512;

export class WorkspaceTrustPromptCoordinator {
  private active: PendingTrustPrompt | null = null;
  private hosts = 0;
  private workspaceScope: string | null = null;
  private readonly listeners = new Set<() => void>();

  readonly getSnapshot = (): WorkspaceTrustConfirmation | null => this.active?.request ?? null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  acquireHostLease(): () => void {
    this.hosts += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.hosts -= 1;
      if (this.hosts === 0) this.dismiss();
    };
  }

  setWorkspaceScope(scope: string | null): void {
    if (scope === this.workspaceScope) return;
    this.workspaceScope = scope;
    this.dismiss();
  }

  request(request: WorkspaceTrustConfirmation): Promise<WorkspaceTrustDecision> {
    const invalid = invalidReason(request);
    if (invalid !== null) return Promise.reject(new RangeError(invalid));
    if (this.hosts === 0) return Promise.resolve("notNow");
    const frozen: WorkspaceTrustConfirmation = Object.freeze({
      rootPath: request.rootPath,
      label: request.label,
      origin: freezeOrigin(request.origin),
    });
    return new Promise((resolve) => {
      const previous = this.active;
      this.active = { request: frozen, resolve };
      previous?.resolve("notNow");
      this.emit();
    });
  }

  resolve(request: WorkspaceTrustConfirmation, decision: WorkspaceTrustDecision): void {
    const active = this.active;
    if (active === null || active.request !== request) return;
    this.active = null;
    active.resolve(decision);
    this.emit();
  }

  private dismiss(): void {
    const active = this.active;
    if (active === null) return;
    this.active = null;
    active.resolve("notNow");
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function freezeOrigin(origin: WorkspaceTrustOrigin): WorkspaceTrustOrigin {
  if (origin.kind === "clone")
    return Object.freeze({ kind: "clone", host: origin.host, path: origin.path });
  return Object.freeze({ kind: "local" });
}

function invalidReason(request: WorkspaceTrustConfirmation): string | null {
  if (!request.rootPath.startsWith("/") || request.rootPath.length > MAX_PATH_CHARS)
    return "Trust prompts need an absolute project path.";
  if (request.label.length === 0 || request.label.length > MAX_LABEL_CHARS)
    return `Trust prompt labels must contain 1-${MAX_LABEL_CHARS} characters.`;
  if (
    request.origin.kind === "clone" &&
    `${request.origin.host}/${request.origin.path}`.length > MAX_ORIGIN_CHARS
  )
    return "Trust prompt origin is too long.";
  return null;
}
