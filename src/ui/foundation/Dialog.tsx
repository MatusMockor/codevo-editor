import {
  useEffect,
  useId,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { focusableWithin, refocusWhenLost, trapTabKey } from "./focus";
import { useRestoreFocus } from "./useRestoreFocus";
import "./overlays.css";

export type DialogWidth = "sm" | "md";

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly width?: DialogWidth;
  readonly footer?: ReactNode;
  readonly children?: ReactNode;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly dismissOnBackdrop?: boolean;
  onClose(): void;
}

export function Dialog(props: DialogProps) {
  if (!props.open) return null;
  return createPortal(<DialogSurface {...props} />, document.body);
}

function DialogSurface({
  children,
  description,
  dismissOnBackdrop = true,
  footer,
  initialFocusRef,
  onClose,
  returnFocusRef,
  title,
  width = "sm",
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  useRestoreFocus(returnFocusRef);

  useEffect(() => {
    initialFocusTarget(surfaceRef.current, initialFocusRef)?.focus();
  }, [initialFocusRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const surface = surfaceRef.current;
    if (surface === null) return;
    trapTabKey(event, surface);
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget !== null) return;
    const surface = surfaceRef.current;
    if (surface === null) return;
    refocusWhenLost(surface, event.target);
  };
  const keepBackdropFocusless = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
  };
  const handleBackdrop = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dismissOnBackdrop) return;
    if (event.target !== event.currentTarget) return;
    onClose();
  };

  return (
    <div className="cv-overlay" onMouseDown={keepBackdropFocusless} onPointerDown={handleBackdrop}>
      <div
        aria-describedby={description === undefined ? undefined : descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`cv-dialog cv-dialog--${width}`}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        ref={surfaceRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="cv-dialog__header">
          <h2 className="cv-dialog__title" id={titleId}>
            {title}
          </h2>
          {description === undefined ? null : (
            <p className="cv-dialog__description" id={descriptionId}>
              {description}
            </p>
          )}
        </header>
        {children === undefined ? null : <div className="cv-dialog__body">{children}</div>}
        {footer === undefined ? null : <footer className="cv-dialog__footer">{footer}</footer>}
      </div>
    </div>
  );
}

function initialFocusTarget(
  surface: HTMLElement | null,
  initialFocusRef: RefObject<HTMLElement | null> | undefined,
): HTMLElement | null {
  const explicit = initialFocusRef?.current ?? null;
  if (explicit !== null) return explicit;
  if (surface === null) return null;
  return focusableWithin(surface)[0] ?? surface;
}
