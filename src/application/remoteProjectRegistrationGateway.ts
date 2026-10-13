import type { RemoteRunnerDescriptor, RemoteRunnerGateway } from "../domain/remoteRunner";
import {
  isRemoteProjectRegistration,
  isRemoteProjectRegistrationInput,
  type RemoteProjectRegistration,
  type RemoteProjectRegistrationInput,
} from "../domain/remoteProjectRegistration";
import type { RemoteRunnerFolderProjectSupport } from "./remoteAddProjectFolder";

export type RemoteProjectRegistrationRunner = Readonly<{
  runnerId: string;
  folderProjects: RemoteRunnerFolderProjectSupport;
}>;

export interface RemoteProjectRegistrationGateway {
  identifyRunner(): Promise<RemoteProjectRegistrationRunner>;
  registerProject(input: RemoteProjectRegistrationInput): Promise<RemoteProjectRegistration>;
}

export function createRemoteProjectRegistrationGateway(
  runner: RemoteRunnerGateway | null,
  serverId: string | null,
): RemoteProjectRegistrationGateway | null {
  if (!runner?.registerProject || serverId === null) return null;
  const register = runner.registerProject.bind(runner);
  return {
    async identifyRunner() {
      const descriptor = await runner.getRunner({ serverId });
      if (typeof descriptor?.runnerId !== "string" || descriptor.runnerId === "")
        throw new Error("Invalid server runner identity.");
      return { runnerId: descriptor.runnerId, folderProjects: folderProjectSupport(descriptor) };
    },
    async registerProject({ path, name }) {
      if (!isRemoteProjectRegistrationInput({ path, name }))
        throw new Error("Invalid server project folder.");
      const result = await register({ serverId, path, name });
      if (!isRemoteProjectRegistration(result))
        throw new Error("Invalid server project registration.");
      return result;
    },
  };
}

function folderProjectSupport(
  descriptor: RemoteRunnerDescriptor,
): RemoteRunnerFolderProjectSupport {
  if (descriptor.capabilities?.folderProjects === true) return "supported";
  return "unsupported";
}
