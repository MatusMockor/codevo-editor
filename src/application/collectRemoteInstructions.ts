import type { RemoteRunnerGateway, RemoteRunnerProvider } from "../domain/remoteRunner";
import type { RemoteRunnerInstructionSnapshot } from "../domain/remoteRunnerInstructions";
import {
  readRemoteInstructionRoot,
  readRemoteInstructionSourceRevision,
} from "./remoteInstructionSources";

/** Resolves one exact send's rules; callers revalidate before dispatch and retain retries. */
export async function collectRemoteInstructions(
  gateway: Pick<RemoteRunnerGateway, "collectInstructions" | "getRunner">,
  target: { readonly serverId: string; readonly runnerId: string; readonly projectId: string },
  valid: () => boolean,
  provider: RemoteRunnerProvider,
): Promise<RemoteRunnerInstructionSnapshot | undefined> {
  if (provider !== "claude" || !valid()) return undefined;
  if (!gateway.collectInstructions)
    throw new Error(
      "Instruction synchronization is unavailable. Update the editor before sending.",
    );
  const revision = readRemoteInstructionSourceRevision();
  const rootPath = readRemoteInstructionRoot(target.serverId, target.runnerId, target.projectId);
  const checkSource = () => {
    if (
      readRemoteInstructionSourceRevision() !== revision ||
      readRemoteInstructionRoot(target.serverId, target.runnerId, target.projectId) !== rootPath
    )
      throw new Error("The instruction source changed. Send the message again.");
  };
  const descriptor = await gateway.getRunner({ serverId: target.serverId });
  if (!valid()) return undefined;
  checkSource();
  if (descriptor.runnerId !== target.runnerId || !descriptor.capabilities.instructionSync)
    throw new Error(
      "Update this server to synchronize instruction files before sending a message.",
    );
  const snapshot = await gateway.collectInstructions(rootPath ? { rootPath } : {});
  if (!valid()) return undefined;
  checkSource();
  return snapshot;
}
