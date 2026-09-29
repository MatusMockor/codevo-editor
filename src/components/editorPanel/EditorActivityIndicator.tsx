import { TriangleAlert } from "lucide-react";
import { cx } from "../../ui/foundation/classNames";
import { Spinner } from "../../ui/foundation/Spinner";
import type { EditorChromeActivity } from "./EditorChromeContext";
import { useRevealedEditorActivity } from "./useRevealedEditorActivity";

export interface EditorActivityIndicatorProps {
  readonly activity: EditorChromeActivity;
  onOpen(): void;
}

export function EditorActivityIndicator({ activity, onOpen }: EditorActivityIndicatorProps) {
  const shown = useRevealedEditorActivity(activity);
  if (shown === null) return null;
  const problem = shown.kind === "problem";
  return (
    <button
      aria-label={shown.text}
      className={cx("cv-esub__activity", problem && "cv-esub__activity--problem")}
      onClick={onOpen}
      title={shown.title}
      type="button"
    >
      {problem ? <TriangleAlert aria-hidden="true" size={12} /> : <Spinner />}
      <span className="cv-esub__activity-text">{shown.text}</span>
    </button>
  );
}
