import type { RemoteRunnerDescriptor, RemoteRunnerServer } from "../domain/remoteRunner";
import {
  speechServerPreference,
  type SpeechServerCandidate,
} from "../domain/speechServerSelection";

export type SpeechServerInventory = Readonly<{
  serverId: string;
  connected: boolean;
  descriptor: RemoteRunnerDescriptor | null;
}>;
export type SpeechServerSelectionOptions = Readonly<{
  threadServerId: string | null;
  servers: readonly Pick<RemoteRunnerServer, "id" | "connected">[];
  snapshots: readonly SpeechServerInventory[];
}>;

export function speechServerCandidates(
  servers: readonly Pick<RemoteRunnerServer, "id" | "connected">[],
  snapshots: readonly SpeechServerInventory[],
): readonly SpeechServerCandidate[] {
  return servers.map((server) => {
    const snapshot = snapshots.find((item) => item.serverId === server.id);
    return {
      serverId: server.id,
      connected: server.connected && snapshot?.connected === true,
      speechTranscription: snapshot?.descriptor?.capabilities.speechTranscription === true,
    };
  });
}

export function speechDictationServerIds(options: SpeechServerSelectionOptions): readonly string[] {
  return speechServerPreference({
    threadServerId: options.threadServerId,
    candidates: speechServerCandidates(options.servers, options.snapshots),
  });
}
