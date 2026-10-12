import {
  agentMcpServerCallbackUrl,
  agentMcpServerManagementError,
  agentMcpServerRetainedLoginId,
  isAgentMcpServerLoginId,
  parseAgentMcpServerChange,
  parseAgentMcpServerLoginState,
  parseAgentMcpServerLoginStep,
  type AgentMcpServerChange,
  type AgentMcpServerChangeRequest,
  type AgentMcpServerLoginDelivery,
  type AgentMcpServerLoginIdRequest,
  type AgentMcpServerLoginMode,
  type AgentMcpServerLoginRequest,
  type AgentMcpServerLoginState,
  type AgentMcpServerLoginStep,
  type AgentMcpServerManagementErrorKind,
} from "../domain/agentMcpServerManagement";
import { isAgentMcpServerName } from "../domain/agentMcpServers";
import {
  remoteMcpServersRequest,
  type AgentMcpServersLocalTarget,
  type AgentMcpServersServerTarget,
  type AgentMcpServersTarget,
} from "../domain/agentMcpServersTarget";
import type { RemoteRunnerMcpServersRequest } from "../domain/remoteRunner";
import type { AgentMcpRunnerSupport } from "./agentMcpServersGateway";

export interface AgentMcpServerManagementGateway {
  change(request: AgentMcpServerChangeRequest): Promise<void>;
  startLogin(request: AgentMcpServerLoginRequest): Promise<AgentMcpServerLoginStep>;
  loginState(request: AgentMcpServerLoginIdRequest): Promise<AgentMcpServerLoginState>;
  cancelLogin(request: AgentMcpServerLoginIdRequest): Promise<void>;
}

export type RemoteAgentMcpServerManagementRequest = RemoteRunnerMcpServersRequest;
export type RemoteAgentMcpServerChangeRequest = RemoteAgentMcpServerManagementRequest &
  Readonly<{ change: AgentMcpServerChange }>;
export type RemoteAgentMcpServerLoginRequest = RemoteAgentMcpServerManagementRequest &
  Readonly<{ name: string; mode: AgentMcpServerLoginMode }>;
export type RemoteAgentMcpServerLoginIdRequest = RemoteAgentMcpServerManagementRequest &
  Readonly<{ loginId: string }>;
export type RemoteAgentMcpServerLoginCallbackRequest = RemoteAgentMcpServerLoginIdRequest &
  Readonly<{ callbackUrl: string }>;

export interface RemoteAgentMcpServerManagementGateway {
  changeMcpServer?(request: RemoteAgentMcpServerChangeRequest): Promise<void>;
  startMcpServerLogin?(request: RemoteAgentMcpServerLoginRequest): Promise<AgentMcpServerLoginStep>;
  getMcpServerLogin?(
    request: RemoteAgentMcpServerLoginIdRequest,
  ): Promise<AgentMcpServerLoginState>;
  submitMcpServerLoginCallback?(request: RemoteAgentMcpServerLoginCallbackRequest): Promise<void>;
  cancelMcpServerLogin?(request: RemoteAgentMcpServerLoginIdRequest): Promise<void>;
}

export interface AgentMcpServerManagementRunners {
  managementSupport(serverId: string, runnerId: string): AgentMcpRunnerSupport;
}

export type AgentMcpServerManagementSupport = "supported" | "unsupported";

export interface AgentMcpServerManagement {
  support(target: AgentMcpServersTarget): AgentMcpServerManagementSupport;
  change(target: AgentMcpServersTarget, change: AgentMcpServerChange): Promise<void>;
  startLogin(
    target: AgentMcpServersTarget,
    name: string,
    mode: AgentMcpServerLoginMode,
  ): Promise<AgentMcpServerLoginStep>;
  loginState(target: AgentMcpServersTarget, loginId: string): Promise<AgentMcpServerLoginState>;
  submitLoginCallback(
    target: AgentMcpServersTarget,
    loginId: string,
    callbackUrl: string,
  ): Promise<void>;
  cancelLogin(target: AgentMcpServersTarget, loginId: string): Promise<void>;
}

type CompleteRemoteGateway = Required<RemoteAgentMcpServerManagementGateway>;

