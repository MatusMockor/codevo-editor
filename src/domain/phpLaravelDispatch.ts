/**
 * Pure detection of Laravel Job/Event dispatch sites and parsing of the
 * `EventServiceProvider::$listen` map.
 *
 * Powers PhpStorm-style "Go to Definition" navigation:
 *   - `dispatch(new SomeJob(...))` / `SomeJob::dispatchSync(...)` → the job class
 *     (the integration layer then navigates to its `handle()` method).
 *   - `event(new SomeEvent(...))` / `Event::dispatch(new SomeEvent(...))` → the
 *     event class (the integration layer resolves the event's listeners).
 *   - `SomeClass::dispatch(...)` is reported as an ambiguous `dispatch` because
 *     both jobs and events expose the `Dispatchable` trait's `::dispatch`; the
 *     integration layer disambiguates via the `$listen` map.
 *
 * Detection is deliberately conservative: it only recognises the precise call
 * shapes above and extracts a static class reference / `new` class reference. It
 * never resolves the class to a file — that is the navigation layer's job.
 */

interface Psr4RootLike {
  namespace: string;
  paths: string[];
}

interface PhpProjectDescriptorLike {
  psr4Roots: Psr4RootLike[];
}

export type PhpLaravelDispatchKind = "dispatch" | "event" | "job";

export interface PhpLaravelDispatchTarget {
  /** Class reference as written (namespace separators preserved, leading `\` stripped). */
  className: string;
  kind: PhpLaravelDispatchKind;
}

// Static `Dispatchable` methods that queue a job (job-specific, never events).
const jobDispatchStaticMethods = new Set([
  "dispatchafterresponse",
  "dispatchnow",
  "dispatchsync",
]);

// The ambiguous static method shared by jobs and events (`Dispatchable::dispatch`).
const ambiguousDispatchStaticMethod = "dispatch";

const phpClassReferencePattern = String.raw`\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*`;

/**
 * Returns the dispatch target when `offset` lies on a recognised Job/Event
 * dispatch call (either on the dispatched class reference, on the `dispatch` /
 * `event` helper identifier, or on the static dispatch method), otherwise null.
 */
export function phpLaravelDispatchTargetAt(
  source: string,
  offset: number,
): PhpLaravelDispatchTarget | null {
  const identifier = identifierAtOffset(source, offset);

  if (!identifier) {
    return null;
  }

  const helperTarget = helperDispatchTargetAt(source, identifier);

  if (helperTarget) {
    return helperTarget;
  }

  return staticDispatchTargetAt(source, identifier);
}

/**
 * Parses an `EventServiceProvider::$listen` map into an event-class → listener
 * classes lookup. Only `Event::class => [Listener::class, ...]` entries are
 * recognised; non-`::class` keys/values are skipped conservatively.
 */
export function phpLaravelEventListenerMap(
  source: string,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const listenArray = listenArrayBracketsAt(source);

  if (!listenArray) {
    return map;
  }

  const arrayClose = matchingBracketOffset(
    source,
    listenArray.open,
    listenArray.openChar,
    listenArray.closeChar,
  );

  if (arrayClose === null) {
    return map;
  }

  for (const entry of topLevelArrayEntries(source, listenArray.open, arrayClose)) {
    const eventClass = classReferenceFromClassConstant(entry.key);

    if (!eventClass) {
      continue;
    }

    const listeners = listenerClassesFromValue(source, entry.valueStart, entry.valueEnd);

    if (listeners.length === 0) {
      continue;
    }

    map.set(eventClass, listeners);
  }

  return map;
}

/**
 * Returns the ordered `EventServiceProvider` FQN candidates to try when
 * resolving the `$listen` map, derived from the project's app PSR-4 root
 * (`<App>\Providers\EventServiceProvider`). Always falls back to Laravel's
 * default `App\Providers\EventServiceProvider` so navigation works on a stock
 * skeleton.
 */
export function phpEventServiceProviderClassNames(
  descriptor: PhpProjectDescriptorLike | null | undefined,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  const addName = (name: string): void => {
    const key = name.toLowerCase();

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    names.push(name);
  };

  for (const root of appPsr4Roots(descriptor?.psr4Roots ?? [])) {
    const rootNamespace = root.namespace.replace(/\\+$/, "");

    if (rootNamespace) {
      addName(`${rootNamespace}\\Providers\\EventServiceProvider`);
    }
  }

  addName("App\\Providers\\EventServiceProvider");

  return names;
}

