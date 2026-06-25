import type { PhpPropertyMember } from "./phpClassStructure";

/**
 * Pure PHP code generation for a `__construct` stub derived from the precise
 * structural model produced by `parsePhpClassStructure` (specifically the
 * `PhpPropertyMember[]` of a class).
 *
 * Two rendering modes are supported:
 *  - Classic (default): the constructor declares one typed parameter per
 *    property and the body assigns each parameter to `$this->property`.
 *  - Constructor property promotion (PHP 8): each parameter carries the
 *    property's visibility (and `readonly`) so the body can stay empty.
 *
 * Design constraints:
 *  - Pure string rendering — no side-effects, no I/O.
 *  - `static` properties are never part of an instance constructor, so they are
 *    filtered out.
 *  - In classic mode `visibility` / `readonly` are intentionally NOT emitted —
 *    they belong to the property declaration, not the constructor parameter
 *    (`readonly` on a non-promoted parameter is illegal PHP). A property's
 *    `defaultValue` IS carried onto the parameter so an already-optional
 *    property stays optional in the generated signature.
 *  - The base `indent` defaults to "" — the caller decides where the block is
 *    placed. It is applied to the signature / braces; both the classic body and
 *    the promoted parameters are indented ONE extra step relative to the base,
 *    so the output stays correctly nested at any caller indent.
 *  - Promoted parameters are always rendered multi-line (one per line, trailing
 *    comma) for readability and stable diffs.
 *  - Parameters are ordered required-before-optional (a stable partition that
 *    keeps the relative declaration order within each group). A property with a
 *    `defaultValue` is optional; one without is required. This is mandatory:
 *    emitting an optional parameter before a required one is a PHP 8.1+
 *    deprecation ("Optional parameter ... declared before required parameter
 *    ... is implicitly treated as a required parameter") and silently turns the
 *    defaulted parameter into a required one.
 */

export interface RenderConstructorOptions {
  indent?: string;
  promotion?: boolean;
}

const DEFAULT_INDENT = "";
const PARAM_STEP = "    ";

export function renderConstructor(
  properties: PhpPropertyMember[],
  options: RenderConstructorOptions = {},
): string {
  const indent = options.indent ?? DEFAULT_INDENT;
  const promotion = options.promotion ?? false;
  const instanceProperties = orderRequiredBeforeOptional(
    properties.filter((property) => !property.isStatic),
  );

  if (instanceProperties.length === 0) {
    return renderEmptyConstructor(indent, promotion);
  }

  if (promotion) {
    return renderPromotedConstructor(instanceProperties, indent);
  }

  return renderClassicConstructor(instanceProperties, indent);
}

/**
 * Stably partitions properties so required parameters (no `defaultValue`) come
 * before optional ones (with a `defaultValue`), preserving each property's
 * relative declaration order within its group. This keeps the generated
 * signature free of the PHP 8.1+ "optional parameter declared before required
 * parameter" deprecation without disturbing the order the author chose.
 */
function orderRequiredBeforeOptional(
  properties: PhpPropertyMember[],
): PhpPropertyMember[] {
  const required = properties.filter((property) => !isOptionalProperty(property));
  const optional = properties.filter(isOptionalProperty);

  return [...required, ...optional];
}

function isOptionalProperty(property: PhpPropertyMember): boolean {
  return property.defaultValue !== null && property.defaultValue !== undefined;
}

export function propertyToParameter(
  property: PhpPropertyMember,
  promotion: boolean,
): string {
  const promotionPrefix = promotion ? renderPromotionPrefix(property) : "";
  const typePrefix = property.type ? `${property.type} ` : "";
  const defaultSuffix =
    property.defaultValue === null ? "" : ` = ${property.defaultValue}`;

  return `${promotionPrefix}${typePrefix}$${property.name}${defaultSuffix}`;
}

function renderEmptyConstructor(indent: string, promotion: boolean): string {
  if (promotion) {
    return `${indent}public function __construct() {}`;
  }

  return [`${indent}public function __construct()`, `${indent}{`, `${indent}}`].join(
    "\n",
  );
}

function renderClassicConstructor(
  properties: PhpPropertyMember[],
  indent: string,
): string {
  const params = properties
    .map((property) => propertyToParameter(property, false))
    .join(", ");
  const bodyIndent = `${indent}${PARAM_STEP}`;
  const assignments = properties.map(
    (property) =>
      `${bodyIndent}$this->${property.name} = $${property.name};`,
  );

  return [
    `${indent}public function __construct(${params})`,
    `${indent}{`,
    ...assignments,
    `${indent}}`,
  ].join("\n");
}

function renderPromotedConstructor(
  properties: PhpPropertyMember[],
  indent: string,
): string {
  const paramIndent = `${indent}${PARAM_STEP}`;
  const params = properties.map(
    (property) => `${paramIndent}${propertyToParameter(property, true)},`,
  );

  return [
    `${indent}public function __construct(`,
    ...params,
    `${indent}) {}`,
  ].join("\n");
}

function renderPromotionPrefix(property: PhpPropertyMember): string {
  const readonly = property.isReadonly ? "readonly " : "";

  return `${property.visibility} ${readonly}`;
}