export function agentMcpServerManagement(
  local: AgentMcpServerManagementGateway | null,
  remote: RemoteAgentMcpServerManagementGateway | null,
  runners: AgentMcpServerManagementRunners,
): AgentMcpServerManagement {
  const onServer = (target: AgentMcpServersServerTarget): CompleteRemoteGateway => {
    const gateway = completeRemoteGateway(remote);
    if (gateway === null) throw agentMcpServerManagementError("unsupportedRunner");
    const refused = supportRefusal(runners.managementSupport(target.serverId, target.runnerId));
    if (refused !== null) throw agentMcpServerManagementError(refused);
    return gateway;
  };
  const onDevice = (): AgentMcpServerManagementGateway => {
    if (local === null) throw agentMcpServerManagementError("unavailable");
    return local;
  };
  const requestLogin = (
    target: AgentMcpServersTarget,
    name: string,
    mode: AgentMcpServerLoginMode,
  ): Promise<AgentMcpServerLoginStep> => {
    switch (target.kind) {
      case "local":
        return onDevice().startLogin({ ...localRequest(target), name, mode });
      case "server":
        return onServer(target).startMcpServerLogin({
          ...remoteMcpServersRequest(target),
          name,
          mode,
        });
      default: {
        const unreachable: never = target;
        return unreachable;
      }
    }
  };
  const cancelLogin = async (target: AgentMcpServersTarget, loginId: string): Promise<void> => {
    const id = validLoginId(loginId);
    switch (target.kind) {
      case "local":
        return onDevice().cancelLogin({ loginId: id });
      case "server":
        return onServer(target).cancelMcpServerLogin({
          ...remoteMcpServersRequest(target),
          loginId: id,
        });
      default: {
        const unreachable: never = target;
        return unreachable;
      }
    }
  };
  return {
    support(target) {
      switch (target.kind) {
        case "local":
          return local === null ? "unsupported" : "supported";
        case "server":
          return serverSupport(remote, runners, target);
        default: {
          const unreachable: never = target;
          return unreachable;
        }
      }
    },
    async change(target, change) {
      const valid = validChange(target, change);
      switch (target.kind) {
        case "local":
          return onDevice().change({ ...localRequest(target), change: valid });
        case "server":
          return onServer(target).changeMcpServer({
            ...remoteMcpServersRequest(target),
            change: valid,
          });
        default: {
          const unreachable: never = target;
          return unreachable;
        }
      }
    },
    async startLogin(target, name, mode) {
      if (!isAgentMcpServerName(name)) throw agentMcpServerManagementError("invalidRequest");
      const answer = await requestLogin(target, name, mode);
      const step = acceptedStep(answer, expectedDelivery(target));
      if (step !== null) return step;
      const retained = agentMcpServerRetainedLoginId(answer);
      if (retained !== null) void cancelLogin(target, retained).catch(ignoreFailure);
      throw agentMcpServerManagementError("unavailable");
    },
    async loginState(target, loginId) {
      const id = validLoginId(loginId);
      switch (target.kind) {
        case "local":
          return expectedState(await onDevice().loginState({ loginId: id }));
        case "server":
          return expectedState(
            await onServer(target).getMcpServerLogin({
              ...remoteMcpServersRequest(target),
              loginId: id,
            }),
          );
        default: {
          const unreachable: never = target;
          return unreachable;
        }
      }
    },
    async submitLoginCallback(target, loginId, callbackUrl) {
      const id = validLoginId(loginId);
      const url = agentMcpServerCallbackUrl(callbackUrl);
      if (url === null || target.kind === "local")
        throw agentMcpServerManagementError("callbackRejected");
      return onServer(target).submitMcpServerLoginCallback({
        ...remoteMcpServersRequest(target),
        loginId: id,
        callbackUrl: url,
      });
    },
    cancelLogin,
  };
}

function serverSupport(
  remote: RemoteAgentMcpServerManagementGateway | null,
  runners: AgentMcpServerManagementRunners,
  target: AgentMcpServersServerTarget,
): AgentMcpServerManagementSupport {
  if (completeRemoteGateway(remote) === null) return "unsupported";
  if (runners.managementSupport(target.serverId, target.runnerId) !== "supported")
    return "unsupported";
  return "supported";
}

function completeRemoteGateway(
  remote: RemoteAgentMcpServerManagementGateway | null,
): CompleteRemoteGateway | null {
  if (remote === null) return null;
  const {
    changeMcpServer,
    startMcpServerLogin,
    getMcpServerLogin,
    submitMcpServerLoginCallback,
    cancelMcpServerLogin,
  } = remote;
  if (changeMcpServer === undefined || startMcpServerLogin === undefined) return null;
  if (getMcpServerLogin === undefined || cancelMcpServerLogin === undefined) return null;
  if (submitMcpServerLoginCallback === undefined) return null;
  return {
    changeMcpServer: (request) => changeMcpServer.call(remote, request),
    startMcpServerLogin: (request) => startMcpServerLogin.call(remote, request),
    getMcpServerLogin: (request) => getMcpServerLogin.call(remote, request),
    submitMcpServerLoginCallback: (request) => submitMcpServerLoginCallback.call(remote, request),
    cancelMcpServerLogin: (request) => cancelMcpServerLogin.call(remote, request),
  };
}

function expectedDelivery(target: AgentMcpServersTarget): AgentMcpServerLoginDelivery {
  switch (target.kind) {
    case "local":
      return "automatic";
    case "server":
      return "paste";
    default: {
      const unreachable: never = target;
      return unreachable;
    }
  }
}

function ignoreFailure(): void {}

function acceptedStep(
  answer: unknown,
  delivery: AgentMcpServerLoginDelivery,
): AgentMcpServerLoginStep | null {
  try {
    const step = parseAgentMcpServerLoginStep(answer);
    if (step.kind === "awaitingCallback" && step.delivery !== delivery) return null;
    return step;
  } catch {
    return null;
  }
}

function supportRefusal(support: AgentMcpRunnerSupport): AgentMcpServerManagementErrorKind | null {
  switch (support) {
    case "supported":
      return null;
    case "unsupported":
      return "unsupportedRunner";
    case "unavailable":
      return "serverUnavailable";
    default: {
      const unreachable: never = support;
      return unreachable;
    }
  }
}

function localRequest(
  target: AgentMcpServersLocalTarget,
): Pick<AgentMcpServerChangeRequest, "repositoryRoot" | "provider"> {
  return { repositoryRoot: target.repositoryRoot, provider: target.provider };
}

function validChange(
  target: AgentMcpServersTarget,
  change: AgentMcpServerChange,
): AgentMcpServerChange {
  try {
    return parseAgentMcpServerChange(change, target.provider);
  } catch {
    throw agentMcpServerManagementError("invalidRequest");
  }
}

function validLoginId(loginId: string): string {
  if (!isAgentMcpServerLoginId(loginId)) throw agentMcpServerManagementError("loginInactive");
  return loginId;
}

function expectedState(state: AgentMcpServerLoginState): AgentMcpServerLoginState {
  return parsedOrUnavailable(() => parseAgentMcpServerLoginState(state));
}

function parsedOrUnavailable<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw agentMcpServerManagementError("unavailable");
  }
}
