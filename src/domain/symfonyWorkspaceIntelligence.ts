const MAX_COMMANDS = 4_000;
const MAX_ROUTES = 10_000;
const MAX_SERVICES = 20_000;
const MAX_ALIASES = 64;
const MAX_METHODS = 32;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_PATH_LENGTH = 4_096;
const MAX_DESCRIPTION_LENGTH = 8_192;
const MAX_MESSAGE_LENGTH = 4_096;
export interface SymfonyConsoleCommand {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly aliases: readonly string[];
}

export interface SymfonyRoute {
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly methods: readonly string[];
  readonly controller: string | null;
}

export interface SymfonyService {
  readonly key: string;
  readonly id: string;
  readonly className: string | null;
  readonly alias: string | null;
  readonly public: boolean | null;
}

export interface SymfonyControllerAction {
  readonly className: string;
  readonly methodName: string;
}

export type SymfonyNavigationTarget =
  | {
      readonly kind: "phpClass";
      readonly className: string;
    }
  | {
      readonly kind: "phpMethod";
      readonly className: string;
      readonly methodName: string;
    };

export type SymfonyConsoleCommandsResult =
  | {
      readonly status: "ok";
      readonly commands: readonly SymfonyConsoleCommand[];
      readonly total: number;
      readonly truncated: boolean;
    }
  | SymfonyUnavailableResult
  | SymfonyErrorResult;

export type SymfonyRoutesResult =
  | {
      readonly status: "ok";
      readonly routes: readonly SymfonyRoute[];
      readonly total: number;
      readonly truncated: boolean;
    }
  | SymfonyUnavailableResult
  | SymfonyErrorResult;

export type SymfonyServicesResult =
  | {
      readonly status: "ok";
      readonly services: readonly SymfonyService[];
      readonly total: number;
      readonly truncated: boolean;
    }
  | SymfonyUnavailableResult
  | SymfonyErrorResult;

interface SymfonyUnavailableResult {
  readonly status: "unavailable";
  readonly message: string;
}

interface SymfonyErrorResult {
  readonly status: "error";
  readonly message: string;
}

interface RawSymfonyConsoleCommand {
  readonly name: string;
  readonly description: string;
  readonly aliases: readonly string[];
}

interface RawSymfonyRoute {
  readonly name: string;
  readonly path: string;
  readonly methods: readonly string[];
  readonly controller: string | null;
}

interface RawSymfonyService {
  readonly id: string;
  readonly className: string | null;
  readonly alias: string | null;
  readonly public: boolean | null;
}

export function parseSymfonyConsoleCommandsResult(value: unknown): SymfonyConsoleCommandsResult {
  const result = resultRecord(value, "console commands result");

  if (result.status !== "ok") {
    return parseFailureResult(result, "console commands result");
  }

  exactKeys(result, ["status", "commands", "total", "truncated"], "console commands result");
  const commands = boundedArray(
    result.commands,
    "console commands result.commands",
    MAX_COMMANDS,
  ).map((command, index) => parseConsoleCommand(command, index));
  const truncated = boolean(result.truncated, "console commands result.truncated");

  return {
    status: "ok",
    commands: stableSorted(
      commands,
      (command) => command.name,
      "console commands result.commands",
    ).map((command) => ({ ...command, key: stableKey("command", command.name) })),
    total: resultTotal(result.total, "console commands result.total", commands.length, truncated),
    truncated,
  };
}

export function parseSymfonyRoutesResult(value: unknown): SymfonyRoutesResult {
  const result = resultRecord(value, "routes result");

  if (result.status !== "ok") {
    return parseFailureResult(result, "routes result");
  }

  exactKeys(result, ["status", "routes", "total", "truncated"], "routes result");
  const routes = boundedArray(result.routes, "routes result.routes", MAX_ROUTES).map(
    (route, index) => parseRoute(route, index),
  );
  const truncated = boolean(result.truncated, "routes result.truncated");

  return {
    status: "ok",
    routes: stableSorted(routes, (route) => route.name, "routes result.routes").map((route) => ({
      ...route,
      key: stableKey("route", route.name),
    })),
    total: resultTotal(result.total, "routes result.total", routes.length, truncated),
    truncated,
  };
}

