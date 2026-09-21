import { remoteRunnerErrorMessage } from "../domain/remoteRunnerErrors";
import type { RemoteRunnerGateway, RemoteRunnerServer } from "../domain/remoteRunner";

/** A single startup pass; transport timeouts and SSH ownership remain in the gateway. */
export class RemoteRunnerStartupConnections {
  private stopped = false;
  private disposed = false;
  private started = false;
  private running = false;
  private failure: string | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly gateway: Pick<RemoteRunnerGateway, "connectServer">,
    private readonly current: () => boolean,
    private readonly connected: (server: RemoteRunnerServer) => void,
    private readonly failed: (message: string) => void,
  ) {}

  start(servers: readonly RemoteRunnerServer[]): void {
    if (this.started || this.stopped || !this.current()) return;
    this.started = true;
    // Matches the native saved-server repository limit. Reject rather than hide omissions.
    if (servers.length > 32) {
      this.reportFailure("Too many saved servers to reconnect automatically. Connect manually.");
      return;
    }
    this.running = true;
    this.pending = this.run(servers).finally(() => {
      this.running = false;
    });
  }

  get isRunning(): boolean {
    return this.running;
  }
  get error(): string | null {
    return this.failure;
  }

  private reportFailure(message: string): void {
    this.failure = message;
    this.failed(message);
  }

  stop(): Promise<void> {
    this.disposed = true;
    return this.cancelQueued();
  }

  cancelQueued(): Promise<void> {
    this.stopped = true;
    this.failure = null;
    return this.pending;
  }

  private async run(servers: readonly RemoteRunnerServer[]): Promise<void> {
    for (const server of servers) {
      if (this.stopped || !this.current()) return;
      if (server.connected) continue;
      try {
        const { id, name, host, username, port } = server;
        const result = await this.gateway.connectServer({ id, name, host, username, port });
        if (this.disposed || !this.current()) return;
        this.connected(result);
      } catch (error) {
        if (this.stopped || !this.current()) return;
        this.reportFailure(
          `${server.name}: ${remoteRunnerErrorMessage(error, "Could not reconnect.")}`,
        );
      }
    }
  }
}
