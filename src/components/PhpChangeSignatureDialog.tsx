import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PhpChangeSignatureDialogState } from "../application/usePhpChangeSignatureWorkflow";
import type { PhpChangeSignatureFormRow } from "../domain/phpChangeSignatureForm";
import "./PhpChangeSignatureDialog.css";

interface PhpChangeSignatureDialogProps {
  onAdd(): void;
  onApply(): void;
  onClose(): void;
  onRowsChange(rows: readonly PhpChangeSignatureFormRow[]): void;
  state?: PhpChangeSignatureDialogState;
}

const CLOSED_STATE: PhpChangeSignatureDialogState = {
  affectedFiles: [],
  error: null,
  isApplying: false,
  isLoading: false,
  isOpen: false,
  invalidRowId: null,
  preview: null,
  rows: [],
};

export function PhpChangeSignatureDialog({
  onAdd,
  onApply,
  onClose,
  onRowsChange,
  state = CLOSED_STATE,
}: PhpChangeSignatureDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const focusedForOpenRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!state.isOpen || !dialog) return;
    if (typeof dialog.showModal === "function" && !dialog.open)
      dialog.showModal();
    if (typeof dialog.showModal !== "function") dialog.setAttribute("open", "");
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      if (typeof dialog.close !== "function") dialog.removeAttribute("open");
    };
  }, [state.isOpen]);

  useEffect(() => {
    if (!state.isOpen) {
      focusedForOpenRef.current = false;
      return;
    }
    if (state.isLoading || focusedForOpenRef.current) return;
    const dialog = dialogRef.current;
    const target =
      dialog?.querySelector<HTMLElement>("input:not(:disabled)") ??
      dialog?.querySelector<HTMLElement>("button:not(:disabled)");
    target?.focus();
    focusedForOpenRef.current = true;
  }, [state.isLoading, state.isOpen]);

  if (!state.isOpen) return null;

  const update = (index: number, patch: Partial<PhpChangeSignatureFormRow>) =>
    onRowsChange(
      state.rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= state.rows.length) return;
    const next = [...state.rows];
    [next[index], next[target]] = [next[target], next[index]];
    onRowsChange(next);
  };
  const remove = (index: number) =>
    onRowsChange(state.rows.filter((_, rowIndex) => rowIndex !== index));
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (state.isApplying) return;
      onClose();
      return;
    }
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      state.preview &&
      !state.isApplying
    ) {
      event.preventDefault();
      onApply();
    }
  };

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      aria-busy={state.isLoading || state.isApplying}
      className="php-change-signature-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (state.isApplying) return;
        onClose();
      }}
      onKeyDown={handleKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <header>
        <div>
          <h2 id={titleId}>Change Signature</h2>
          <p id={descriptionId}>
            Update parameters and review every affected declaration and call
            site.
          </p>
        </div>
        <button
          aria-label="Close Change Signature"
          disabled={state.isApplying}
          onClick={onClose}
          type="button"
        >
          <X size={16} />
        </button>
      </header>

      {state.isLoading ? (
        <p className="php-change-signature-loading" role="status">
          Resolving declarations and call sites…
        </p>
      ) : null}

      {!state.isLoading && state.rows.length ? (
        <div className="php-change-signature-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Name</th>
                <th>Default</th>
                <th>New call value</th>
                <th aria-label="Order and removal" />
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row, index) => (
                <tr key={row.id}>
                  <td>
                    <input
                      aria-label={`Type for ${row.name}`}
                      aria-describedby={
                        state.invalidRowId === row.id && state.error
                          ? errorId
                          : undefined
                      }
                      aria-invalid={state.invalidRowId === row.id}
                      disabled={state.isApplying}
                      onChange={(event) =>
                        update(index, { type: event.target.value })
                      }
                      value={row.type}
                    />
                  </td>
                  <td>
                    <div className="php-change-signature-name">
                      <span aria-hidden="true">$</span>
                      <input
                        aria-label={`Parameter name ${index + 1}`}
                        aria-describedby={
                          state.invalidRowId === row.id && state.error
                            ? errorId
                            : undefined
                        }
                        aria-invalid={state.invalidRowId === row.id}
                        disabled={state.isApplying}
                        onChange={(event) =>
                          update(index, { name: event.target.value })
                        }
                        value={row.name}
                      />
                    </div>
                  </td>
                  <td>
                    <input
                      aria-label={`Default for ${row.name}`}
                      aria-describedby={
                        state.invalidRowId === row.id && state.error
                          ? errorId
                          : undefined
                      }
                      aria-invalid={state.invalidRowId === row.id}
                      disabled={state.isApplying}
                      onChange={(event) =>
                        update(index, { defaultValue: event.target.value })
                      }
                      placeholder="required"
                      value={row.defaultValue}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Call-site value for ${row.name}`}
                      aria-describedby={
                        state.invalidRowId === row.id && state.error
                          ? errorId
                          : undefined
                      }
                      aria-invalid={state.invalidRowId === row.id}
                      disabled={state.isApplying || row.sourceName !== null}
                      onChange={(event) =>
                        update(index, { callArgument: event.target.value })
                      }
                      placeholder={
                        row.sourceName === null
                          ? "for existing calls"
                          : "existing argument"
                      }
                      value={row.callArgument}
                    />
                  </td>
                  <td className="php-change-signature-actions">
                    <button
                      aria-label={`Move ${row.name} up`}
                      disabled={state.isApplying || index === 0}
                      onClick={() => move(index, -1)}
                      type="button"
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      aria-label={`Move ${row.name} down`}
                      disabled={
                        state.isApplying || index === state.rows.length - 1
                      }
                      onClick={() => move(index, 1)}
                      type="button"
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      aria-label={`Remove ${row.name}`}
                      disabled={state.isApplying}
                      onClick={() => remove(index)}
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="php-change-signature-add"
            disabled={state.isApplying}
            onClick={onAdd}
            type="button"
          >
            <Plus size={15} /> Add parameter
          </button>
        </div>
      ) : null}

      {state.error ? (
        <p className="php-change-signature-error" id={errorId} role="alert">
          {state.error}
        </p>
      ) : null}
      {state.preview ? (
        <section
          className="php-change-signature-preview"
          aria-label="Change preview"
        >
          <strong>{state.preview.signature}</strong>
          <span>
            {state.preview.filesChanged} files ·{" "}
            {state.preview.referencesChanged} call sites ·{" "}
            {state.preview.edits.length - state.preview.referencesChanged}{" "}
            declarations
          </span>
          <ul>
            {state.affectedFiles.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer>
        <span>Cmd/Ctrl+Enter Apply · Esc Cancel</span>
        <button disabled={state.isApplying} onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className="php-change-signature-apply"
          disabled={!state.preview || state.isApplying}
          onClick={onApply}
          type="button"
        >
          {state.isApplying ? "Applying…" : "Apply"}
        </button>
      </footer>
    </dialog>
  );
}