export function parseSymfonyServicesResult(value: unknown): SymfonyServicesResult {
  const result = resultRecord(value, "services result");

  if (result.status !== "ok") {
    return parseFailureResult(result, "services result");
  }

  exactKeys(result, ["status", "services", "total", "truncated"], "services result");
  const services = boundedArray(result.services, "services result.services", MAX_SERVICES).map(
    (service, index) => parseService(service, index),
  );
  const truncated = boolean(result.truncated, "services result.truncated");

  return {
    status: "ok",
    services: stableSorted(services, (service) => service.id, "services result.services").map(
      (service) => ({
        ...service,
        key: stableKey("service", service.id),
      }),
    ),
    total: resultTotal(result.total, "services result.total", services.length, truncated),
    truncated,
  };
}

export function filterSymfonyConsoleCommands(
  commands: readonly SymfonyConsoleCommand[],
  query: string,
): SymfonyConsoleCommand[] {
  return filterByQuery(commands, query, (command) => [
    command.name,
    command.description,
    ...command.aliases,
  ]);
}

export function filterSymfonyRoutes(
  routes: readonly SymfonyRoute[],
  query: string,
): SymfonyRoute[] {
  return filterByQuery(routes, query, (route) => [
    route.name,
    route.path,
    route.controller ?? "",
    ...route.methods,
  ]);
}

export function filterSymfonyServices(
  services: readonly SymfonyService[],
  query: string,
): SymfonyService[] {
  return filterByQuery(services, query, (service) => [
    service.id,
    service.className ?? "",
    service.alias ?? "",
    service.public === null ? "unknown" : service.public ? "public" : "private",
  ]);
}

export function parseSymfonyControllerAction(
  value: string | null | undefined,
): SymfonyControllerAction | null {
  const action = value?.trim().replace(/^\\+/, "") ?? "";

  if (!action || action.toLowerCase() === "closure") {
    return null;
  }

  const separator = action.indexOf("::");

  if (separator < 0) {
    return isPhpClassName(action) ? { className: action, methodName: "__invoke" } : null;
  }

  if (separator !== action.lastIndexOf("::")) {
    return null;
  }

  const className = action.slice(0, separator);
  const methodName = action.slice(separator + 2);

  if (!isPhpClassName(className) || !isPhpIdentifier(methodName)) {
    return null;
  }

  return { className, methodName };
}

export function symfonyRouteNavigationTarget(route: SymfonyRoute): SymfonyNavigationTarget | null {
  const controller = parseSymfonyControllerAction(route.controller);
  return controller ? { kind: "phpMethod", ...controller } : null;
}

export function symfonyServiceNavigationTarget(
  service: SymfonyService,
): SymfonyNavigationTarget | null {
  const candidate = [service.className, service.id, service.alias].find(
    (value): value is string =>
      typeof value === "string" && isPhpClassName(value.replace(/^\\+/, "")),
  );
  return candidate ? { kind: "phpClass", className: candidate.replace(/^\\+/, "") } : null;
}

function parseConsoleCommand(value: unknown, index: number): RawSymfonyConsoleCommand {
  const path = `console commands result.commands[${index}]`;
  const command = record(value, path);
  exactKeys(command, ["name", "description", "aliases"], path);

  return {
    name: nonEmptyString(command.name, `${path}.name`, MAX_IDENTIFIER_LENGTH),
    description: boundedString(
      command.description,
      `${path}.description`,
      MAX_DESCRIPTION_LENGTH,
    ).trim(),
    aliases: stableStringArray(
      command.aliases,
      `${path}.aliases`,
      MAX_ALIASES,
      MAX_IDENTIFIER_LENGTH,
      (alias) => alias,
    ),
  };
}

function parseRoute(value: unknown, index: number): RawSymfonyRoute {
  const path = `routes result.routes[${index}]`;
  const route = record(value, path);
  exactKeys(route, ["name", "path", "methods", "controller"], path);

  return {
    name: nonEmptyString(route.name, `${path}.name`, MAX_IDENTIFIER_LENGTH),
    path: nonEmptyString(route.path, `${path}.path`, MAX_PATH_LENGTH),
    methods: stableStringArray(route.methods, `${path}.methods`, MAX_METHODS, 64, (method) =>
      method.toUpperCase(),
    ),
    controller: nullableNonEmptyString(route.controller, `${path}.controller`, MAX_PATH_LENGTH),
  };
}

