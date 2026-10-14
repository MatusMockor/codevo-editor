import { vi, type Mock } from "vitest";
import type { AgentApprovalGateway } from "../../application/agentApprovalPorts";
import type { AgentQuestionGateway } from "../../application/agentQuestionPorts";
import type {
  AgentThreadView,
  RemoteAgentThreadExecution,
} from "../../application/agentThreadPorts";
import type { AgentTurn } from "../../domain/agentThread";
import type { RemoteRunnerReachability } from "../../domain/remoteRunnerReachability";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";

export const COMPOSER_REQUEST_APP = "/workspace/app";
export const COMPOSER_REQUEST_WORKSPACE = "agent-root:app";
export const COMPOSER_REQUEST_TURN = "agt-turn-0001";
export const COMPOSER_REQUEST_SERVER = "srv-a";
export const COMPOSER_REQUEST_CONVERSATION = "0b8f0f5e-1c2d-4e3f-8a9b-000000000001";
export const COMPOSER_REQUEST_QUESTION_PROMPT = "Which scope should the change cover?";

export interface LocalAnswerGatewayFake extends AgentQuestionGateway, AgentApprovalGateway {
  readonly answer: Mock<AgentQuestionGateway["answer"]>;
  readonly answerApproval: Mock<AgentApprovalGateway["answerApproval"]>;
}

export function localAnswerGatewayFake(): LocalAnswerGatewayFake {
  return {
    answer: vi.fn<AgentQuestionGateway["answer"]>(() => new Promise(() => undefined)),
    answerApproval: vi.fn<AgentApprovalGateway["answerApproval"]>(
      () => new Promise(() => undefined),
    ),
  };
}

export function composerRequestTurn(
  turnId: string = COMPOSER_REQUEST_TURN,
  running = true,
): AgentTurn {
  return {
    turnId,
    prompt: "Do the work",
    status: running ? { kind: "running" } : { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1_760_000_000_000,
    endedAtEpochMs: running ? null : 1_760_000_100_000,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

export function localComposerThread(
  threadId = "agt-thread-0001",
  workspaceId = COMPOSER_REQUEST_WORKSPACE,
  turns: readonly AgentTurn[] = [composerRequestTurn()],
): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    lifecycle: "running",
    thread: {
      ...base,
      threadId,
      target: { isolation: "in-place", worktreePath: null },
      owner: {
        rootKey: COMPOSER_REQUEST_APP,
        ownerId: workspaceId,
        repositoryRoot: COMPOSER_REQUEST_APP,
      },
      turns: [...turns],
    },
  });
}

export function remoteComposerExecution(
  overrides: Partial<RemoteAgentThreadExecution> = {},
  reachability: RemoteRunnerReachability = { kind: "reachable" },
): RemoteAgentThreadExecution {
  return {
    kind: "remote",
    serverId: COMPOSER_REQUEST_SERVER,
    runnerId: "runner-1",
    projectId: "project-1",
    conversationId: COMPOSER_REQUEST_CONVERSATION,
    latestTaskId: COMPOSER_REQUEST_TURN,
    resume: null,
    reachability,
    requests: {
      source: "snapshot",
      approvals: true,
      sequences: { [COMPOSER_REQUEST_TURN]: 1 },
      awaitingApproval: [],
    },
    ...overrides,
  };
}

export function remoteComposerThread(execution: RemoteAgentThreadExecution): AgentThreadView {
  const view = localComposerThread(
    `remote-thread:${execution.serverId}:${execution.runnerId}:${execution.conversationId}`,
  );
  return { ...view, execution };
}

export function composerQuestionCard(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('[aria-label="Agent question"]');
}

export function composerApprovalPanel(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('[role="group"][aria-label="Approval request"]');
}

export function composerButton(host: HTMLElement, name: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent === name,
    ) ?? null
  );
}

export function chooseComposerOption(host: HTMLElement, label: string): void {
  const option = [...host.querySelectorAll<HTMLLabelElement>(".agent-question-card__choice")].find(
    (candidate) => candidate.textContent?.startsWith(label),
  );
  option?.querySelector("input")?.click();
}
