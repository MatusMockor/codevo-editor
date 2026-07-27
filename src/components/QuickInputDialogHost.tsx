import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type { QuickInputCoordinator } from "../application/quickInputCoordinator";
import "./QuickInputDialogHost.css";

interface QuickInputDialogHostProps {
  readonly coordinator: QuickInputCoordinator;
  readonly workspaceScope: string | null;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");
const MAX_INPUT_LENGTH = 4096;

export function QuickInputDialogHost({ coordinator, workspaceScope }: QuickInputDialogHostProps) {
  const request = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const invokingElementRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const errorId = useId();
  const inputId = useId();

  useEffect(() => coordinator.acquireHostLease(), [coordinator]);

  useLayoutEffect(() => {
    coordinator.setWorkspaceScope(workspaceScope);
  }, [coordinator, workspaceScope]);

  useEffect(() => {
    if (!request) {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    invokingElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setValue(request.defaultValue);
    setError(null);

    if (typeof dialog.showModal === "function") {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute("open", "");
    }

    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => {
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }

      invokingElementRef.current?.focus({ preventScroll: true });
      invokingElementRef.current = null;
    };
  }, [request]);

  if (!request) {
    return null;
  }

  const cancel = () => coordinator.resolveActive(request, null);
  const submit = () => {
    if (value.trim().length === 0) {
      setError("Enter a value.");
      inputRef.current?.focus();
      return;
    }
    if (value.length > MAX_INPUT_LENGTH) {
      setError(`Enter no more than ${MAX_INPUT_LENGTH} characters.`);
      inputRef.current?.focus();
      return;
    }
    coordinator.resolveActive(request, value);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (
      event.key === "Enter" &&
      event.target === inputRef.current &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Tab") {
      trapDialogFocus(event);
    }
  };

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      cancel();
    }
  };

  return (
    <dialog
      aria-labelledby={titleId}
      aria-modal="true"
      className="quick-input-dialog"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onKeyDown={handleKeyDown}
      onMouseDown={handleBackdropMouseDown}
      ref={dialogRef}
      role="dialog"
    >
      <form onSubmit={handleSubmit}>
        <label htmlFor={inputId} id={titleId}>
          {request.message}
        </label>
        <input
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          id={inputId}
          maxLength={MAX_INPUT_LENGTH}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            if (error) {
              setError(null);
            }
          }}
          ref={inputRef}
          spellCheck={false}
          value={value}
        />
        {error ? (
          <p id={errorId} role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button onClick={cancel} type="button">
            Cancel
          </button>
          <button className="quick-input-submit" type="submit">
            OK
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLDialogElement>): void {
  const elements = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  if (elements.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const first = elements[0];
  const last = elements[elements.length - 1];
  const activeElement = document.activeElement;
  if (event.shiftKey && (activeElement === first || !event.currentTarget.contains(activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
