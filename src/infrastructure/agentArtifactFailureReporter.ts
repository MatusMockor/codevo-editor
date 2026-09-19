import type { AgentArtifactFailureReporter } from "../application/agentArtifactPorts";

const MESSAGE_LIMIT = 512;

function summary(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, MESSAGE_LIMIT);
  return String(error).slice(0, MESSAGE_LIMIT);
}

/** Field failures stay diagnosable without ever logging artifact bytes or paths. */
export const reportAgentArtifactFailure: AgentArtifactFailureReporter = (source, error) => {
  console.error(`${source}: ${summary(error)}`);
};
