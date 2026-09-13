import { useEffect, useRef, useState } from "react";
import { useRemoteProjectClone } from "../../application/useRemoteProjectClone";
import type { RemoteRunnerGateway, RemoteRunnerProject } from "../../domain/remoteRunner";
import "./remoteProjectCloneForm.css";

type Props = Readonly<{
  gateway: RemoteRunnerGateway;
  serverId: string;
  workspaceOwner: string | null;
  available: boolean;
  disabled: boolean;
  onCloned(project: RemoteRunnerProject): Promise<void>;
}>;
export function RemoteProjectCloneForm(props: Props) {
  const clone = useRemoteProjectClone(props);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const delivered = useRef<string | null>(null);
  const callback = useRef(props.onCloned);
  callback.current = props.onCloned;
  useEffect(() => {
    if (
      clone.job?.status !== "succeeded" ||
      !clone.job.project ||
      delivered.current === clone.job.id
    )
      return;
    delivered.current = clone.job.id;
    void callback.current(clone.job.project);
  }, [clone.job]);
  return (
    <div className="remote-clone">
      <button
        type="button"
        aria-expanded={open}
        disabled={props.disabled && !open}
        onClick={() => setOpen(!open)}
      >
        Clone repository
      </button>
      {open && (
        <div
          className="remote-clone__fields"
          role="group"
          aria-label="Clone repository on server"
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.target instanceof HTMLInputElement)
              event.preventDefault();
          }}
        >
          {!props.available ? (
            <p role="status">Update the runner on this server to enable repository cloning.</p>
          ) : (
            <>
              <label>
                Repository URL
                <input
                  aria-label="Repository URL"
                  value={url}
                  maxLength={2048}
                  disabled={clone.busy}
                  placeholder="git@github.com:owner/project.git"
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
              <label>
                Folder name
                <input
                  aria-label="Repository folder name"
                  value={name}
                  maxLength={64}
                  disabled={clone.busy}
                  placeholder="project"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Branch (optional)
                <input
                  aria-label="Repository branch"
                  value={branch}
                  maxLength={255}
                  disabled={clone.busy}
                  placeholder="Default branch"
                  onChange={(event) => setBranch(event.target.value)}
                />
              </label>
              <p>
                Default destination: ~/Developer/{name || "<folder name>"}. Private repositories use
                Git access configured on the server.
              </p>
              <button
                type="button"
                disabled={props.disabled || clone.busy || !url.trim() || !name.trim()}
                onClick={() =>
                  void clone.start({
                    url: url.trim(),
                    name: name.trim(),
                    ...(branch.trim() ? { branch: branch.trim() } : {}),
                  })
                }
              >
                {clone.job && ["failed", "cancelled", "interrupted"].includes(clone.job.status)
                  ? "Retry clone"
                  : "Clone on server"}
              </button>
              {clone.busy && (
                <button
                  type="button"
                  disabled={clone.pending || !clone.job}
                  onClick={() => void clone.cancel()}
                >
                  Cancel clone
                </button>
              )}
              {clone.pending && <p role="status">Contacting server…</p>}
              {clone.job && (
                <p role="status">
                  Clone {clone.job.status}
                  {clone.job.status === "succeeded" ? ". Project is ready on the server." : "."}
                </p>
              )}
              {(clone.error || clone.job?.error) && (
                <p role="alert">{clone.error || clone.job?.error}</p>
              )}
              <p>
                You can close the editor while cloning. Completed projects appear in the server
                project list when you return.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
