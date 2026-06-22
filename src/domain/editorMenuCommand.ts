export type EditorMenuCommand =
  | "copy"
  | "cut"
  | "paste"
  | "redo"
  | "selectAll"
  | "undo";

export type EditorMenuCommandRunner = (command: EditorMenuCommand) => void;
