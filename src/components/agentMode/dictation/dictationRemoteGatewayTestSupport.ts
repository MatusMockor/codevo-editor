import { vi } from "vitest";
import type { RemoteRunnerGateway } from "../../../domain/remoteRunner";
import { TauriRemoteRunnerGateway } from "../../../infrastructure/tauriRemoteRunnerGateway";
import type { ControlledInvoke } from "../../../test/speechDictationTestSupport";

export interface DictationServerFixture {
  readonly id: string;
  readonly connected: boolean;
  readonly speechTranscription: boolean | undefined;
}

export function dictationRemoteGateway(
  servers: readonly DictationServerFixture[],
  speech: ControlledInvoke,
): RemoteRunnerGateway {
  const invoke = async (command: string, args?: Readonly<{ request: unknown }>) => {
    const request = args?.request as Readonly<{ serverId?: string }> | undefined;
    const server = servers.find((entry) => entry.id === request?.serverId);
    if (command === "remote_runner_list_servers") {
      return servers.map((entry) => ({
        id: entry.id,
        name: `Server ${entry.id}`,
        host: entry.id,
        username: "codex",
        port: 22,
        connected: entry.connected,
      }));
    }
    if (command === "remote_runner_get_runner" && server !== undefined) {
      return {
        protocolVersion: 1,
        runnerId: `runner-${server.id}`,
        name: `Server ${server.id}`,
        capabilities: {
          taskExecution: true,
          eventReplay: true,
          taskLaunchOptions: true,
          ...(server.speechTranscription === undefined
            ? {}
            : { speechTranscription: server.speechTranscription }),
        },
      };
    }
    if (command === "remote_runner_list_projects") return { items: [] };
    if (command === "remote_runner_list_tasks") return { items: [], nextCursor: null };
    if (command === "remote_runner_transcribe_speech") return speech.invoke(command, args);
    return Promise.reject(new Error(`Unexpected command ${command}`));
  };
  const tauri = new TauriRemoteRunnerGateway(invoke);
  const unused = vi.fn().mockRejectedValue(new Error("Not used by dictation"));
  return {
    collectInstructions: unused,
    listServers: () => tauri.listServers(),
    connectServer: unused,
    disconnectServer: unused,
    removeServer: unused,
    getRunner: (request) => tauri.getRunner(request),
    transcribeSpeech: (request) => tauri.transcribeSpeech(request),
    listProjects: (request) => tauri.listProjects(request),
    cloneProject: unused,
    getProjectClone: unused,
    cancelProjectClone: unused,
    listTasks: (request) => tauri.listTasks(request),
    createTask: unused,
    startTask: unused,
    getTask: unused,
    getTaskResume: unused,
    continueTask: unused,
    cancelTask: unused,
    listEvents: unused,
    getDiff: unused,
    uploadAttachment: unused,
  };
}
