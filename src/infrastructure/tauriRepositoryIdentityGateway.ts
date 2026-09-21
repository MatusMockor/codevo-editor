import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RepositoryIdentityGateway } from "../application/repositoryIdentityGateway";
import { isCanonicalRepositoryIdentity } from "../domain/repositoryIdentity";

export class TauriRepositoryIdentityGateway implements RepositoryIdentityGateway {
  constructor(
    private readonly invokeCommand: (
      command: string,
      args: Record<string, unknown>,
    ) => Promise<unknown> = invoke,
    private readonly isRuntimeAvailable: () => boolean = isTauri,
  ) {}

  async discover(rootPath: string): Promise<string | null> {
    if (!rootPath || rootPath.length > 4096 || rootPath.includes("\0"))
      throw new Error("Invalid project path.");
    if (!this.isRuntimeAvailable()) return null;
    const result = await this.invokeCommand("get_repository_identity", { rootPath });
    if (result === null) return null;
    if (!isCanonicalRepositoryIdentity(result)) throw new Error("Invalid repository identity.");
    return result;
  }
}
