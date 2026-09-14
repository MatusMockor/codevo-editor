import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Paperclip, RefreshCw, Send, X } from "lucide-react";
import { useRemoteRunnerTasks } from "../../application/useRemoteRunnerTasks";
import type { RemoteRunnerGateway, RemoteRunnerProvider } from "../../domain/remoteRunner";
import { RemoteTaskConversation } from "./RemoteTaskConversation";
import { RemoteProjectCloneForm } from "./RemoteProjectCloneForm";
import { remoteRunnerOutput } from "./remoteRunnerOutput";
import "./remoteRunnerTaskPanel.css";

export interface RemoteRunnerTaskPanelProps {
  readonly gateway: RemoteRunnerGateway;
  readonly serverId: string;
  readonly serverName: string;
  readonly workspaceOwner: string | null;
  readonly environmentPicker: ReactNode;
}
type ImageDraft = Readonly<{ name: string; mediaType: "image/png" | "image/jpeg"; base64: string }>;

export function RemoteRunnerTaskPanel(props: RemoteRunnerTaskPanelProps) {
  return <RemoteTaskSession key={`${props.workspaceOwner}:${props.serverId}`} {...props} />;
}

function RemoteTaskSession({
  gateway,
  serverId,
  serverName,
  workspaceOwner,
  environmentPicker,
}: RemoteRunnerTaskPanelProps) {
  const flow = useRemoteRunnerTasks({ gateway, serverId, workspaceOwner });
  const [projectId, setProjectId] = useState("");
  const [clonedProjectId, setClonedProjectId] = useState<string | null>(null);
  const { busy: taskBusy, refresh } = flow;
  useEffect(() => {
    if (clonedProjectId && !taskBusy) void refresh();
  }, [clonedProjectId, taskBusy, refresh]);
  useEffect(() => {
    if (clonedProjectId && flow.projects.some((project) => project.id === clonedProjectId)) {
      setProjectId(clonedProjectId);
      setClonedProjectId(null);
    }
  }, [clonedProjectId, flow.projects]);
  const [provider, setProvider] = useState<RemoteRunnerProvider>("codex");
  const [continuingTaskId, setContinuingTaskId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<readonly ImageDraft[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [readingImages, setReadingImages] = useState(false);
  const alive = useRef(true);
  const reading = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const selected = flow.selectedTask;
  const continuing = selected !== null && continuingTaskId === selected.id;
  const reviewing = selected !== null && !continuing;
  const canContinue =
    flow.descriptor?.capabilities.taskContinuation === true &&
    flow.resume?.available === true &&
    !!selected?.projectId;
  const selectedProject = selected?.projectId ?? (projectId || flow.projects[0]?.id || "");
  const selectedProvider = selected?.provider ?? provider;
  function clearDraft() {
    setPrompt("");
    setImages([]);
    setImageError(null);
    setContinuingTaskId(null);
  }
  function newConversation() {
    if (busy || flow.continuationUncertain) return;
    clearDraft();
    flow.resetSelection();
  }
  const busy = flow.busy || readingImages;
  const output = useMemo(
    () => remoteRunnerOutput(flow.events, flow.selectedTask?.provider ?? provider),
    [flow.events, flow.selectedTask?.provider, provider],
  );

  async function addImages(files: readonly File[]) {
    if (
      reading.current ||
      flow.busy ||
      flow.continuationUncertain ||
      reviewing ||
      (continuing && !canContinue)
    )
      return;
    setImageError(null);
    if (files.length + images.length > 4) {
      setImageError("Attach up to 4 images per task.");
      return;
    }
    if (
      files.some(
        (file) =>
          !["image/png", "image/jpeg"].includes(file.type) ||
          file.size > 5 * 1024 * 1024 ||
          file.size === 0,
      )
    ) {
      setImageError("Choose PNG or JPEG images, up to 5 MB each.");
      return;
    }
    reading.current = true;
    setReadingImages(true);
    try {
      const additions = await Promise.all(files.map(readImage));
      if (alive.current) setImages((current) => [...current, ...additions]);
    } catch {
      if (alive.current) setImageError("Could not read the image. Try attaching it again.");
    } finally {
      reading.current = false;
      if (alive.current) setReadingImages(false);
    }
  }

  async function submit() {
    if (
      busy ||
      reviewing ||
      (continuing && !canContinue) ||
      (!prompt.trim() && images.length === 0) ||
      !selectedProject
    )
      return;
    const task = await (continuing ? flow.continueTask : flow.submit)({
      projectId: selectedProject,
      provider: selectedProvider,
      prompt,
      attachments: images,
    });
    if (alive.current && task) {
      clearDraft();
    }
  }

  return (
    <section className="remote-task" aria-label={`Tasks on ${serverName}`}>
      <aside className="remote-task__history" aria-label="Remote task history">
        <div className="remote-task__heading">
          <strong>{serverName}</strong>
          <button
            type="button"
            aria-label="Refresh remote tasks"
            disabled={flow.loading || flow.busy}
            onClick={() => void flow.refresh()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <button
          type="button"
          disabled={busy || flow.continuationUncertain}
          onClick={newConversation}
        >
          New conversation
        </button>
        <p>Tasks stay on this server when you close the editor.</p>
        {flow.loading && <p role="status">Loading tasks…</p>}
        {!flow.loading && flow.tasks.length === 0 && <p>No tasks yet</p>}
        {flow.tasks.map((task) => (
          <button
            type="button"
            className="remote-task__history-item"
            aria-pressed={flow.selectedTask?.id === task.id}
            key={task.id}
            disabled={busy || flow.continuationUncertain}
            onClick={() => {
              clearDraft();
              flow.selectTask(task.id);
            }}
          >
            <span>
              {task.parts.find((part) => part.type === "text")?.text.slice(0, 100) ||
                "Untitled task"}
            </span>
            <small>
              {task.provider === "claude" ? "Claude" : "Codex"} · {task.status}
            </small>
          </button>
        ))}
        {flow.hasMore && (
          <button type="button" disabled={flow.loading} onClick={() => void flow.loadMore()}>
            Load more tasks
          </button>
        )}
      </aside>
      <div className="remote-task__main">
        <div className="remote-task__conversation">
          {flow.error && <p role="alert">{flow.error}</p>}
          {flow.continuationUncertain && (
            <p role="alert">
              The server may have accepted this follow-up. Refresh to recover its state, or retry
              the unchanged follow-up. Starting another conversation is paused until this is
              resolved.
            </p>
          )}
          <RemoteTaskConversation
            flow={flow}
            output={output}
            selectedProject={selectedProject}
            serverName={serverName}
          />
        </div>
        <form
          className="remote-task__composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void addImages(Array.from(event.dataTransfer.files));
          }}
        >
          {reviewing && (
            <div className="remote-task__resume">
              <button
                type="button"
                disabled={busy || !canContinue}
                onClick={() => setContinuingTaskId(selected.id)}
              >
                Continue conversation
              </button>
              <p>
                {resumeMessage(
                  flow.descriptor?.capabilities.taskContinuation === true,
                  flow.resume?.reason ?? null,
                  canContinue,
                )}
              </p>
            </div>
          )}
          {continuing && <p>Continuing this conversation in its existing server working copy.</p>}
          <div className="remote-task__controls">
            <label>
              Server project
              <select
                aria-label="Server project"
                value={selectedProject}
                disabled={busy || (selected !== null && selected.status !== "draft")}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {flow.projects.length === 0 && <option value="">No registered projects</option>}
                {flow.projects.map((project) => (
                  <option value={project.id} key={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <RemoteProjectCloneForm
              gateway={gateway}
              serverId={serverId}
              workspaceOwner={workspaceOwner}
              available={flow.descriptor?.capabilities.projectCloning === true}
              disabled={busy || flow.loading || selected !== null}
              onCloned={async (project) => {
                if (alive.current) setClonedProjectId(project.id);
              }}
            />
            <label>
              Provider
              <select
                aria-label="Remote provider"
                value={selectedProvider}
                disabled={busy || selected !== null}
                onChange={(event) =>
                  setProvider(event.target.value === "claude" ? "claude" : "codex")
                }
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>
            </label>
          </div>
          <textarea
            aria-label={continuing ? "Continue remote conversation" : "New remote task"}
            placeholder="What would you like to work on?"
            value={prompt}
            maxLength={32000}
            disabled={
              busy || flow.continuationUncertain || reviewing || (continuing && !canContinue)
            }
            onChange={(event) => setPrompt(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length) {
                event.preventDefault();
                void addImages(files);
              }
            }}
          />
          {images.length > 0 && (
            <div className="remote-task__images">
              {images.map((image, index) => (
                <div key={index}>
                  <img src={`data:${image.mediaType};base64,${image.base64}`} alt={image.name} />
                  <button
                    type="button"
                    aria-label={`Remove ${image.name}`}
                    disabled={busy || flow.continuationUncertain}
                    onClick={() =>
                      setImages((current) => current.filter((_, position) => position !== index))
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {imageError && <p role="alert">{imageError}</p>}
          <input
            hidden
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            multiple
            onChange={(event) => {
              void addImages(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <div className="remote-task__controls">
            {environmentPicker}
            <button
              type="button"
              aria-label="Attach images"
              disabled={
                busy ||
                flow.continuationUncertain ||
                reviewing ||
                (continuing && !canContinue) ||
                images.length >= 4
              }
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={16} />
            </button>
            <button
              type="submit"
              disabled={
                busy ||
                reviewing ||
                (continuing && !canContinue) ||
                flow.loading ||
                !selectedProject ||
                (!prompt.trim() && images.length === 0) ||
                !flow.descriptor?.capabilities.taskExecution
              }
            >
              <Send size={14} />
              {flow.busy ? "Sending…" : continuing ? "Send follow-up" : "Send new task"}
            </button>
          </div>
          <small>
            {selected
              ? "Choose Continue conversation to follow up, or New conversation for a separate task."
              : "A new conversation starts in a separate server working copy."}
          </small>
        </form>
      </div>
    </section>
  );
}

function readImage(file: File): Promise<ImageDraft> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Image read failed"));
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error("Invalid image"));
      resolve({
        name: file.name || "screenshot.png",
        mediaType: file.type === "image/jpeg" ? "image/jpeg" : "image/png",
        base64: reader.result.slice(reader.result.indexOf(",") + 1),
      });
    };
    reader.readAsDataURL(file);
  });
}

function resumeMessage(supported: boolean, reason: string | null, available: boolean): string {
  if (!supported) return "Update the server runner to continue conversations.";
  if (available) return "Continue with the same provider and server project.";
  switch (reason) {
    case "task_not_finished":
      return "Wait for this task to finish before continuing.";
    case "session_unavailable":
      return "This task has no resumable provider session. Start a new conversation.";
    case "newer_turn_exists":
      return "This conversation has a newer turn. Select its latest task to continue.";
    default:
      return "Checking whether this conversation can continue…";
  }
}
