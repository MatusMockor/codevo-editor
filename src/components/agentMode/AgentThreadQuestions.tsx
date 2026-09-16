import { useState } from "react";
import type { AgentQuestionGateway } from "../../application/agentQuestionPorts";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentQuestionOwner } from "../../application/agentQuestionOwner";
import { useAgentQuestions } from "../../application/useAgentQuestions";
import { AgentQuestionCard } from "./AgentQuestionCard";

export function AgentThreadQuestions({
  gateway,
  thread,
}: {
  readonly gateway: AgentQuestionGateway | null;
  readonly thread: AgentThreadView | null;
}) {
  const candidate = agentQuestionOwner(thread);
  const key = JSON.stringify(candidate);
  return <QuestionScope key={key} gateway={gateway} thread={thread} />;
}
function QuestionScope({
  gateway,
  thread,
}: {
  readonly gateway: AgentQuestionGateway | null;
  readonly thread: AgentThreadView | null;
}) {
  // The keyed parent remounts on exact task/owner changes; stream updates preserve the lease.
  const [owner] = useState(() => agentQuestionOwner(thread));
  const questions = useAgentQuestions(gateway, owner, thread?.lifecycle === "running");
  if (!owner) return null;
  return (
    <div className="agent-thread-questions" aria-label="Agent questions">
      {questions.requests.map((request) => (
        <AgentQuestionCard
          key={request.id}
          request={request}
          pending={questions.answering === request.id}
          error={request.status === "pending" ? questions.error : null}
          onAnswer={(response) => questions.answer(request.id, response)}
        />
      ))}
      {questions.error &&
        !questions.requests.some((request) => request.status === "pending") &&
        thread?.lifecycle === "running" && <p role="status">{questions.error}</p>}
    </div>
  );
}
