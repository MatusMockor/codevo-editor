import { Square } from "lucide-react";
import type { RemoteRunnerTasksSurface } from "../../application/useRemoteRunnerTasks";
import { remoteRunnerOutput } from "./remoteRunnerOutput";

export function RemoteTaskConversation({
  flow,
  output,
  selectedProject,
  serverName,
}: {
  readonly flow: RemoteRunnerTasksSurface;
  readonly output: ReturnType<typeof remoteRunnerOutput>;
  readonly selectedProject: string;
  readonly serverName: string;
}) {
  return (
    <>
      {flow.selectedTask ? (
        <>
          <div className="remote-task__heading">
            <strong>{flow.selectedTask.provider === "claude" ? "Claude" : "Codex"}</strong>
            <span role="status">{flow.selectedTask.status}</span>
            {["queued", "running"].includes(flow.selectedTask.status) && (
              <button type="button" disabled={flow.busy} onClick={() => void flow.cancel()}>
                <Square size={12} /> Stop task
              </button>
            )}
          </div>
          <div className="remote-task__prompt">
            {flow.selectedTask.parts
              .filter((part) => part.type === "text")
              .map((part, index) => (
                <p key={index}>{part.text}</p>
              ))}
          </div>
          {flow.selectedTask.parts.some((part) => part.type === "attachment") && (
            <small>Images attached to this task</small>
          )}
          {output.text && (
            <pre className="remote-task__output" aria-label="Agent progress">
              {output.text}
            </pre>
          )}
          {output.truncated && (
            <p>
              Some output has been shortened for display. Full recorded output remains on the
              server.
            </p>
          )}
          {flow.selectedTask.status === "draft" && (
            <button
              type="button"
              disabled={flow.busy || !selectedProject}
              onClick={() => void flow.startDraft(selectedProject)}
            >
              Start saved draft
            </button>
          )}
          {flow.diff && (
            <details className="remote-task__diff" open>
              <summary>Changes on server</summary>
              <p>
                These changes are in the server working copy. Your local files have not been
                updated.
              </p>
              <pre>{flow.diff.patch || "No tracked file changes."}</pre>
              {flow.diff.untrackedFiles.length > 0 && (
                <p>New files: {flow.diff.untrackedFiles.join(", ")}</p>
              )}
              {flow.diff.truncated && <p>The diff is too large to show in full.</p>}
            </details>
          )}
        </>
      ) : (
        <div className="remote-task__empty">
          <h2>Work on {serverName}</h2>
          <p>
            Choose a server project and send a task. You can return here to see its progress and
            changes.
          </p>
        </div>
      )}
    </>
  );
}
