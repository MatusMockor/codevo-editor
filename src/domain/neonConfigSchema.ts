import type { NeonSpan } from "./neonConfig";

export type NeonConfigValueKind =
  | "array"
  | "boolean"
  | "number"
  | "scalar"
  | "section"
  | "string";

export interface NeonConfigKeySpec {
  readonly description: string;
  readonly name: string;
  readonly valueKind: NeonConfigValueKind;
}

export type NeonConfigKeyScope =
  | { kind: "section"; section: string }
  | { kind: "service-item" }
  | { kind: "top-level" };

export interface NeonConfigKeyCompletionContext {
  followedByColon: boolean;
  prefix: string;
  scope: NeonConfigKeyScope;
  span: NeonSpan;
}

export const NEON_TOP_LEVEL_SECTIONS: readonly NeonConfigKeySpec[] = [
  {
    description: "Presenter mapping, error presenter and scanning",
    name: "application",
    valueKind: "section",
  },
  {
    description: "PHP constants to define",
    name: "constants",
    valueKind: "section",
  },
  {
    description: "Database connections (nette/database)",
    name: "database",
    valueKind: "section",
  },
  {
    description: "Decorate all services of a given type",
    name: "decorator",
    valueKind: "section",
  },
  {
    description: "DI container options",
    name: "di",
    valueKind: "section",
  },
  {
    description: "Register compiler extensions",
    name: "extensions",
    valueKind: "section",
  },
  {
    description: "Form error messages (nette/forms)",
    name: "forms",
    valueKind: "section",
  },
  {
    description: "HTTP headers, cookies, CSP and proxies",
    name: "http",
    valueKind: "section",
  },
  {
    description: "Included configuration files",
    name: "includes",
    valueKind: "section",
  },
  {
    description: "Latte templating options",
    name: "latte",
    valueKind: "section",
  },
  {
    description: "Mailer configuration (nette/mail)",
    name: "mail",
    valueKind: "section",
  },
  {
    description: "Database migrations extension",
    name: "migrations",
    valueKind: "section",
  },
  {
    description: "User parameters referenced as %name%",
    name: "parameters",
    valueKind: "section",
  },
  {
    description: "PHP ini directives",
    name: "php",
    valueKind: "section",
  },
  {
    description: "Router options",
    name: "routing",
    valueKind: "section",
  },
  {
    description: "Automatic service registration by file search",
    name: "search",
    valueKind: "section",
  },
  {
    description: "Users, roles and resources (nette/security)",
    name: "security",
    valueKind: "section",
  },
  {
    description: "Service definitions for the DI container",
    name: "services",
    valueKind: "section",
  },
  {
    description: "Session configuration",
    name: "session",
    valueKind: "section",
  },
  {
    description: "Tracy debugger options",
    name: "tracy",
    valueKind: "section",
  },
];

export const NEON_SERVICE_ITEM_KEYS: readonly NeonConfigKeySpec[] = [
  {
    description: "Marks the definition as an alteration of an existing service",
    name: "alteration",
    valueKind: "boolean",
  },
  {
    description: "Constructor arguments",
    name: "arguments",
    valueKind: "array",
  },
  {
    description: "Autowiring on/off or a list of allowed types",
    name: "autowired",
    valueKind: "boolean",
  },
  {
    description: "Service class (deprecated, use create or type)",
    name: "class",
    valueKind: "string",
  },
  {
    description: "Class name or factory callable creating the service",
    name: "create",
    valueKind: "string",
  },
  {
    description: "Class name or factory callable creating the service (alias of create)",
    name: "factory",
    valueKind: "string",
  },
  {
    description: "Interface of a generated factory, accessor or locator",
    name: "implement",
    valueKind: "string",
  },
  {
    description: "Service is inserted into the container at runtime",
    name: "imported",
    valueKind: "boolean",
  },
  {
    description: "Enable inject attributes and inject* methods",
    name: "inject",
    valueKind: "boolean",
  },
  {
    description: "Create the service lazily",
    name: "lazy",
    valueKind: "boolean",
  },
  {
    description: "Service references of a generated locator",
    name: "references",
    valueKind: "array",
  },
  {
    description:
      "Inherited definition parts to drop when altering (arguments/setup/tags/all)",
    name: "reset",
    valueKind: "array",
  },
  {
    description: "Method calls and property sets after creation",
    name: "setup",
    valueKind: "array",
  },
  {
    description: "Tag collecting services into a generated locator",
    name: "tagged",
    valueKind: "string",
  },
  {
    description: "Service tags",
    name: "tags",
    valueKind: "array",
  },
  {
    description: "Declared service type (class or interface)",
    name: "type",
    valueKind: "string",
  },
];

