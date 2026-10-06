import { describe, expect, it } from "vitest";
import type { RemoteRunnerDescriptor } from "../domain/remoteRunner";
import { emptyRemoteInventory } from "./remoteAgentInventoryLoad";
import { speechDictationServerIds, speechServerCandidates } from "./speechDictationServers";

const descriptor = (speechTranscription?: boolean): RemoteRunnerDescriptor => ({
  protocolVersion: 1,
  runnerId: "runner",
  name: "Runner",
  capabilities: { taskExecution: true, eventReplay: true, speechTranscription },
});
const snapshot = (serverId: string, connected: boolean, speech?: boolean) => ({
  ...emptyRemoteInventory(serverId, connected),
  descriptor: descriptor(speech),
});
const servers = [
  { id: "a", connected: true },
  { id: "b", connected: true },
  { id: "c", connected: false },
  { id: "d", connected: true },
];

describe("speech dictation servers", () => {
  it("projects connection and capability from the live inventory", () => {
    expect(
      speechServerCandidates(servers, [
        snapshot("a", true, false),
        snapshot("b", false, true),
        snapshot("c", true, true),
        { ...emptyRemoteInventory("d", true), descriptor: null },
      ]),
    ).toEqual([
      { serverId: "a", connected: true, speechTranscription: false },
      { serverId: "b", connected: false, speechTranscription: true },
      { serverId: "c", connected: false, speechTranscription: true },
      { serverId: "d", connected: true, speechTranscription: false },
    ]);
    expect(speechServerCandidates(servers, [])).toEqual(
      servers.map((server) => ({
        serverId: server.id,
        connected: false,
        speechTranscription: false,
      })),
    );
  });
  it("lists the thread server first and the other capable servers in configured order", () => {
    const snapshots = [
      snapshot("a", true, true),
      snapshot("b", true, true),
      snapshot("c", true, true),
      snapshot("d", true, undefined),
    ];
    expect(speechDictationServerIds({ threadServerId: "b", servers, snapshots })).toEqual([
      "b",
      "a",
    ]);
    expect(speechDictationServerIds({ threadServerId: "c", servers, snapshots })).toEqual([
      "a",
      "b",
    ]);
    expect(speechDictationServerIds({ threadServerId: "d", servers, snapshots })).toEqual([
      "a",
      "b",
    ]);
    expect(speechDictationServerIds({ threadServerId: null, servers, snapshots })).toEqual([
      "a",
      "b",
    ]);
    expect(
      speechDictationServerIds({
        threadServerId: "a",
        servers,
        snapshots: [snapshot("d", true, false)],
      }),
    ).toEqual([]);
  });
});
