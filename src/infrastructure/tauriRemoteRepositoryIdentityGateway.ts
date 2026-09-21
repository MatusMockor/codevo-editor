import { invoke } from "@tauri-apps/api/core";
import { canonicalRepositoryIdentity } from "../domain/repositoryIdentity";
import type {
  RemoteRepositoryIdentityGateway,
  RemoteRepositoryIdentityRequest,
} from "../domain/remoteRepositoryIdentity";

export class TauriRemoteRepositoryIdentityGateway implements RemoteRepositoryIdentityGateway {
  constructor(private readonly invokeCommand: typeof invoke = invoke) {}

  async discover(request: RemoteRepositoryIdentityRequest): Promise<string | null> {
    if (
      Object.keys(request).sort().join(",") !== "projectId,runnerId,serverId" ||
      !Object.values(request).every(
        (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value),
      )
    )
      throw new Error("Invalid remote repository identity request.");
    const result = await this.invokeCommand<unknown>("remote_runner_repository_identity", {
      request,
    });
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      Object.keys(result).join(",") !== "repositoryKey"
    )
      throw new Error("Invalid remote repository identity response.");
    const key = (result as { repositoryKey: unknown }).repositoryKey;
    if (key === null) return null;
    if (
      typeof key !== "string" ||
      (canonicalRepositoryIdentity(`ssh://${key}`) !== key &&
        canonicalRepositoryIdentity(`https://${key}`) !== key)
    )
      throw new Error("Invalid remote repository identity response.");
    return key;
  }
}
