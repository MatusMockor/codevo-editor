import type { ReactNode } from "react";
import type { AgentApprovalGateway } from "../../application/agentApprovalPorts";
import type { AgentQuestionGateway } from "../../application/agentQuestionPorts";
import type { AgentThreadRequestFeed } from "../../application/agentThreadRequestPorts";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import {
  AgentComposerController,
  type AgentComposerControllerProps,
} from "./AgentComposerController";
import { COMPOSER_REQUEST_APP } from "./agentComposerRequestTestFixtures";
import { AgentThreadRequestFeedContext } from "./agentThreadRequestFeedContext";
import { AgentThreadRequestsScope } from "./AgentThreadRequestsScope";

const noop = (): void => undefined;
const submit: AgentComposerControllerProps["submit"] = async () => true;
const PROVIDERS_ENABLED = { claudeCode: true, codex: true } as const;
const PROVIDER_MANAGEMENT = unconfiguredAgentProviderManagement();
const COMPOSER_PROPS: AgentComposerControllerProps["composerProps"] = {
  draftKey: "thread",
  promptOwnerKey: "thread",
  target: {
    projectLabel: "app",
    projectRoot: COMPOSER_REQUEST_APP,
    selectedRepositoryRoot: COMPOSER_REQUEST_APP,
    repositoryOptions: [],
  },
  isolation: "in-place",
  isolationReason: null,
  worktreeAvailable: false,
  worktreeOnly: false,
  worktreeOnlyReason: null,
  guard: { kind: "safe" },
  launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
  launchProvider: "claudeCode",
  dispatching: false,
  running: true,
  mode: { kind: "steer", threadId: "thread" },
  onStop: noop,
  onSelectRepository: noop,
  onIsolationChange: noop,
  onLaunchChange: noop,
  onNewThread: noop,
};

export function ComposerWithRequests({
  feed,
  gateway,
  thread,
  children = null,
}: {
  readonly feed: AgentThreadRequestFeed | null;
  readonly gateway: (AgentQuestionGateway & AgentApprovalGateway) | null;
  readonly thread: AgentThreadView | null;
  readonly children?: ReactNode;
}) {
  return (
    <AgentThreadRequestFeedContext.Provider value={feed}>
      <AgentThreadRequestsScope thread={thread}>
        <AgentComposerController
          composerProps={COMPOSER_PROPS}
          interactions={{ gateway, thread }}
          onOpenProviderSettings={noop}
          providerEnabled={PROVIDERS_ENABLED}
          providerManagement={PROVIDER_MANAGEMENT}
          submissionBlocked={false}
          submit={submit}
        />
        {children}
      </AgentThreadRequestsScope>
    </AgentThreadRequestFeedContext.Provider>
  );
}
