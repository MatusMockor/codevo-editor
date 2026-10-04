import { RemoteRepositoryIdentityCoordinator } from "../../application/remoteRepositoryIdentityCoordinator";
import { TauriRemoteRepositoryIdentityGateway } from "../../infrastructure/tauriRemoteRepositoryIdentityGateway";

export const SHARED_REMOTE_REPOSITORY_IDENTITY = new RemoteRepositoryIdentityCoordinator(
  new TauriRemoteRepositoryIdentityGateway(),
);
