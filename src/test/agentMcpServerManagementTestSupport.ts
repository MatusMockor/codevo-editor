import type { AgentMcpServerManagementScheduler } from "../application/agentMcpServerManagementScheduler";
import type {
  AgentMcpServerManagement,
  AgentMcpServerManagementGateway,
  AgentMcpServerManagementSupport,
  RemoteAgentMcpServerChangeRequest,
  RemoteAgentMcpServerLoginCallbackRequest,
  RemoteAgentMcpServerLoginIdRequest,
  RemoteAgentMcpServerLoginRequest,
  RemoteAgentMcpServerManagementGateway,
} from "../application/agentMcpServerManagementGateway";
import type { ExternalUrlOpenerPort } from "../application/useAgentShipFlow";
import type {
  AgentMcpServerChange,
  AgentMcpServerChangeRequest,
  AgentMcpServerLoginIdRequest,
  AgentMcpServerLoginMode,
  AgentMcpServerLoginRequest,
  AgentMcpServerLoginState,
  AgentMcpServerLoginStep,
} from "../domain/agentMcpServerManagement";
import type { AgentMcpServersTarget } from "../domain/agentMcpServersTarget";

export interface PendingCall<TRequest, TResult> {
  readonly request: TRequest;
  resolve(value: TResult): void;
  reject(reason: unknown): void;
}

export class DeferredCalls<TRequest, TResult> {
  readonly calls: Array<PendingCall<TRequest, TResult>> = [];

  readonly ask = (request: TRequest): Promise<TResult> =>
    new Promise((resolve, reject) => {
      this.calls.push({ request, resolve, reject });
    });

  requests(): ReadonlyArray<TRequest> {
    return this.calls.map((call) => call.request);
  }

  latest(): PendingCall<TRequest, TResult> | undefined {
    return this.calls[this.calls.length - 1];
  }
}

export class ManualScheduler implements AgentMcpServerManagementScheduler {
  private nowMs = 1_000_000;
  private sequence = 0;
  private tasks: Array<{ readonly at: number; readonly order: number; readonly run: () => void }> =
    [];

  schedule(delayMs: number, task: () => void): () => void {
    this.sequence += 1;
    const entry = { at: this.nowMs + delayMs, order: this.sequence, run: task };
    this.tasks.push(entry);
    return () => {
      this.tasks = this.tasks.filter((candidate) => candidate !== entry);
    };
  }

  pending(): number {
    return this.tasks.length;
  }

  advance(durationMs: number): void {
    const until = this.nowMs + durationMs;
    for (let next = this.due(until); next !== undefined; next = this.due(until)) {
      this.tasks = this.tasks.filter((candidate) => candidate !== next);
      this.nowMs = next.at;
      next.run();
    }
    this.nowMs = until;
  }

  private due(until: number) {
    return this.tasks
      .filter((task) => task.at <= until)
      .sort((left, right) => left.at - right.at || left.order - right.order)[0];
  }
}

export class RecordingUrlOpener implements ExternalUrlOpenerPort {
  readonly opened = new DeferredCalls<string, void>();

  openExternal(url: string): Promise<void> {
    return this.opened.ask(url);
  }
}

export class DeferredAgentMcpServerManagement implements AgentMcpServerManagement {
  supported: AgentMcpServerManagementSupport = "supported";
  readonly changes = new DeferredCalls<
    { readonly target: AgentMcpServersTarget; readonly change: AgentMcpServerChange },
    void
  >();
  readonly starts = new DeferredCalls<
    {
      readonly target: AgentMcpServersTarget;
      readonly name: string;
      readonly mode: AgentMcpServerLoginMode;
    },
    AgentMcpServerLoginStep
  >();
  readonly states = new DeferredCalls<
    { readonly target: AgentMcpServersTarget; readonly loginId: string },
    AgentMcpServerLoginState
  >();
  readonly callbacks = new DeferredCalls<
    {
      readonly target: AgentMcpServersTarget;
      readonly loginId: string;
      readonly callbackUrl: string;
    },
    void
  >();
  readonly cancels: Array<{ readonly target: AgentMcpServersTarget; readonly loginId: string }> =
    [];

