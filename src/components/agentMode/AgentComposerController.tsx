import type { AgentModelFavoritesPersistence } from "../../application/useAgentModelFavorites";
import { AgentComposer } from "./AgentComposer";
import {
  useAgentComposerPromptState,
  type AgentComposerControllerProps as AgentComposerPresentation,
  type AgentComposerPromptController,
} from "./useAgentComposerState";

export interface AgentComposerControllerProps {
  readonly composerProps: AgentComposerPresentation;
  readonly modelFavoritesPersistence?: AgentModelFavoritesPersistence | null;
  readonly submissionBlocked: boolean;
  readonly submit: AgentComposerPromptController["submit"];
}

export function AgentComposerController({
  composerProps,
  modelFavoritesPersistence = null,
  submissionBlocked,
  submit,
}: AgentComposerControllerProps) {
  const controlledProps = useAgentComposerPromptState({
    composerProps,
    submissionBlocked,
    submit,
  });
  return (
    <AgentComposer {...controlledProps} modelFavoritesPersistence={modelFavoritesPersistence} />
  );
}