function parseService(value: unknown, index: number): RawSymfonyService {
  const path = `services result.services[${index}]`;
  const service = record(value, path);
  exactKeys(service, ["id", "className", "alias", "public"], path);

  return {
    id: nonEmptyString(service.id, `${path}.id`, MAX_PATH_LENGTH),
    className: nullableNonEmptyString(service.className, `${path}.className`, MAX_PATH_LENGTH),
    alias: nullableNonEmptyString(service.alias, `${path}.alias`, MAX_PATH_LENGTH),
    public: nullableBoolean(service.public, `${path}.public`),
  };
}

function parseFailureResult(
  result: Record<string, unknown>,
  path: string,
): SymfonyUnavailableResult | SymfonyErrorResult {
  if (result.status !== "unavailable" && result.status !== "error") {
    return invalid(`${path}.status`, '"ok", "unavailable", or "error"');
  }

  exactKeys(result, ["status", "message"], path);
  return {
    status: result.status,
    message: nonEmptyString(result.message, `${path}.message`, MAX_MESSAGE_LENGTH),
  };
}

function stableStringArray(
  value: unknown,
  path: string,
  maximum: number,
  maximumStringLength: number,
  normalize: (value: string) => string,
): readonly string[] {
  const parsed = boundedArray(value, path, maximum).map((entry, index) =>
    normalize(nonEmptyString(entry, `${path}[${index}]`, maximumStringLength)),
  );
  return stableSorted(parsed, (entry) => entry, path);
}

function stableSorted<T>(values: readonly T[], identity: (value: T) => string, path: string): T[] {
  const byIdentity = new Map<string, T>();

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const key = identity(value);
    if (byIdentity.has(key)) {
      invalid(`${path}[${index}]`, "an unambiguous unique entry");
    }
    byIdentity.set(key, value);
  }

  return [...byIdentity.entries()]
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([, value]) => value);
}

function stableKey(kind: string, identity: string): string {
  return `${kind}:${JSON.stringify(identity)}`;
}

function filterByQuery<T>(
  values: readonly T[],
  query: string,
  searchableValues: (value: T) => readonly string[],
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
  if (!normalizedQuery) return [...values];
  return values.filter((value) =>
    searchableValues(value).some((candidate) =>
      candidate.toLocaleLowerCase("en-US").includes(normalizedQuery),
    ),
  );
}

function resultRecord(value: unknown, path: string): Record<string, unknown> {
  const result = record(value, path);
  if (!("status" in result)) return invalid(`${path}.status`, "a required field");
  return result;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  exactOptionalKeys(value, keys, [], path);
}

function exactOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = [...required, ...optional];
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) invalid(`${path}.${unexpected}`, "no unknown field");
  const missing = required.find((key) => !(key in value));
  if (missing) invalid(`${path}.${missing}`, "a required field");
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function boundedArray(value: unknown, path: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    return invalid(path, `an array with at most ${maximum} entries`);
  }
  return value;
}

function boundedString(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) {
    return invalid(path, `a string with at most ${maximum} characters`);
  }
  return value;
}

function nonEmptyString(value: unknown, path: string, maximum: number): string {
  const parsed = boundedString(value, path, maximum).trim();
  return parsed ? parsed : invalid(path, "a non-empty string");
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return invalid(path, "a boolean");
  return value;
}

function nullableBoolean(value: unknown, path: string): boolean | null {
  return value === null ? null : boolean(value, path);
}

function nullableNonEmptyString(value: unknown, path: string, maximum: number): string | null {
  return value === null ? null : nonEmptyString(value, path, maximum);
}

function resultTotal(
  value: unknown,
  path: string,
  returnedCount: number,
  truncated: boolean,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < returnedCount ||
    Number(value) < 0 ||
    (!truncated && Number(value) !== returnedCount)
  ) {
    return invalid(
      path,
      truncated
        ? `a non-negative safe integer not smaller than ${returnedCount}`
        : `the returned entry count (${returnedCount})`,
    );
  }
  return Number(value);
}

function isPhpClassName(value: string): boolean {
  const parts = value.split("\\");
  return parts.length > 0 && parts.every(isPhpIdentifier);
}

function isPhpIdentifier(value: string): boolean {
  return /^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*$/.test(value);
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(
    `Invalid Symfony workspace intelligence value at ${path}: expected ${expectation}.`,
  );
}
