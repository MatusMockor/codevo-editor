import { Bot, Code, SquareTerminal } from "lucide-react";
import type { WorkspaceTrustDecision } from "../../application/workspaceTrustPrompt";
import type { WorkspaceTrustConfirmation } from "../../domain/trust";
import { Button } from "../../ui/foundation/Button";
import { Dialog } from "../../ui/foundation/Dialog";
import "./projects.css";

export interface WorkspaceTrustDialogProps {
  readonly request: WorkspaceTrustConfirmation | null;
  onDecide(decision: WorkspaceTrustDecision): void;
}

export function WorkspaceTrustDialog({ request, onDecide }: WorkspaceTrustDialogProps) {
  if (request === null) return null;
  return (
    <Dialog
      description="Agents can only start in trusted projects. Trust it if you know where this code comes from."
      dismissOnBackdrop={false}
      footer={
        <>
          <Button onClick={() => onDecide("notNow")}>Not now</Button>
          <Button onClick={() => onDecide("trust")} variant="primary">
            Trust project
          </Button>
        </>
      }
      onClose={() => onDecide("notNow")}
      open
      title={`Trust ${request.label}?`}
      width="sm"
    >
      <div className="cv-trust__where">
        <span aria-hidden="true" className="cv-project-favicon">
          {projectInitial(request.label)}
        </span>
        <span className="cv-trust__where-text">
          <span className="cv-trust__path" title={request.rootPath}>
            {request.rootPath}
          </span>
          <span className="cv-trust__origin">{originLabel(request)}</span>
        </span>
      </div>
      <ul aria-label="Trusting allows" className="cv-trust__allows">
        <li>
          <Bot aria-hidden="true" size={14} />
          Agents run commands and edit files in this folder
        </li>
        <li>
          <SquareTerminal aria-hidden="true" size={14} />
          Package scripts, tasks, tests and the debugger can run
        </li>
        <li>
          <Code aria-hidden="true" size={14} />
          Language servers start from the project's own binaries
        </li>
      </ul>
      <p className="cv-trust__note">You can revoke trust any time in project settings.</p>
    </Dialog>
  );
}

function projectInitial(label: string): string {
  return (label.replace(/[^a-z0-9]/gi, "").charAt(0) || "P").toUpperCase();
}

function originLabel(request: WorkspaceTrustConfirmation): string {
  if (request.origin.kind === "clone")
    return `Cloned from ${request.origin.host}/${request.origin.path}`;
  return "Local folder";
}
