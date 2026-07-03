/**
 * Nette MAGIC diagnostics: pure, conservative predicates that recognise the
 * Nette idioms phpactor cannot statically resolve, so the Nette framework
 * provider can DOWNGRADE those diagnostics to a soft "nette-magic" hint instead
 * of surfacing false-positive errors (§4.6). This mirrors the Laravel
 * `isKnownPhpFrameworkMemberMethod` / `isKnownPhpFrameworkStaticMethod`
 * classification: the predicates never assert a member truly exists, they only
 * recognise a framework-magic access whose type the analyser cannot see.
 *
 * All predicates are pure and default to `false` when anything is uncertain.
 *
 * ## Integration shape
 *
 * Each predicate takes `(source, context)` so the provider can wrap it inside a
 * `diagnostics` capability derived from the unresolved-member diagnostic
 * context the filter already computes (receiver expression, member/method name,
 * receiver class name):
 *
 *   isKnownMemberMethod: ({ methodName, receiverExpression, receiverClassName, source }) =>
 *     isNetteComponentAccess(source, { methodName, receiverExpression }) ||
 *     isNetteTemplateMagicMember(source, {
 *       memberName: methodName,
 *       receiverClassName,
 *       receiverExpression,
 *     })
 *
 * The (future) known-PROPERTY capability wraps `isNetteTemplateMagicMember` and
 * `isNetteSmartObjectMagicProperty` the same way with the property name as
 * `memberName`.
 */

/**
 * A member (property or method) access flagged by phpactor, in the same shape
 * the diagnostic filter already extracts for Laravel: the accessed
 * `memberName`, the normalized `receiverExpression`, and - when phpactor names
 * it - the `receiverClassName`.
 */
export interface NetteMagicMemberContext {
  memberName: string;
  receiverClassName?: string | null;
  receiverExpression: string;
}

/**
 * A call/access whose receiver may be a Nette component obtained magically
 * (`$this->getComponent('x')`, `$this['x']`). `methodName` is the invoked
 * method (absent for a bare array access).
 */
export interface NetteComponentAccessContext {
  methodName?: string | null;
  receiverExpression: string;
}

const NETTE_COMPONENT_GETTERS = new Set(["getComponent"]);