export const NEON_SECTION_KEYS: Readonly<
  Record<string, readonly NeonConfigKeySpec[]>
> = {
  application: [
    {
      description: "Route exceptions to the error presenter",
      name: "catchExceptions",
      valueKind: "boolean",
    },
    {
      description: "Show the application panel in the Tracy bar",
      name: "debugger",
      valueKind: "boolean",
    },
    {
      description: "Presenter used to render errors",
      name: "errorPresenter",
      valueKind: "string",
    },
    {
      description: "Presenter name to class mapping",
      name: "mapping",
      valueKind: "section",
    },
    {
      description: "Scan the Composer class map for presenters",
      name: "scanComposer",
      valueKind: "boolean",
    },
    {
      description: "Directories scanned for presenters",
      name: "scanDirs",
      valueKind: "array",
    },
    {
      description: "Class name filter used while scanning",
      name: "scanFilter",
      valueKind: "string",
    },
    {
      description: "Do not warn about invalid link generation",
      name: "silentLinks",
      valueKind: "boolean",
    },
  ],
  database: [
    {
      description: "Enable autowiring of this connection",
      name: "autowired",
      valueKind: "boolean",
    },
    {
      description: "Database naming conventions class",
      name: "conventions",
      valueKind: "string",
    },
    {
      description: "Show the database panel in the Tracy bar",
      name: "debugger",
      valueKind: "boolean",
    },
    {
      description: "Data source name of the connection",
      name: "dsn",
      valueKind: "string",
    },
    {
      description: "Show EXPLAIN of queries in the Tracy bar",
      name: "explain",
      valueKind: "boolean",
    },
    {
      description: "Connect lazily on first query",
      name: "lazy",
      valueKind: "boolean",
    },
    {
      description: "PDO driver options",
      name: "options",
      valueKind: "section",
    },
    {
      description: "Database password",
      name: "password",
      valueKind: "string",
    },
    {
      description: "Database user name",
      name: "user",
      valueKind: "string",
    },
  ],
  di: [
    {
      description: "Show the DI panel in the Tracy bar",
      name: "debugger",
      valueKind: "boolean",
    },
    {
      description: "What the compiled container exposes",
      name: "export",
      valueKind: "section",
    },
    {
      description: "Create services lazily by default",
      name: "lazy",
      valueKind: "boolean",
    },
  ],
  forms: [
    {
      description: "Default validation error messages",
      name: "messages",
      valueKind: "section",
    },
  ],
  http: [
    {
      description: "Content-Security-Policy header directives",
      name: "csp",
      valueKind: "section",
    },
    {
      description: "Content-Security-Policy-Report-Only directives",
      name: "cspReportOnly",
      valueKind: "section",
    },
    {
      description: "Domain scope of session and Nette cookies",
      name: "cookieDomain",
      valueKind: "string",
    },
    {
      description: "Path scope of session and Nette cookies",
      name: "cookiePath",
      valueKind: "string",
    },
    {
      description: "Send cookies only over HTTPS (true/false/auto)",
      name: "cookieSecure",
      valueKind: "scalar",
    },
    {
      description: "Feature-Policy header directives",
      name: "featurePolicy",
      valueKind: "section",
    },
    {
      description: "X-Frame-Options header value",
      name: "frames",
      valueKind: "scalar",
    },
    {
      description: "HTTP headers sent with every response",
      name: "headers",
      valueKind: "section",
    },
    {
      description: "Trusted proxy IP addresses",
      name: "proxy",
      valueKind: "array",
    },
  ],
  latte: [
    {
      description: "Latte extension classes to register",
      name: "extensions",
      valueKind: "array",
    },
    {
      description: "Macro sets (deprecated, use extensions)",
      name: "macros",
      valueKind: "array",
    },
    {
      description: "Enable strict parsing mode",
      name: "strictParsing",
      valueKind: "boolean",
    },
    {
      description: "Generate templates with declare(strict_types=1)",
      name: "strictTypes",
      valueKind: "boolean",
    },
    {
      description: "Class of the template object",
      name: "templateClass",
      valueKind: "string",
    },
    {
      description: "Render valid XHTML markup",
      name: "xhtml",
      valueKind: "boolean",
    },
  ],
  mail: [
    {
      description: "HELO client host name",
      name: "clientHost",
      valueKind: "string",
    },
    {
      description: "SSL stream context options",
      name: "context",
      valueKind: "section",
    },
    {
      description: "SMTP server host",
      name: "host",
      valueKind: "string",
    },
    {
      description: "SMTP password",
      name: "password",
      valueKind: "string",
    },
    {
      description: "Keep the SMTP connection persistent",
      name: "persistent",
      valueKind: "boolean",
    },
    {
      description: "SMTP server port",
      name: "port",
      valueKind: "number",
    },
    {
      description: "Encryption of the SMTP connection (ssl/tls)",
      name: "secure",
      valueKind: "string",
    },
    {
      description: "Send mail through SMTP instead of PHP mail()",
      name: "smtp",
      valueKind: "boolean",
    },
    {
      description: "SMTP connection timeout in seconds",
      name: "timeout",
      valueKind: "number",
    },
    {
      description: "SMTP user name",
      name: "username",
      valueKind: "string",
    },
  ],
  migrations: [
    {
      description: "DBAL adapter used by migrations",
      name: "dbal",
      valueKind: "string",
    },
    {
      description: "Directory with migration files",
      name: "dir",
      valueKind: "string",
    },
    {
      description: "Database driver used by migrations",
      name: "driver",
      valueKind: "string",
    },
  ],
  routing: [
    {
      description: "Cache the compiled router",
      name: "cache",
      valueKind: "boolean",
    },
    {
      description: "Show the routing panel in the Tracy bar",
      name: "debugger",
      valueKind: "boolean",
    },
    {
      description: "Route mask to metadata mapping",
      name: "routes",
      valueKind: "section",
    },
  ],
  security: [
    {
      description: "Authentication options",
      name: "authentication",
      valueKind: "section",
    },
    {
      description: "Show the security panel in the Tracy bar",
      name: "debugger",
      valueKind: "boolean",
    },
    {
      description: "Access control resources",
      name: "resources",
      valueKind: "section",
    },
    {
      description: "Roles and their parents for the authorizator",
      name: "roles",
      valueKind: "section",
    },
    {
      description: "User names, passwords and roles",
      name: "users",
      valueKind: "section",
    },
  ],
  session: [
    {
      description: "Start the session automatically (true/false/smart)",
      name: "autoStart",
      valueKind: "scalar",
    },
    {
      description: "Domain scope of the session cookie",
      name: "cookieDomain",
      valueKind: "string",
    },
    {
      description: "Path scope of the session cookie",
      name: "cookiePath",
      valueKind: "string",
    },
    {
      description: "SameSite attribute of the session cookie",
      name: "cookieSamesite",
      valueKind: "string",
    },
    {
      description: "Send the session cookie only over HTTPS",
      name: "cookieSecure",
      valueKind: "scalar",
    },
    {
      description: "Show the session panel in the Tracy bar",
      name: "debugger",
      valueKind: "boolean",
    },
    {
      description: "Inactivity period after which the session expires",
      name: "expiration",
      valueKind: "string",
    },
    {
      description: "Custom session handler service",
      name: "handler",
      valueKind: "string",
    },
    {
      description: "Name of the session cookie",
      name: "name",
      valueKind: "string",
    },
    {
      description: "Close the session immediately after reading",
      name: "readAndClose",
      valueKind: "boolean",
    },
    {
      description: "Directory for session file storage",
      name: "savePath",
      valueKind: "string",
    },
  ],
  tracy: [
    {
      description: "Panels added to the Tracy bar",
      name: "bar",
      valueKind: "array",
    },
    {
      description: "Panels added to the blue screen",
      name: "blueScreen",
      valueKind: "array",
    },
    {
      description: "Browser command used to open error pages",
      name: "browser",
      valueKind: "string",
    },
    {
      description: "Theme of dumped values (light/dark)",
      name: "dumpTheme",
      valueKind: "string",
    },
    {
      description: "Editor URL opened from stack traces",
      name: "editor",
      valueKind: "string",
    },
    {
      description: "Recipient of error notification e-mails",
      name: "email",
      valueKind: "string",
    },
    {
      description: "Custom template for the production error page",
      name: "errorTemplate",
      valueKind: "string",
    },
    {
      description: "Sender of error notification e-mails",
      name: "fromEmail",
      valueKind: "string",
    },
    {
      description: "Error levels written to the log",
      name: "logSeverity",
      valueKind: "scalar",
    },
    {
      description: "Maximum depth of dumped structures",
      name: "maxDepth",
      valueKind: "number",
    },
    {
      description: "Maximum length of dumped strings",
      name: "maxLength",
      valueKind: "number",
    },
    {
      description: "Report all error levels",
      name: "scream",
      valueKind: "boolean",
    },
    {
      description: "Show the Tracy bar",
      name: "showBar",
      valueKind: "boolean",
    },
    {
      description: "Show the code location in dumps",
      name: "showLocation",
      valueKind: "boolean",
    },
    {
      description: "Enable strict mode for notices and warnings",
      name: "strictMode",
      valueKind: "boolean",
    },
  ],
};

