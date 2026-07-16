import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type { DirtyCloseDecisionCoordinator } from "../application/dirtyCloseDecisionCoordinator";
import {
  dirtyCloseRequestDocuments,
  type DirtyCloseDecisionRequest,
  type DirtyCloseDocumentDescriptor,
} from "../application/dirtyCloseDecisionPort";
import type { DirtyCloseDecision } from "../domain/dirtyClose";
import "./DirtyCloseDecisionDialogHost.css";

interface DirtyCloseDecisionDialogHostProps {
  coordinator: DirtyCloseDecisionCoordinator;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function DirtyCloseDecisionDialogHost({
  coordinator,
}: DirtyCloseDecisionDialogHostProps) {
  const request = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const invokingElementRef = useRef<HTMLElement | null>(null);
  const requestKeysRef = useRef(new WeakMap<DirtyCloseDecisionRequest, number>());
  const nextRequestKeyRef = useRef(0);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!request) {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    invokingElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    if (typeof dialog.showModal === "function") {
      if (!dialog.open) {
        dialog.showModal();
      }
    }

    if (typeof dialog.showModal !== "function") {
      dialog.setAttribute("open", "");
    }

    dialog.querySelector<HTMLElement>('[data-decision="save"]')?.focus();

    return () => {
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      }

      if (!dialog.open || typeof dialog.close !== "function") {
        dialog.removeAttribute("open");
      }

      invokingElementRef.current?.focus({ preventScroll: true });
      invokingElementRef.current = null;
    };
  }, [request]);

  useEffect(() => coordinator.acquireHostLease(), [coordinator]);

  if (!request) {
    return null;
  }

  const copy = dirtyCloseCopy(request);
  const documents = dirtyCloseRequestDocuments(request);
  let requestKey = requestKeysRef.current.get(request);
  if (requestKey === undefined) {
    requestKey = ++nextRequestKeyRef.current;
    requestKeysRef.current.set(request, requestKey);
  }
  const decide = (decision: DirtyCloseDecision) =>
    coordinator.resolveActive(request, decision);
  const hasMultipleTargets = documents.length > 1;
  const hasMultipleWorkspaces = new Set(
    documents.map((document) => document.workspaceLabel).filter(Boolean),
  ).size > 1;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      decide("cancel");
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    trapDialogFocus(event);
  };

  const handleBackdropMouseDown = (
    event: ReactMouseEvent<HTMLDialogElement>,
  ) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    decide("cancel");
  };

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="dirty-close-decision-dialog"
      onCancel={(event) => {
        event.preventDefault();
        decide("cancel");
      }}
      onKeyDown={handleKeyDown}
      onMouseDown={handleBackdropMouseDown}
      ref={dialogRef}
      role="alertdialog"
    >
      <div className="dirty-close-decision-content" key={requestKey}>
        <header>
          <h2 id={titleId}>{copy.title}</h2>
          <p id={descriptionId}>{copy.description}</p>
        </header>
        {hasMultipleTargets ? (
          <ul aria-label="Unsaved documents">
            {documents.map((document) => (
              <li key={document.id}>
                {dirtyCloseDocumentLabel(document, hasMultipleWorkspaces)}
              </li>
            ))}
          </ul>
        ) : null}
        <footer>
          <button onClick={() => decide("cancel")} type="button">
            Cancel
          </button>
          <button
            className="dirty-close-decision-discard"
            onClick={() => decide("discard")}
            type="button"
          >
            {hasMultipleTargets ? "Discard All" : "Discard"}
          </button>
          <button
            className="dirty-close-decision-save"
            data-decision="save"
            onClick={() => decide("save")}
            type="button"
          >
            {hasMultipleTargets ? "Save All" : "Save"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}

function dirtyCloseCopy(request: DirtyCloseDecisionRequest): {
  title: string;
  description: string;
} {
  const documents = dirtyCloseRequestDocuments(request);
  const count = documents.length;
  const documentName = documents[0]?.name ?? "this document";

  if (count === 1) {
    return singleDocumentCopy(request.scope, documentName);
  }

  if (request.scope === "group") {
    return closeCollectionCopy("this editor group", count);
  }

  if (request.scope === "workspace") {
    return closeCollectionCopy("this workspace", count);
  }

  if (request.scope === "quit") {
    return {
      title: "Save changes before quitting?",
      description: dirtyDocumentDescription(count),
    };
  }

  return {
    title: "Save changes before closing?",
    description: dirtyDocumentDescription(count),
  };
}

function dirtyCloseDocumentLabel(
  document: DirtyCloseDocumentDescriptor,
  includeWorkspace: boolean,
): string {
  if (!includeWorkspace || !document.workspaceLabel) {
    return document.relativePath;
  }

  return `${document.workspaceLabel} / ${document.relativePath}`;
}

function singleDocumentCopy(
  scope: DirtyCloseDecisionRequest["scope"],
  documentName: string,
): { title: string; description: string } {
  const description = "Your changes will be lost if you discard them.";
  if (scope === "group") {
    return {
      title: `Save changes to ${documentName} before closing this editor group?`,
      description,
    };
  }

  if (scope === "workspace") {
    return {
      title: `Save changes to ${documentName} before closing this workspace?`,
      description,
    };
  }

  if (scope === "quit") {
    return {
      title: `Save changes to ${documentName} before quitting?`,
      description,
    };
  }

  return {
    title: `Save changes to ${documentName}?`,
    description,
  };
}

function closeCollectionCopy(
  target: string,
  count: number,
): { title: string; description: string } {
  return {
    title: `Save changes before closing ${target}?`,
    description: dirtyDocumentDescription(count),
  };
}

function dirtyDocumentDescription(count: number): string {
  if (count === 1) {
    return "One document has unsaved changes.";
  }

  if (count > 1) {
    return `${count} documents have unsaved changes.`;
  }

  return "There are unsaved changes.";
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLDialogElement>): void {
  const elements = focusableElements(event.currentTarget);
  if (elements.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const first = elements[0];
  const last = elements[elements.length - 1];
  const activeElement = document.activeElement;

  if (
    event.shiftKey &&
    (activeElement === first || !event.currentTarget.contains(activeElement))
  ) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