const THIS_ARRAY_ACCESS =
  /^\$this\[\s*(?:'[^']*'|"[^"]*"|\$[A-Za-z_][A-Za-z0-9_]*)\s*\]$/;
const THIS_GET_COMPONENT = /^\$this->getComponent\(/;

/**
 * True when a member is accessed on the Nette Latte template object - either the
 * canonical `$this->template` receiver inside a presenter/control, or a receiver
 * whose class is a Nette `Template` class. Every property/method on the template
 * is provided at runtime through `__set`/`__get`, so phpactor's "does not exist"
 * is a false positive. Conservative: a bare `$this->template` outside a
 * presenter/control context is NOT classified.
 */
export function isNetteTemplateMagicMember(
  source: string,
  context: NetteMagicMemberContext,
): boolean {
  if (!context.memberName) {
    return false;
  }

  if (isNetteTemplateClassName(source, context.receiverClassName)) {
    return true;
  }

  return (
    isTemplateReceiverExpression(context.receiverExpression) &&
    sourceDeclaresNettePresenterOrControl(source)
  );
}

/**
 * True when a property is a `Nette\SmartObject` magic accessor: the class uses
 * the `SmartObject` trait AND declares a matching `@property` /
 * `@property-read` / `@property-write` docblock annotation. Both signals are
 * required, so an ordinary class carrying `@property` (or a SmartObject without
 * the annotation) is never classified.
 */
export function isNetteSmartObjectMagicProperty(
  source: string,
  context: NetteMagicMemberContext,
): boolean {
  if (!context.memberName) {
    return false;
  }

  if (!sourceUsesSmartObject(source)) {
    return false;
  }

  return sourceDeclaresPropertyAnnotation(source, context.memberName);
}

/**
 * True when the access is a Nette component obtained magically inside a
 * presenter/control/component: a `$this->getComponent(...)` call, a
 * `$this['name']` array access, or a member chained off either. The component's
 * concrete type is created by a `createComponent*` factory phpactor cannot
 * follow. Conservative: requires a component context in the source.
 */
export function isNetteComponentAccess(
  source: string,
  context: NetteComponentAccessContext,
): boolean {
  if (!sourceDeclaresNetteComponent(source)) {
    return false;
  }

  const receiver = stripWhitespace(context.receiverExpression);

  if (
    receiver === "$this" &&
    context.methodName &&
    NETTE_COMPONENT_GETTERS.has(context.methodName)
  ) {
    return true;
  }

  return THIS_ARRAY_ACCESS.test(receiver) || THIS_GET_COMPONENT.test(receiver);
}

function isTemplateReceiverExpression(receiverExpression: string): boolean {
  return stripWhitespace(receiverExpression) === "$this->template";
}

const NETTE_TEMPLATE_NAMESPACE_PREFIX = "Nette\\Bridges\\ApplicationLatte\\";

/**
 * Short class names that ARE a Nette Latte template type regardless of
 * context - the framework's own `Template` and `DefaultTemplate` classes.
 */
const NETTE_TEMPLATE_EXACT_SHORT_NAMES: ReadonlySet<string> = new Set([
  "Template",
  "DefaultTemplate",
]);

/**
 * True only when `className` is a REAL Nette Latte template type: a
 * `Nette\Bridges\ApplicationLatte\*` FQN, the exact short name `Template` /
 * `DefaultTemplate`, or a custom class whose name ends with `Template` AND
 * the source both declares a presenter/control context AND (conservatively,
 * when determinable) extends a `*Template` base. Without those extra
 * signals a domain entity that merely ends with "Template" (`EmailTemplate`,
 * `PdfTemplate`) is never classified - false-negative is preferred over
 * silently suppressing a real typo.
 */
function isNetteTemplateClassName(
  source: string,
  className: string | null | undefined,
): boolean {
  if (!className) {
    return false;
  }

  const trimmed = className.trim().replace(/^\\+/, "");

  if (trimmed.startsWith(NETTE_TEMPLATE_NAMESPACE_PREFIX)) {
    return true;
  }

  const lastSegment = trimmed.split("\\").pop() ?? "";

  if (!lastSegment) {
    return false;
  }

  if (NETTE_TEMPLATE_EXACT_SHORT_NAMES.has(lastSegment)) {
    return true;
  }

  if (!lastSegment.endsWith("Template")) {
    return false;
  }

  return (
    sourceDeclaresNettePresenterOrControl(source) &&
    sourceDeclaresClassExtendingTemplate(source, lastSegment)
  );
}

function sourceDeclaresClassExtendingTemplate(
  source: string,
  shortClassName: string,
): boolean {
  return new RegExp(
    String.raw`\bclass\s+${escapeRegExp(
      shortClassName,
    )}\s+extends\s+[\\A-Za-z0-9_]*Template\b`,
  ).test(source);
}

/**
 * True only when `use SmartObject;` is an IN-CLASS trait-use statement, not a
 * bare top-level `use Nette\SmartObject;` import. Heuristic: only search from
 * the opening brace of the first class body onward, so an import that
 * precedes every class declaration (the normal PHP file layout) never
 * matches on its own.
 */
function sourceUsesSmartObject(source: string): boolean {
  const classBodyStart = firstClassBodyStart(source);

  if (classBodyStart === null) {
    return false;
  }

  return /\buse\s+[\\A-Za-z0-9_]*SmartObject\s*;/.test(
    source.slice(classBodyStart),
  );
}

function firstClassBodyStart(source: string): number | null {
  const match = /\bclass\b[^{;]*\{/.exec(source);

  if (!match) {
    return null;
  }

  return (match.index ?? 0) + match[0].length;
}

function sourceDeclaresPropertyAnnotation(
  source: string,
  memberName: string,
): boolean {
  return new RegExp(
    String.raw`@property(?:-read|-write)?\s+[^\n]*?\$${escapeRegExp(
      memberName,
    )}\b`,
  ).test(source);
}

function sourceDeclaresNettePresenterOrControl(source: string): boolean {
  return sourceDeclaresNetteBase(source, /(?:Presenter|Control)/);
}

function sourceDeclaresNetteComponent(source: string): boolean {
  return sourceDeclaresNetteBase(source, /(?:Presenter|Control|Component)/);
}

/**
 * True only when the source declares a CLASS that `extends` one of `bases`.
 * A bare `use Nette\Application\UI\...;` import is NOT enough - importing a
 * Nette type (e.g. `Form`) does not mean the importing class is itself a
 * presenter/control/component (false-suppression risk when e.g. a plain
 * service merely type-hints a Nette class).
 */
function sourceDeclaresNetteBase(source: string, bases: RegExp): boolean {
  const extendsPattern = new RegExp(
    String.raw`\bclass\s+[A-Za-z_][A-Za-z0-9_]*\s+extends\s+[\\A-Za-z0-9_]*` +
      bases.source +
      String.raw`\b`,
  );

  return extendsPattern.test(source);
}

function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