function appPsr4Roots(roots: readonly Psr4RootLike[]): Psr4RootLike[] {
  return roots.filter((root) =>
    root.paths.some((path) => /^app\/?$/.test(path.replace(/^\.\//, "").trim())),
  );
}

function helperDispatchTargetAt(
  source: string,
  identifier: IdentifierAtOffset,
): PhpLaravelDispatchTarget | null {
  const openParen = relevantCallOpenParen(source, identifier);

  if (openParen === null) {
    return null;
  }

  const helper = helperNameBeforeOpenParen(source, openParen);

  if (helper !== "dispatch" && helper !== "event") {
    return null;
  }

  const newClass = firstArgumentNewClass(source, openParen);

  if (!newClass) {
    return null;
  }

  if (!offsetOnCallNameOrNewClass(source, identifier, openParen, newClass)) {
    return null;
  }

  return {
    className: newClass.className,
    kind: helper === "event" ? "event" : "job",
  };
}

function staticDispatchTargetAt(
  source: string,
  identifier: IdentifierAtOffset,
): PhpLaravelDispatchTarget | null {
  const openParen = relevantCallOpenParen(source, identifier);

  if (openParen === null) {
    return null;
  }

  const staticCall = staticCallBeforeOpenParen(source, openParen);

  if (!staticCall) {
    return null;
  }

  const method = staticCall.methodName.toLowerCase();

  if (
    method !== ambiguousDispatchStaticMethod &&
    !jobDispatchStaticMethods.has(method)
  ) {
    return null;
  }

  if (staticCall.className.toLowerCase() === "event") {
    const newClass = firstArgumentNewClass(source, openParen);

    if (!newClass) {
      return null;
    }

    if (!offsetOnCallNameOrNewClass(source, identifier, openParen, newClass)) {
      return null;
    }

    return { className: newClass.className, kind: "event" };
  }

  if (!offsetOnStaticReceiverOrMethod(identifier, staticCall)) {
    return null;
  }

  return {
    className: staticCall.className,
    kind: jobDispatchStaticMethods.has(method) ? "job" : "dispatch",
  };
}

/**
 * Resolves the open paren of the call the cursor relates to: the call whose name
 * the cursor is on (identifier immediately followed by `(`, or the static
 * receiver followed by `::method(`), otherwise the nearest enclosing call paren
 * (cursor inside the arguments).
 */
function relevantCallOpenParen(
  source: string,
  identifier: IdentifierAtOffset,
): number | null {
  // A class reference being instantiated (`new X(...)`) is never itself the
  // dispatch/event call; its own constructor paren must be skipped so the
  // enclosing `dispatch(`/`event(`/`Event::dispatch(` paren is used instead.
  if (isNewInstantiationIdentifier(source, identifier)) {
    return enclosingCallOpenParen(source, identifier.start);
  }

  const afterIdentifier = source.slice(identifier.end);
  const directCallMatch = /^\s*\(/.exec(afterIdentifier);

  if (directCallMatch) {
    const openParen = identifier.end + directCallMatch[0].length - 1;

    if (isPhpCodeOffset(source, openParen)) {
      return openParen;
    }
  }

  const staticReceiverMatch =
    /^\s*::\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/.exec(afterIdentifier);

  if (staticReceiverMatch) {
    const openParen = identifier.end + staticReceiverMatch[0].length - 1;

    if (isPhpCodeOffset(source, openParen)) {
      return openParen;
    }
  }

  return enclosingCallOpenParen(source, identifier.start);
}

function enclosingCallOpenParen(source: string, fromOffset: number): number | null {
  for (
    let openParen = source.lastIndexOf("(", fromOffset);
    openParen >= 0;
    openParen = source.lastIndexOf("(", openParen - 1)
  ) {
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen !== null && fromOffset > closeParen) {
      continue;
    }

    if (!isPhpCodeOffset(source, openParen)) {
      continue;
    }

    return openParen;
  }

  return null;
}

function helperNameBeforeOpenParen(
  source: string,
  openParen: number,
): string | null {
  const helperMatch = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    source.slice(0, openParen),
  );

  if (!helperMatch?.[1]) {
    return null;
  }

  const helperStart =
    (helperMatch.index ?? 0) + helperMatch[0].indexOf(helperMatch[1]);
  const precedingCharacter = source.slice(0, helperStart).trimEnd().slice(-1);

  // A method / static call (`->dispatch(`, `::dispatch(`) or namespaced name is
  // never the global `dispatch` / `event` helper.
  if (
    precedingCharacter === ">" ||
    precedingCharacter === ":" ||
    precedingCharacter === "\\"
  ) {
    return null;
  }

  return helperMatch[1];
}

interface StaticCallContext {
  className: string;
  classStart: number;
  classEnd: number;
  methodName: string;
  methodStart: number;
  methodEnd: number;
}

function staticCallBeforeOpenParen(
  source: string,
  openParen: number,
): StaticCallContext | null {
  const match = new RegExp(
    `(${phpClassReferencePattern}|self|static|parent)\\s*::\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*$`,
  ).exec(source.slice(0, openParen));

  if (!match?.[1] || !match[2]) {
    return null;
  }

  const reference = match[1];
  const methodName = match[2];
  const matchStart = match.index ?? 0;
  const classStart = matchStart + match[0].indexOf(reference);
  const methodStart = matchStart + match[0].lastIndexOf(methodName);

  return {
    className: reference.replace(/^\\+/, ""),
    classEnd: classStart + reference.length,
    classStart,
    methodEnd: methodStart + methodName.length,
    methodName,
    methodStart,
  };
}

interface NewClassReference {
  className: string;
  classStart: number;
  classEnd: number;
}

function firstArgumentNewClass(
  source: string,
  openParen: number,
): NewClassReference | null {
  const match = new RegExp(
    `^\\s*new\\s+(${phpClassReferencePattern})`,
  ).exec(source.slice(openParen + 1));

  if (!match?.[1]) {
    return null;
  }

  const reference = match[1];
  const classStart = openParen + 1 + match[0].lastIndexOf(reference);

  return {
    className: reference.replace(/^\\+/, ""),
    classEnd: classStart + reference.length,
    classStart,
  };
}

function offsetOnCallNameOrNewClass(
  source: string,
  identifier: IdentifierAtOffset,
  openParen: number,
  newClass: NewClassReference,
): boolean {
  const onCallName = isCallNameIdentifier(source, identifier, openParen);
  const onClassReference =
    identifier.start >= newClass.classStart &&
    identifier.end <= newClass.classEnd;

  return onCallName || onClassReference;
}

function isCallNameIdentifier(
  source: string,
  identifier: IdentifierAtOffset,
  openParen: number,
): boolean {
  return (
    identifier.end <= openParen &&
    /^\s*$/.test(source.slice(identifier.end, openParen))
  );
}

function offsetOnStaticReceiverOrMethod(
  identifier: IdentifierAtOffset,
  staticCall: StaticCallContext,
): boolean {
  const onReceiver =
    identifier.start >= staticCall.classStart &&
    identifier.end <= staticCall.classEnd;
  const onMethod =
    identifier.start >= staticCall.methodStart &&
    identifier.end <= staticCall.methodEnd;

  return onReceiver || onMethod;
}

function listenArrayBracketsAt(source: string): ValueArrayBrackets | null {
  const pattern = /\$listen\s*=\s*(\[|array\s*\()/g;

  for (const match of source.matchAll(pattern)) {
    const matchStart = match.index ?? 0;

    if (!isPhpCodeOffset(source, matchStart)) {
      continue;
    }

    const isShortArray = (match[1] ?? "").startsWith("[");
    const openChar = isShortArray ? "[" : "(";

    return {
      closeChar: isShortArray ? "]" : ")",
      open: matchStart + match[0].lastIndexOf(openChar),
      openChar,
    };
  }

  return null;
}

interface TopLevelArrayEntry {
  key: string;
  valueEnd: number;
  valueStart: number;
}

function topLevelArrayEntries(
  source: string,
  arrayOpen: number,
  arrayClose: number,
): TopLevelArrayEntry[] {
  const entries: TopLevelArrayEntry[] = [];
  let itemStart = arrayOpen + 1;

  const pushEntry = (start: number, end: number): void => {
    const arrowOffset = topLevelDoubleArrowOffset(source, start, end);

    if (arrowOffset === null) {
      return;
    }

    entries.push({
      key: source.slice(start, arrowOffset).trim(),
      valueEnd: end,
      valueStart: arrowOffset + 2,
    });
  };

  scanTopLevel(source, arrayOpen + 1, arrayClose, (index, character) => {
    if (character !== ",") {
      return;
    }

    pushEntry(itemStart, index);
    itemStart = index + 1;
  });

  pushEntry(itemStart, arrayClose);

  return entries;
}

function topLevelDoubleArrowOffset(
  source: string,
  startOffset: number,
  endOffset: number,
): number | null {
  let arrowOffset: number | null = null;

  scanTopLevel(source, startOffset, endOffset, (index) => {
    if (arrowOffset === null && source.slice(index, index + 2) === "=>") {
      arrowOffset = index;
    }
  });

  return arrowOffset;
}

function listenerClassesFromValue(
  source: string,
  valueStart: number,
  valueEnd: number,
): string[] {
  const arrayValue = valueArrayBracketsAt(source, valueStart, valueEnd);

  if (!arrayValue) {
    return [];
  }

  const arrayClose = matchingBracketOffset(
    source,
    arrayValue.open,
    arrayValue.openChar,
    arrayValue.closeChar,
  );

  if (arrayClose === null || arrayClose > valueEnd) {
    return [];
  }

  const listeners: string[] = [];
  let itemStart = arrayValue.open + 1;

  const pushListener = (start: number, end: number): void => {
    const listenerClass = classReferenceFromClassConstant(
      source.slice(start, end).trim(),
    );

    if (listenerClass) {
      listeners.push(listenerClass);
    }
  };

  scanTopLevel(source, arrayValue.open + 1, arrayClose, (index, character) => {
    if (character !== ",") {
      return;
    }

    pushListener(itemStart, index);
    itemStart = index + 1;
  });

  pushListener(itemStart, arrayClose);

  return listeners;
}

interface ValueArrayBrackets {
  closeChar: ")" | "]";
  open: number;
  openChar: "(" | "[";
}

/**
 * Finds the open bracket of a listener array value (`[...]` or `array(...)`),
 * accepting only when the value begins with that array literal (so a scalar
 * single-listener value is conservatively ignored).
 */
function valueArrayBracketsAt(
  source: string,
  valueStart: number,
  valueEnd: number,
): ValueArrayBrackets | null {
  const match = /^\s*(\[|array\s*\()/.exec(source.slice(valueStart, valueEnd));

  if (!match) {
    return null;
  }

  const isShortArray = (match[1] ?? "").startsWith("[");
  const openChar = isShortArray ? "[" : "(";

  return {
    closeChar: isShortArray ? "]" : ")",
    open: valueStart + match[0].lastIndexOf(openChar),
    openChar,
  };
}

function classReferenceFromClassConstant(text: string): string | null {
  const match = new RegExp(
    `^(${phpClassReferencePattern})\\s*::\\s*class$`,
  ).exec(stripPhpComments(text).trim());

  return match?.[1] ? match[1].replace(/^\\+/, "") : null;
}

/**
 * Removes `//` / `#` line comments and `/* *\/` block comments from a snippet so
 * a `Class::class` key / listener entry annotated with comments still resolves.
 */
function stripPhpComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?:\/\/|#)[^\r\n]*/g, " ");
}

interface IdentifierAtOffset {
  end: number;
  name: string;
  start: number;
}

function isNewInstantiationIdentifier(
  source: string,
  identifier: IdentifierAtOffset,
): boolean {
  // Walk back over a namespaced class reference (`App\Events\OrderShipped`) to
  // its first segment, then check it is preceded by the `new` keyword.
  const beforeReference = /(?:\\?[A-Za-z_][A-Za-z0-9_]*\\)*$/.exec(
    source.slice(0, identifier.start),
  );
  const referenceStart =
    identifier.start - (beforeReference?.[0]?.length ?? 0);

  return /\bnew\s+$/.test(source.slice(0, referenceStart));
}

function identifierAtOffset(
  source: string,
  offset: number,
): IdentifierAtOffset | null {
  for (const match of source.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (offset >= start && offset <= end) {
      return {
        end,
        name: match[0],
        start,
      };
    }
  }

  return null;
}

function scanTopLevel(
  source: string,
  startOffset: number,
  endOffset: number,
  onTopLevelCharacter: (index: number, character: string) => void,
): void {
  let depth = 0;
  let quote: "'" | "\"" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (
    let index = startOffset;
    index < source.length && index < endOffset;
    index += 1
  ) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }

      continue;
    }

    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }

      continue;
    }

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "#" && next !== "[") {
      lineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0) {
      onTopLevelCharacter(index, character);
    }
  }
}

function matchingBracketOffset(
  source: string,
  openOffset: number,
  open: "(" | "[" | "{",
  close: ")" | "]" | "}",
): number | null {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character === close) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function isPhpCodeOffset(source: string, offset: number): boolean {
  let quote: "'" | "\"" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < offset; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }

      continue;
    }

    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }

      continue;
    }

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "#" && next !== "[") {
      lineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
    }
  }

  return !quote && !lineComment && !blockComment;
}
