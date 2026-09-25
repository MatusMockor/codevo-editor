import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Toast } from "../../ui/foundation/Toast";
import {
  clampEditorDrawerHeight,
  DEBUG_EDITOR_DRAWER_HEIGHT,
  DEFAULT_EDITOR_DRAWER_HEIGHT,
} from "./editorDrawerSize";
import "./editorDrawer.css";

export { DEBUG_EDITOR_DRAWER_HEIGHT, DEFAULT_EDITOR_DRAWER_HEIGHT };

export interface EditorDrawerFrame {
  readonly height: number;
  onResize(height: number): void;
}

export interface EditorPanelLayoutProps {
  readonly area: ReactNode;
  readonly renderDrawer: ((frame: EditorDrawerFrame) => ReactNode) | null;
  readonly debugViews: ReactNode;
  readonly message: string | null;
  readonly debugging?: boolean;
}

export function EditorPanelLayout({
  area,
  debugging = false,
  debugViews,
  message,
  renderDrawer,
}: EditorPanelLayoutProps) {
  const [resizedHeight, setResizedHeight] = useState<number | null>(null);
  const height =
    resizedHeight ?? (debugging ? DEBUG_EDITOR_DRAWER_HEIGHT : DEFAULT_EDITOR_DRAWER_HEIGHT);
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const onResize = useCallback(
    (next: number) => setResizedHeight(clampEditorDrawerHeight(next)),
    [],
  );
  const frame = useMemo<EditorDrawerFrame>(() => ({ height, onResize }), [height, onResize]);
  const hasDebugViews = debugViews !== null && debugViews !== undefined && debugViews !== false;
  const visibleMessage = message !== null && message !== dismissedMessage ? message : null;
  return (
    <div className="cv-editor-panel" data-debug-views={hasDebugViews ? "side" : "hidden"}>
      <div className="cv-editor-panel__column">
        <div className="cv-editor-panel__area">{area}</div>
        {renderDrawer === null ? null : renderDrawer(frame)}
      </div>
      {debugViews}
      {visibleMessage === null ? null : (
        <div className="cv-editor-panel__toast">
          <Toast
            durationMs={5000}
            message={visibleMessage}
            onDismiss={() => setDismissedMessage(visibleMessage)}
          />
        </div>
      )}
    </div>
  );
}
