/**
 * Aggregated TODO-style comment located in a workspace file.
 *
 * Extends the pure {@link extractTodoComments} result (tag/text/line/column)
 * with the file it was harvested from, so the TODO panel can both render the
 * grouped list and navigate to the exact position.
 */
export interface WorkspaceTodo {
  column: number;
  filePath: string;
  line: number;
  relativePath: string;
  tag: string;
  text: string;
}
