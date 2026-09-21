import type { RemoteRepositoryIdentityGateway } from "../domain/remoteRepositoryIdentity";
import type { RepositoryIdentityGateway } from "./repositoryIdentityGateway";

export type RepositoryIdentityTarget = Readonly<{ key: string; root: string; authority: string }>;
type Pass = {
  targets: readonly RepositoryIdentityTarget[];
  local: RepositoryIdentityGateway | null;
  remote: RemoteRepositoryIdentityGateway | null;
  publish(values: ReadonlyMap<string, string>): void;
  values: Map<string, string>;
  index: number;
};

/** A hook-local pool: replacement passes share permits with still-running reads. */
export class ProjectRepositoryIdentityDiscovery {
  private current: Pass | null = null;
  private active = 0;

  start(
    targets: readonly RepositoryIdentityTarget[],
    local: RepositoryIdentityGateway | null,
    remote: RemoteRepositoryIdentityGateway | null,
    publish: Pass["publish"],
  ): () => void {
    const pass: Pass = { targets, local, remote, publish, values: new Map(), index: 0 };
    this.current = pass;
    this.pump();
    return () => {
      if (this.current === pass) this.current = null;
    };
  }

  private pump(): void {
    const pass = this.current;
    if (!pass) return;
    while (this.active < 2 && pass.index < pass.targets.length) {
      const target = pass.targets[pass.index++]!;
      this.active++;
      void discover(target, pass.local, pass.remote)
        .then((identity) => {
          if (this.current !== pass) return;
          if (identity) pass.values.set(target.key, identity);
          pass.publish(new Map(pass.values));
        })
        .catch(() => {
          // Unsupported/offline projects remain separate; explicit links still work.
        })
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}

async function discover(
  target: RepositoryIdentityTarget,
  local: RepositoryIdentityGateway | null,
  remote: RemoteRepositoryIdentityGateway | null,
): Promise<string | null> {
  if (!target.key.startsWith("remote:")) return local?.discover(target.root) ?? null;
  const parts = target.key.split(":");
  if (!remote || parts.length !== 4) return null;
  const decoded = parts.slice(1).map(decodeURIComponent);
  if (!decoded.every((part, i) => part && encodeURIComponent(part) === parts[i + 1])) return null;
  return remote.discover({ serverId: decoded[0]!, runnerId: decoded[1]!, projectId: decoded[2]! });
}
