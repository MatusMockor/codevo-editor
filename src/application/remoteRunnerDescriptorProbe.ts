import type { RemoteRunnerGateway, RemoteRunnerServerRequest } from "../domain/remoteRunner";
import {
  NO_REMOTE_RUNNER_DESCRIPTOR_FOLLOW_UP,
  remoteRunnerNeedsDescriptorFollowUp,
  type RemoteRunnerDescriptorFollowUp,
} from "../domain/remoteRunnerReachability";

export interface RemoteRunnerDescriptorProbe {
  readonly gateway: RemoteRunnerGateway;
  answeredRunnerId(): string | null;
  followUp(
    request: RemoteRunnerServerRequest,
    expectedRunnerId: string | null,
  ): Promise<RemoteRunnerDescriptorFollowUp>;
}

export function probeRemoteRunnerDescriptor(
  gateway: RemoteRunnerGateway,
): RemoteRunnerDescriptorProbe {
  let answered: string | null = null;
  const getRunner: RemoteRunnerGateway["getRunner"] = async (request) => {
    const descriptor = await gateway.getRunner(request);
    answered = descriptor.runnerId;
    return descriptor;
  };
  const observed = new Proxy(gateway, {
    get(target, property) {
      if (property === "getRunner") return getRunner;
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return value.bind(target);
    },
  });
  const followUp = async (
    request: RemoteRunnerServerRequest,
    expectedRunnerId: string | null,
  ): Promise<RemoteRunnerDescriptorFollowUp> => {
    if (!remoteRunnerNeedsDescriptorFollowUp(expectedRunnerId, answered))
      return NO_REMOTE_RUNNER_DESCRIPTOR_FOLLOW_UP;
    try {
      const descriptor = await gateway.getRunner(request);
      return { kind: "answered", runnerId: descriptor.runnerId };
    } catch (error) {
      return { kind: "failed", error };
    }
  };
  return { gateway: observed, answeredRunnerId: () => answered, followUp };
}
