import { useRef, type ReactNode } from "react";
import type { AgentViewCommandBridge } from "../../../application/agentViewCommandBridge";
import type { SpeechDictationPorts } from "../../../application/speechDictationPorts";
import type { SpeechLanguage } from "../../../domain/speechDictation";
import type { AgentComposerMode } from "../AgentComposer";
import {
  AgentComposerController,
  type AgentComposerControllerProps,
} from "../AgentComposerController";
import {
  agentConversationEscapeAction,
  useAgentConversationEscape,
} from "../useAgentConversationEscape";
import { AgentDictationProvider } from "./AgentDictationProvider";

const LAUNCH = {
  provider: "claudeCode",
  model: "default",
  mode: "default",
  effort: "default",
} as const;

export interface DictationComposerScene {
  readonly draftKey: string;
  readonly serverIds: readonly string[];
  readonly visible: boolean;
  readonly language: SpeechLanguage | undefined;
  readonly locale: string;
  readonly mode: AgentComposerMode;
  readonly running: boolean;
  readonly provided: boolean;
}

export interface DictationComposerTestSceneProps {
  readonly scene: DictationComposerScene;
  readonly ports: SpeechDictationPorts;
  readonly commands: AgentViewCommandBridge | null;
  readonly submit: AgentComposerControllerProps["submit"];
  readonly onStop: () => void;
  readonly renderDrawerEnd: () => ReactNode;
}

export function DictationComposerTestScene({
  scene,
  ports,
  commands,
  submit,
  onStop,
  renderDrawerEnd,
}: DictationComposerTestSceneProps) {
  const conversationRef = useRef<HTMLDivElement>(null);
  const composerProps: AgentComposerControllerProps["composerProps"] = {
    draftKey: scene.draftKey,
    promptOwnerKey: scene.draftKey,
    target: {
      projectLabel: "app",
      projectRoot: "/workspace/app",
      selectedRepositoryRoot: "/workspace/app",
      repositoryOptions: [],
    },
    isolation: "in-place",
    isolationReason: null,
    worktreeAvailable: false,
    worktreeOnly: false,
    worktreeOnlyReason: null,
    guard: { kind: "safe" },
    launch: LAUNCH,
    launchProvider: "claudeCode",
    dispatching: false,
    running: scene.running,
    mode: scene.mode,
    onStop,
    onSelectRepository: noop,
    onIsolationChange: noop,
    onLaunchChange: noop,
    onNewThread: noop,
  };
  useAgentConversationEscape(conversationRef, agentConversationEscapeAction(composerProps));
  return (
    <AgentDictationProvider
      commands={commands}
      language={scene.language}
      locale={scene.locale}
      ports={scene.provided ? ports : null}
      serverIds={scene.serverIds}
      visible={scene.visible}
    >
      <input aria-label="Outside input" data-outside-input="" />
      <div ref={conversationRef}>
        <button data-outside-button="" type="button">
          Copy
        </button>
        <AgentComposerController
          composerProps={composerProps}
          onOpenProviderSettings={noop}
          providerEnabled={PROVIDERS_ENABLED}
          providerManagement={NO_PROVIDER_MANAGEMENT}
          renderDrawerEnd={renderDrawerEnd}
          submissionBlocked={false}
          submit={submit}
        />
      </div>
    </AgentDictationProvider>
  );
}

const PROVIDERS_ENABLED = { claudeCode: true, codex: true } as const;
const NO_PROVIDER_MANAGEMENT =
  null as unknown as AgentComposerControllerProps["providerManagement"];

function noop(): void {
  return undefined;
}
