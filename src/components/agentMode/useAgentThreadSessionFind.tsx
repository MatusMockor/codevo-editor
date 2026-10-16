import type { AgentThread } from "../../domain/agentThread";
import { AgentThreadFindBar } from "./AgentThreadFindBar";
import type { AgentThreadSessionProps } from "./AgentThreadSession";
import { useAgentThreadFindResults, type AgentThreadFindControl } from "./useAgentThreadFind";

type AgentThreadSessionFindProps = Pick<
  AgentThreadSessionProps,
  "findBar" | "findOpen" | "findHits" | "findQuery" | "findHitIndex" | "reveal"
>;

const NO_CONTROLLED_FIND: AgentThreadSessionFindProps = {};

export function useAgentThreadSessionFind(
  control: AgentThreadFindControl | null,
  onClose: (() => void) | undefined,
  shown: AgentThread | null,
): AgentThreadSessionFindProps {
  const results = useAgentThreadFindResults(control, shown);
  if (control === null) return NO_CONTROLLED_FIND;
  const { open, query } = control;
  return {
    findBar: open ? (
      <AgentThreadFindBar
        currentIndex={results.hitIndex}
        hitCount={results.hits.length}
        onChangeQuery={control.setQuery}
        onClose={onClose ?? control.close}
        onNavigate={control.navigate}
        query={query}
        truncated={results.truncated}
      />
    ) : null,
    findOpen: open,
    findHits: open ? results.hits : undefined,
    findQuery: open ? query : undefined,
    findHitIndex: open && results.hitIndex >= 0 ? results.hitIndex : undefined,
    reveal: results.reveal,
  };
}
