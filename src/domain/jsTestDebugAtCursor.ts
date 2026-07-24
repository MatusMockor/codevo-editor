/**
 * Backwards-compatible debug vocabulary over the runner-neutral selection
 * policy. Run and Debug intentionally resolve the same declaration.
 */
export {
  jsTestSelectionAtCursor as jsTestDebugSelectionAtCursor,
  MAX_JS_TEST_AT_CURSOR_DECLARATIONS as MAX_JS_TEST_DEBUG_AT_CURSOR_DECLARATIONS,
  MAX_JS_TEST_AT_CURSOR_SOURCE_BYTES as MAX_JS_TEST_DEBUG_AT_CURSOR_SOURCE_BYTES,
  MAX_JS_TEST_AT_CURSOR_SOURCE_LINES as MAX_JS_TEST_DEBUG_AT_CURSOR_SOURCE_LINES,
} from "./jsTestSelectionAtCursor";
export type {
  JsTestAtCursorMatch as JsTestDebugAtCursorMatch,
  JsTestAtCursorSelection as JsTestDebugAtCursorSelection,
} from "./jsTestSelectionAtCursor";