const SERVICES_SECTION = "services";
const EXTENSIONS_SECTION = "extensions";

export function neonConfigKeySpecsForScope(
  scope: NeonConfigKeyScope,
): readonly NeonConfigKeySpec[] {
  if (scope.kind === "top-level") {
    return NEON_TOP_LEVEL_SECTIONS;
  }

  if (scope.kind === "service-item") {
    return NEON_SERVICE_ITEM_KEYS;
  }

  return NEON_SECTION_KEYS[scope.section] ?? [];
}

interface SchemaLine {
  contentLimit: number;
  contentStart: number;
  end: number;
  indent: number;
  isBlank: boolean;
  isComment: boolean;
  isListItem: boolean;
  keyName: string | null;
  start: number;
}

function isSpace(character: string): boolean {
  return character === " " || character === "\t";
}

function isKeyChar(character: string): boolean {
  return /[\w.-]/.test(character);
}

function parseSchemaLines(source: string): SchemaLine[] {
  const lines: SchemaLine[] = [];
  let lineStart = 0;

  while (lineStart <= source.length) {
    const newlineIndex = source.indexOf("\n", lineStart);
    const end = newlineIndex < 0 ? source.length : newlineIndex;
    const contentLimit =
      end > lineStart && source[end - 1] === "\r" ? end - 1 : end;
    lines.push(parseSchemaLine(source, lineStart, end, contentLimit));

    if (newlineIndex < 0) {
      break;
    }

    lineStart = newlineIndex + 1;
  }

  return lines;
}

