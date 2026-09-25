import {
  editorDrawerViewAvailable,
  type EditorDrawerAvailability,
  type EditorDrawerView,
} from "../../domain/editorDrawer";
import { workbenchPanelFlags, type WorkbenchPanelFlagsInput } from "../workbenchPanelViewProps";

export function editorDrawerAvailabilityFromPanel(
  panel: WorkbenchPanelFlagsInput,
  view: EditorDrawerView = "problems",
): EditorDrawerAvailability {
  const flags = workbenchPanelFlags(panel, view);
  return {
    artisan: flags.hasArtisan,
    expressRoutes: flags.showExpressRoutes,
    javaScriptWorkspace: flags.hasJsWorkspace,
    nette: flags.hasNette,
    symfony: flags.hasSymfony,
    phpWorkspace: flags.hasPhpWorkspace,
  };
}

export function effectiveEditorDrawerView(
  view: EditorDrawerView,
  availability: EditorDrawerAvailability,
): EditorDrawerView {
  return editorDrawerViewAvailable(view, availability) ? view : "problems";
}
