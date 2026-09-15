// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RemoteAgentProjection } from "../../application/remoteAgentProjection";
import type { RemoteRunnerTask } from "../../domain/remoteRunner";
import { AgentThreadSession } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";

it("keeps 63 unchanged remote turn bodies idle across refreshes and changes only the latest", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const projection = new RemoteAgentProjection();
  const probe = vi.fn();
  const onReview = () => undefined;
  const tasks: RemoteRunnerTask[] = Array.from({ length: 64 }, (_, index) => ({
    id: `turn-${index}`,
    runnerId: "runner",
    projectId: "project",
    sequence: index + 1,
    provider: "claude",
    status: "succeeded",
    parts: [{ type: "text", text: `Prompt ${index}` }],
    createdAt: "2026-09-15T00:00:00Z",
    ...(index === 0 ? {} : { conversationId: "turn-0", parentTaskId: `turn-${index - 1}` }),
  }));
  const render = (snapshot: readonly RemoteRunnerTask[]) => {
    const thread = projection.project({
      serverId: "server",
      runnerId: "runner",
      tasks: snapshot,
      projects: [{ id: "project", name: "Project" }],
      replays: new Map(
        snapshot.map((task) => [
          task.id,
          [
            {
              taskId: task.id,
              sequence: 1,
              type: "task.output" as const,
              channel: "stdout" as const,
              createdAt: task.createdAt,
              text:
                JSON.stringify({
                  type: "assistant",
                  message: { content: [{ type: "text", text: `Response for ${task.id}` }] },
                }) + "\n",
            },
          ],
        ]),
      ),
      resumes: new Map(),
    })[0]!;
    act(() =>
      root.render(
        <AgentClockProvider>
          <AgentThreadSession
            thread={thread}
            composerRepositoryLabel="Project"
            onReviewInDiff={onReview}
            turnRenderProbe={probe}
            markdownRenderer={null}
          />
        </AgentClockProvider>,
      ),
    );
  };
  try {
    render(tasks);
    expect(probe).toHaveBeenCalledTimes(64);
    probe.mockClear();
    for (let index = 0; index < 10; index++) render(structuredClone(tasks));
    expect(probe).not.toHaveBeenCalled();
    render(
      tasks.map((task, index) =>
        index === 63 ? { ...task, parts: [{ type: "text", text: "Updated prompt" }] } : task,
      ),
    );
    expect(probe.mock.calls).toEqual([["turn-63"]]);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