function parseSchemaLine(
  source: string,
  start: number,
  end: number,
  contentLimit: number,
): SchemaLine {
  let contentStart = start;

  while (contentStart < contentLimit && isSpace(source[contentStart] ?? "")) {
    contentStart += 1;
  }

  const firstChar = source[contentStart] ?? "";
  const isBlank = contentStart >= contentLimit;
  const isComment = !isBlank && firstChar === "#";
  const isListItem =
    !isBlank &&
    firstChar === "-" &&
    (contentStart + 1 >= contentLimit ||
      isSpace(source[contentStart + 1] ?? ""));
  const keyName =
    isBlank || isComment || isListItem
      ? null
      : schemaKeyName(source, contentStart, contentLimit);

  return {
    contentLimit,
    contentStart,
    end,
    indent: contentStart - start,
    isBlank,
    isComment,
    isListItem,
    keyName,
    start,
  };
}

function schemaKeyName(
  source: string,
  contentStart: number,
  contentLimit: number,
): string | null {
  let index = contentStart;

  while (index < contentLimit && isKeyChar(source[index] ?? "")) {
    index += 1;
  }

  if (index === contentStart) {
    return null;
  }

  let colon = index;

  while (colon < contentLimit && isSpace(source[colon] ?? "")) {
    colon += 1;
  }

  if (source[colon] !== ":") {
    return null;
  }

  const afterColon = colon + 1;

  if (afterColon < contentLimit && !isSpace(source[afterColon] ?? "")) {
    return null;
  }

  return source.slice(contentStart, index);
}