  support(): AgentMcpServerManagementSupport {
    return this.supported;
  }

  change(target: AgentMcpServersTarget, change: AgentMcpServerChange): Promise<void> {
    return this.changes.ask({ target, change });
  }

  startLogin(
    target: AgentMcpServersTarget,
    name: string,
    mode: AgentMcpServerLoginMode,
  ): Promise<AgentMcpServerLoginStep> {
    return this.starts.ask({ target, name, mode });
  }

  loginState(target: AgentMcpServersTarget, loginId: string): Promise<AgentMcpServerLoginState> {
    return this.states.ask({ target, loginId });
  }

  submitLoginCallback(
    target: AgentMcpServersTarget,
    loginId: string,
    callbackUrl: string,
  ): Promise<void> {
    return this.callbacks.ask({ target, loginId, callbackUrl });
  }

  cancelLogin(target: AgentMcpServersTarget, loginId: string): Promise<void> {
    this.cancels.push({ target, loginId });
    return Promise.resolve();
  }
}

export class DeferredAgentMcpServerManagementGateway implements AgentMcpServerManagementGateway {
  readonly changes = new DeferredCalls<AgentMcpServerChangeRequest, void>();
  readonly starts = new DeferredCalls<AgentMcpServerLoginRequest, AgentMcpServerLoginStep>();
  readonly states = new DeferredCalls<AgentMcpServerLoginIdRequest, AgentMcpServerLoginState>();
  readonly cancels = new DeferredCalls<AgentMcpServerLoginIdRequest, void>();

  change(request: AgentMcpServerChangeRequest): Promise<void> {
    return this.changes.ask(request);
  }

  startLogin(request: AgentMcpServerLoginRequest): Promise<AgentMcpServerLoginStep> {
    return this.starts.ask(request);
  }

  loginState(request: AgentMcpServerLoginIdRequest): Promise<AgentMcpServerLoginState> {
    return this.states.ask(request);
  }

  cancelLogin(request: AgentMcpServerLoginIdRequest): Promise<void> {
    return this.cancels.ask(request);
  }
}

export class DeferredRemoteAgentMcpServerManagementGateway implements Required<RemoteAgentMcpServerManagementGateway> {
  readonly changes = new DeferredCalls<RemoteAgentMcpServerChangeRequest, void>();
  readonly starts = new DeferredCalls<RemoteAgentMcpServerLoginRequest, AgentMcpServerLoginStep>();
  readonly states = new DeferredCalls<
    RemoteAgentMcpServerLoginIdRequest,
    AgentMcpServerLoginState
  >();
  readonly callbacks = new DeferredCalls<RemoteAgentMcpServerLoginCallbackRequest, void>();
  readonly cancels = new DeferredCalls<RemoteAgentMcpServerLoginIdRequest, void>();

  changeMcpServer(request: RemoteAgentMcpServerChangeRequest): Promise<void> {
    return this.changes.ask(request);
  }

  startMcpServerLogin(request: RemoteAgentMcpServerLoginRequest): Promise<AgentMcpServerLoginStep> {
    return this.starts.ask(request);
  }

  getMcpServerLogin(
    request: RemoteAgentMcpServerLoginIdRequest,
  ): Promise<AgentMcpServerLoginState> {
    return this.states.ask(request);
  }

  submitMcpServerLoginCallback(request: RemoteAgentMcpServerLoginCallbackRequest): Promise<void> {
    return this.callbacks.ask(request);
  }

  cancelMcpServerLogin(request: RemoteAgentMcpServerLoginIdRequest): Promise<void> {
    return this.cancels.ask(request);
  }
}

export async function settleMicrotasks(turns = 12): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}
