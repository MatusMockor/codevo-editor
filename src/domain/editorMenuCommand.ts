export type EditorMenuCommand =
  | "copy"
  | "cut"
  | "gotoLine"
  | "paste"
  | "redo"
  | "selectAll"
  | "undo";

export type EditorMenuCommandRunner = (command: EditorMenuCommand) => void;