export function neonExtensionNamesFromSource(source: string): string[] {
  const names: string[] = [];
  let inExtensions = false;

  for (const line of parseSchemaLines(source)) {
    if (line.isBlank || line.isComment) {
      continue;
    }

    if (line.indent === 0) {
      inExtensions =
        line.keyName !== null &&
        line.keyName.toLowerCase() === EXTENSIONS_SECTION;
      continue;
    }

    if (!inExtensions || line.keyName === null) {
      continue;
    }

    names.push(line.keyName);
  }

  return names;
}

export function neonIndentUnitFromSource(source: string): string {
  let minimumSpaces: number | null = null;

  for (const line of parseSchemaLines(source)) {
    if (line.isBlank || line.isComment || line.indent === 0) {
      continue;
    }

    const indentText = source.slice(line.start, line.contentStart);

    if (indentText.includes("\t")) {
      return "\t";
    }

    if (minimumSpaces === null || indentText.length < minimumSpaces) {
      minimumSpaces = indentText.length;
    }
  }

  if (minimumSpaces === null) {
    return "\t";
  }

  return " ".repeat(minimumSpaces);
}

export function neonConfigKeyCompletionContextAt(
  source: string,
  offset: number,
): NeonConfigKeyCompletionContext | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  const lines = parseSchemaLines(source);
  const lineIndex = lines.findIndex(
    (line) => offset >= line.start && offset <= line.end,
  );
  const line = lines[lineIndex];

  if (!line || offset > line.contentLimit) {
    return null;
  }

  if (line.isBlank) {
    const scope = scopeForIndent(lines, lineIndex, offset - line.start);

    if (!scope) {
      return null;
    }

    return {
      followedByColon: false,
      prefix: "",
      scope,
      span: { end: offset, start: offset },
    };
  }

  if (line.isComment || line.isListItem || offset < line.contentStart) {
    return null;
  }

  for (let index = line.contentStart; index < offset; index += 1) {
    if (!isKeyChar(source[index] ?? "")) {
      return null;
    }
  }

  let end = offset;

  while (end < line.contentLimit && isKeyChar(source[end] ?? "")) {
    end += 1;
  }

  const scope = scopeForIndent(lines, lineIndex, line.indent);

  if (!scope) {
    return null;
  }

  return {
    followedByColon: hasColonAfter(source, end, line.contentLimit),
    prefix: source.slice(line.contentStart, offset),
    scope,
    span: { end, start: line.contentStart },
  };
}

function hasColonAfter(source: string, from: number, limit: number): boolean {
  let index = from;

  while (index < limit && isSpace(source[index] ?? "")) {
    index += 1;
  }

  return index < limit && source[index] === ":";
}

function scopeForIndent(
  lines: SchemaLine[],
  lineIndex: number,
  indent: number,
): NeonConfigKeyScope | null {
  if (indent === 0) {
    return { kind: "top-level" };
  }

  const ancestors: SchemaLine[] = [];
  let requiredIndent = indent;

  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const candidate = lines[index];

    if (!candidate || candidate.isBlank || candidate.isComment) {
      continue;
    }

    if (candidate.indent >= requiredIndent) {
      continue;
    }

    ancestors.push(candidate);
    requiredIndent = candidate.indent;

    if (requiredIndent === 0) {
      break;
    }
  }

  const topAncestor = ancestors[ancestors.length - 1];

  if (!topAncestor || topAncestor.indent !== 0 || topAncestor.keyName === null) {
    return null;
  }

  const section = topAncestor.keyName.toLowerCase();

  if (ancestors.length === 1) {
    if (section === SERVICES_SECTION) {
      return null;
    }

    return { kind: "section", section };
  }

  if (ancestors.length !== 2 || section !== SERVICES_SECTION) {
    return null;
  }

  const serviceEntry = ancestors[0];

  if (!serviceEntry) {
    return null;
  }

  if (serviceEntry.isListItem || serviceEntry.keyName !== null) {
    return { kind: "service-item" };
  }

  return null;
}
