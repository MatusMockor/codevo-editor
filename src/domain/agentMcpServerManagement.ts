import {
  AGENT_MCP_SERVERS_ERRORS,
  AGENT_MCP_SERVERS_ERROR_KINDS,
  isAgentMcpRepositoryRoot,
  isAgentMcpServerName,
} from "./agentMcpServers";
import type { AgentCliKind } from "./agentTask";

export const AGENT_MCP_SERVER_CONFIG_SCOPES = ["user", "project", "local"] as const;
export const AGENT_MCP_SERVER_LAUNCH_KINDS = ["http", "sse", "stdio"] as const;
export const AGENT_MCP_SERVER_CHANGE_KINDS = ["add", "remove", "signOut"] as const;
export const AGENT_MCP_SERVER_LOGIN_MODES = ["signIn", "signInAgain"] as const;
export const AGENT_MCP_SERVER_LOGIN_DELIVERIES = ["automatic", "paste"] as const;
export const AGENT_MCP_SERVER_LOGIN_STEP_KINDS = [
  "completed",
  "finishInBrowser",
  "awaitingCallback",
] as const;
export const AGENT_MCP_SERVER_LOGIN_STATES = ["pending", "succeeded", "failed"] as const;
export const AGENT_MCP_SERVER_CHANGE_ERROR_KINDS = [
  "invalidRequest",
  "serverExists",
  "serverNotFound",
  "changeUnsupported",
  "loginUnsupported",
  "loginInactive",
  "callbackRejected",
] as const;
export const AGENT_MCP_SERVER_MANAGEMENT_ERROR_KINDS = [
  ...AGENT_MCP_SERVERS_ERROR_KINDS,
  ...AGENT_MCP_SERVER_CHANGE_ERROR_KINDS,
] as const;

export type AgentMcpServerConfigScope = (typeof AGENT_MCP_SERVER_CONFIG_SCOPES)[number];
export type AgentMcpServerLaunchKind = (typeof AGENT_MCP_SERVER_LAUNCH_KINDS)[number];
export type AgentMcpServerChangeKind = (typeof AGENT_MCP_SERVER_CHANGE_KINDS)[number];
export type AgentMcpServerLoginMode = (typeof AGENT_MCP_SERVER_LOGIN_MODES)[number];
export type AgentMcpServerLoginDelivery = (typeof AGENT_MCP_SERVER_LOGIN_DELIVERIES)[number];
export type AgentMcpServerLoginState = (typeof AGENT_MCP_SERVER_LOGIN_STATES)[number];
export type AgentMcpServerManagementErrorKind =
  (typeof AGENT_MCP_SERVER_MANAGEMENT_ERROR_KINDS)[number];

export type AgentMcpServerLaunch =
  | { readonly kind: "http"; readonly url: string }
  | { readonly kind: "sse"; readonly url: string }
  | { readonly kind: "stdio"; readonly command: string; readonly args: ReadonlyArray<string> };

export interface AgentMcpServerAddition {
  readonly kind: "add";
  readonly name: string;
  readonly scope: AgentMcpServerConfigScope;
  readonly launch: AgentMcpServerLaunch;
}

export interface AgentMcpServerRemoval {
  readonly kind: "remove";
  readonly name: string;
  readonly scope: AgentMcpServerConfigScope;
}

export interface AgentMcpServerSignOut {
  readonly kind: "signOut";
  readonly name: string;
}

export type AgentMcpServerChange =
  AgentMcpServerAddition | AgentMcpServerRemoval | AgentMcpServerSignOut;

export type AgentMcpServerLoginStep =
  | { readonly kind: "completed" }
  | { readonly kind: "finishInBrowser"; readonly authorizationUrl: string }
  | {
      readonly kind: "awaitingCallback";
      readonly loginId: string;
      readonly authorizationUrl: string;
      readonly delivery: AgentMcpServerLoginDelivery;
    };

export interface AgentMcpServerChangeRequest {
  readonly repositoryRoot: string;
  readonly provider: AgentCliKind;
  readonly change: AgentMcpServerChange;
}

export interface AgentMcpServerLoginRequest {
  readonly repositoryRoot: string;
  readonly provider: AgentCliKind;
  readonly name: string;
  readonly mode: AgentMcpServerLoginMode;
}

export interface AgentMcpServerLoginIdRequest {
  readonly loginId: string;
}

export type AgentMcpServerUrlIssue =
  "empty" | "tooLong" | "whitespace" | "notHttp" | "credentials" | "invalid";
export type AgentMcpServerConfigNameIssue = "empty" | "tooLong" | "invalid";
export type AgentMcpServerCallbackUrlIssue =
  "empty" | "tooLong" | "notLoopback" | "missingResult" | "invalid";

export const AGENT_MCP_SERVER_MANAGEMENT_LIMITS = Object.freeze({
  maxConfigNameLength: 64,
  maxLaunchUrlBytes: 2048,
  maxCommandBytes: 1024,
  maxArgs: 32,
  maxArgBytes: 1024,
  maxAuthorizationUrlBytes: 4096,
  maxCallbackUrlBytes: 8192,
  loginDeadlineMs: 5 * 60 * 1000,
});
export const AGENT_MCP_SERVER_CONFIG_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
export const AGENT_MCP_SERVER_LOGIN_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
export const AGENT_MCP_SERVER_MANAGEMENT_ERRORS: Readonly<
  Record<AgentMcpServerManagementErrorKind, string>
> = Object.freeze({
  ...AGENT_MCP_SERVERS_ERRORS,
  invalidRequest: "Agent MCP server request is invalid.",
  serverExists: "An MCP server with this name is already configured.",
  serverNotFound: "The MCP server is not configured.",
  changeUnsupported: "This MCP server cannot be changed from Codevo.",
  loginUnsupported: "This MCP server does not support sign-in.",
  loginInactive: "The MCP server sign-in is no longer active.",
  callbackRejected: "The MCP server sign-in did not accept this address.",
});

const PROVIDERS = ["claudeCode", "codex"] as const satisfies ReadonlyArray<AgentCliKind>;
const LOOPBACK_HOSTS: ReadonlyArray<string> = ["localhost", "127.0.0.1"];
const CHANGE_REQUEST_KEYS = ["repositoryRoot", "provider", "change"] as const;
const LOGIN_REQUEST_KEYS = ["repositoryRoot", "provider", "name", "mode"] as const;
const LOGIN_ID_REQUEST_KEYS = ["loginId"] as const;
const ADDITION_KEYS = ["kind", "name", "scope", "launch"] as const;
const REMOVAL_KEYS = ["kind", "name", "scope"] as const;
const SIGN_OUT_KEYS = ["kind", "name"] as const;
const URL_LAUNCH_KEYS = ["kind", "url"] as const;
const STDIO_LAUNCH_KEYS = ["kind", "command", "args"] as const;
const RECEIPT_KEYS = ["version"] as const;
const LOGIN_STARTED_KEYS = ["version", "step"] as const;
const LOGIN_STATUS_KEYS = ["version", "state"] as const;
const COMPLETED_STEP_KEYS = ["kind"] as const;
const BROWSER_STEP_KEYS = ["kind", "authorizationUrl"] as const;
const CALLBACK_STEP_KEYS = ["kind", "loginId", "authorizationUrl", "delivery"] as const;
const CONTROL_CHARACTER = /\p{Cc}/u;
const WHITESPACE_OR_CONTROL = /[\s\p{Cc}]/u;
const HTTP_PREFIX = /^https?:\/\//i;
const AUTHORITY = /^[a-z]+:\/\/([^/?#]*)/i;
const UTF8_ENCODER = new TextEncoder();

export function agentMcpServerConfigNameIssue(value: string): AgentMcpServerConfigNameIssue | null {
  if (value.length === 0) return "empty";
  if (value.length > AGENT_MCP_SERVER_MANAGEMENT_LIMITS.maxConfigNameLength) return "tooLong";
  if (!AGENT_MCP_SERVER_CONFIG_NAME_PATTERN.test(value)) return "invalid";
  return null;
}

export function agentMcpServerLaunchUrlIssue(value: string): AgentMcpServerUrlIssue | null {
  if (value.length === 0) return "empty";
  if (exceeds(value, AGENT_MCP_SERVER_MANAGEMENT_LIMITS.maxLaunchUrlBytes)) return "tooLong";
  if (WHITESPACE_OR_CONTROL.test(value)) return "whitespace";
  const url = parsedUrl(value);
  if (url === null) return "invalid";
  if (url.protocol !== "http:" && url.protocol !== "https:") return "notHttp";
  if (!HTTP_PREFIX.test(value) || url.hostname.length === 0) return "invalid";
  if (hasCredentials(value, url)) return "credentials";
  return null;
}

export function isAgentMcpServerCommand(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  return isPlainText(value, AGENT_MCP_SERVER_MANAGEMENT_LIMITS.maxCommandBytes);
}

export function isAgentMcpServerArgument(value: unknown): value is string {
  return isPlainText(value, AGENT_MCP_SERVER_MANAGEMENT_LIMITS.maxArgBytes);
}

export function isAgentMcpServerAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (exceeds(value, AGENT_MCP_SERVER_MANAGEMENT_LIMITS.maxAuthorizationUrlBytes)) return false;
  if (WHITESPACE_OR_CONTROL.test(value)) return false;
  const url = parsedUrl(value);
  if (url === null || url.hostname.length === 0) return false;
  if (url.username.length > 0 || url.password.length > 0) return false;
  if (value.startsWith("https://")) return url.protocol === "https:";
  if (!value.startsWith("http://") || url.protocol !== "http:") return false;
  return LOOPBACK_HOSTS.includes(url.hostname);
}

export function agentMcpServerSignInHost(authorizationUrl: string): string | null {
  if (!isAgentMcpServerAuthorizationUrl(authorizationUrl)) return null;
  return parsedUrl(authorizationUrl)?.host ?? null;
}

export function isAgentMcpServerLoginId(value: unknown): value is string {
  return typeof value === "string" && AGENT_MCP_SERVER_LOGIN_ID_PATTERN.test(value);
}

export function agentMcpServerRetainedLoginId(answer: unknown): string | null {
  const direct = field(answer, "loginId");
  if (isAgentMcpServerLoginId(direct)) return direct;
  const nested = field(field(answer, "step"), "loginId");
  return isAgentMcpServerLoginId(nested) ? nested : null;
}

export function agentMcpServerCallbackUrlIssue(
  text: string,
): AgentMcpServerCallbackUrlIssue | null {
  const value = text.trim();
  if (value.length === 0) return "empty";
  if (exceeds(value, AGENT_MCP_SERVER_MANAGEMENT_LIMITS.maxCallbackUrlBytes)) return "tooLong";
  if (WHITESPACE_OR_CONTROL.test(value)) return "invalid";
  const url = parsedUrl(value);
  if (url === null) return "invalid";
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.includes(url.hostname)) return "notLoopback";
  if (!HTTP_PREFIX.test(value)) return "invalid";
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) return "missingResult";
  return null;
}

export function agentMcpServerCallbackUrl(text: unknown): string | null {
  if (typeof text !== "string" || agentMcpServerCallbackUrlIssue(text) !== null) return null;
  return text.trim();
}

export function parseAgentMcpServerChange(
  value: unknown,
  provider: AgentCliKind,
  path = "agentMcpServerChange",
): AgentMcpServerChange {
  const change = record(value, path);
  const kind = member(change.kind, AGENT_MCP_SERVER_CHANGE_KINDS, `${path}.kind`);
  switch (kind) {
    case "add":
      return parseAddition(change, provider, path);
    case "remove":
      return parseRemoval(change, provider, path);
    case "signOut":
      exactKeys(change, SIGN_OUT_KEYS, path);
      return Object.freeze({ kind, name: statusName(change.name, `${path}.name`) });
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export function parseAgentMcpServerChangeRequest(
  value: unknown,
  path = "agentMcpServerChangeRequest",
): AgentMcpServerChangeRequest {
  const request = record(value, path);
  exactKeys(request, CHANGE_REQUEST_KEYS, path);
  const provider = member(request.provider, PROVIDERS, `${path}.provider`);
  return Object.freeze({
    repositoryRoot: repositoryRoot(request.repositoryRoot, `${path}.repositoryRoot`),
    provider,
    change: parseAgentMcpServerChange(request.change, provider, `${path}.change`),
  });
}

export function parseAgentMcpServerLoginRequest(
  value: unknown,
  path = "agentMcpServerLoginRequest",
): AgentMcpServerLoginRequest {
  const request = record(value, path);
  exactKeys(request, LOGIN_REQUEST_KEYS, path);
  return Object.freeze({
    repositoryRoot: repositoryRoot(request.repositoryRoot, `${path}.repositoryRoot`),
    provider: member(request.provider, PROVIDERS, `${path}.provider`),
    name: statusName(request.name, `${path}.name`),
    mode: member(request.mode, AGENT_MCP_SERVER_LOGIN_MODES, `${path}.mode`),
  });
}

export function parseAgentMcpServerLoginIdRequest(
  value: unknown,
  path = "agentMcpServerLoginIdRequest",
): AgentMcpServerLoginIdRequest {
  const request = record(value, path);
  exactKeys(request, LOGIN_ID_REQUEST_KEYS, path);
  return Object.freeze({ loginId: loginId(request.loginId, `${path}.loginId`) });
}

export function parseAgentMcpServerChangeReceipt(
  value: unknown,
  path = "agentMcpServerChangeReceipt",
): void {
  const receipt = record(value, path);
  exactKeys(receipt, RECEIPT_KEYS, path);
  if (receipt.version !== 1) invalid(`${path}.version`);
}

export function parseAgentMcpServerLoginStarted(
  value: unknown,
  path = "agentMcpServerLoginStarted",
): AgentMcpServerLoginStep {
  const started = record(value, path);
  exactKeys(started, LOGIN_STARTED_KEYS, path);
  if (started.version !== 1) invalid(`${path}.version`);
  return parseAgentMcpServerLoginStep(started.step, `${path}.step`);
}

export function parseAgentMcpServerLoginStatus(
  value: unknown,
  path = "agentMcpServerLoginStatus",
): AgentMcpServerLoginState {
  const status = record(value, path);
  exactKeys(status, LOGIN_STATUS_KEYS, path);
  if (status.version !== 1) invalid(`${path}.version`);
  return parseAgentMcpServerLoginState(status.state, `${path}.state`);
}

export function parseAgentMcpServerLoginState(
  value: unknown,
  path = "agentMcpServerLoginState",
): AgentMcpServerLoginState {
  return member(value, AGENT_MCP_SERVER_LOGIN_STATES, path);
}

export function parseAgentMcpServerLoginStep(
  value: unknown,
  path = "agentMcpServerLoginStep",
): AgentMcpServerLoginStep {
  const step = record(value, path);
  const kind = member(step.kind, AGENT_MCP_SERVER_LOGIN_STEP_KINDS, `${path}.kind`);
  switch (kind) {
    case "completed":
      exactKeys(step, COMPLETED_STEP_KEYS, path);
      return Object.freeze({ kind });
    case "finishInBrowser":
      exactKeys(step, BROWSER_STEP_KEYS, path);
      return Object.freeze({
        kind,
        authorizationUrl: authorizationUrl(step.authorizationUrl, `${path}.authorizationUrl`),
      });
    case "awaitingCallback":
      exactKeys(step, CALLBACK_STEP_KEYS, path);
      return Object.freeze({
        kind,
        loginId: loginId(step.loginId, `${path}.loginId`),
        authorizationUrl: authorizationUrl(step.authorizationUrl, `${path}.authorizationUrl`),
        delivery: member(step.delivery, AGENT_MCP_SERVER_LOGIN_DELIVERIES, `${path}.delivery`),
      });
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export function agentMcpServerManagementErrorKind(
  error: unknown,
): AgentMcpServerManagementErrorKind {
  const text = errorText(error);
  if (text === null) return "unavailable";
  const known = AGENT_MCP_SERVER_MANAGEMENT_ERROR_KINDS.find(
    (kind) => AGENT_MCP_SERVER_MANAGEMENT_ERRORS[kind] === text,
  );
  return known ?? "unavailable";
}

export function agentMcpServerManagementError(kind: AgentMcpServerManagementErrorKind): Error {
  return new Error(AGENT_MCP_SERVER_MANAGEMENT_ERRORS[kind]);
}

function parseAddition(
  change: Record<string, unknown>,
  provider: AgentCliKind,
  path: string,
): AgentMcpServerAddition {
  exactKeys(change, ADDITION_KEYS, path);
  const scope = member(change.scope, AGENT_MCP_SERVER_CONFIG_SCOPES, `${path}.scope`);
  if (!additionScopes(provider).includes(scope)) invalid(`${path}.scope`);
  const launch = parseLaunch(change.launch, `${path}.launch`);
  if (provider === "codex" && launch.kind === "sse") invalid(`${path}.launch.kind`);
  return Object.freeze({
    kind: "add",
    name: configName(change.name, `${path}.name`),
    scope,
    launch,
  });
}

function parseRemoval(
  change: Record<string, unknown>,
  provider: AgentCliKind,
  path: string,
): AgentMcpServerRemoval {
  exactKeys(change, REMOVAL_KEYS, path);
  const scope = member(change.scope, AGENT_MCP_SERVER_CONFIG_SCOPES, `${path}.scope`);
  if (provider === "codex" && scope !== "user") invalid(`${path}.scope`);
  return Object.freeze({ kind: "remove", name: configName(change.name, `${path}.name`), scope });
}

function additionScopes(provider: AgentCliKind): ReadonlyArray<AgentMcpServerConfigScope> {
  switch (provider) {
    case "claudeCode":
      return ["local", "user"];
    case "codex":
      return ["user"];
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}

function parseLaunch(value: unknown, path: string): AgentMcpServerLaunch {
  const launch = record(value, path);
  const kind = member(launch.kind, AGENT_MCP_SERVER_LAUNCH_KINDS, `${path}.kind`);
  switch (kind) {
    case "http":
    case "sse":
      exactKeys(launch, URL_LAUNCH_KEYS, path);
      return Object.freeze({ kind, url: launchUrl(launch.url, `${path}.url`) });
    case "stdio":
      exactKeys(launch, STDIO_LAUNCH_KEYS, path);
      return Object.freeze({
        kind,
        command: command(launch.command, `${path}.command`),
        args: launchArgs(launch.args, `${path}.args`),
      });
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function launchUrl(value: unknown, path: string): string {
  if (typeof value !== "string" || agentMcpServerLaunchUrlIssue(value) !== null) invalid(path);
  return value;
}

function command(value: unknown, path: string): string {
  if (!isAgentMcpServerCommand(value)) invalid(path);
  return value;
}

function launchArgs(value: unknown, path: string): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.length > AGENT_MCP_SERVER_MANAGEMENT_LIMITS.maxArgs)
    invalid(path);
  return Object.freeze(
    value.map((arg: unknown, index) => {
      if (!isAgentMcpServerArgument(arg)) invalid(`${path}[${index}]`);
      return arg;
    }),
  );
}

function configName(value: unknown, path: string): string {
  if (typeof value !== "string" || agentMcpServerConfigNameIssue(value) !== null) invalid(path);
  return value;
}

function statusName(value: unknown, path: string): string {
  if (!isAgentMcpServerName(value)) invalid(path);
  return value;
}

function repositoryRoot(value: unknown, path: string): string {
  if (typeof value !== "string" || !isAgentMcpRepositoryRoot(value)) invalid(path);
  return value;
}

function loginId(value: unknown, path: string): string {
  if (!isAgentMcpServerLoginId(value)) invalid(path);
  return value;
}

function authorizationUrl(value: unknown, path: string): string {
  if (!isAgentMcpServerAuthorizationUrl(value)) invalid(path);
  return value;
}

function hasCredentials(value: string, url: URL): boolean {
  if (url.username.length > 0 || url.password.length > 0) return true;
  return AUTHORITY.exec(value)?.[1]?.includes("@") === true;
}

function parsedUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isPlainText(value: unknown, maxBytes: number): value is string {
  if (typeof value !== "string" || exceeds(value, maxBytes)) return false;
  return !CONTROL_CHARACTER.test(value);
}

function exceeds(value: string, maxBytes: number): boolean {
  if (value.length > maxBytes) return true;
  return UTF8_ENCODER.encode(value).byteLength > maxBytes;
}

function errorText(error: unknown): string | null {
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  return null;
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Object.prototype.hasOwnProperty.call(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: ReadonlyArray<string>,
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid(path);
}

function member<T extends string>(value: unknown, choices: ReadonlyArray<T>, path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) invalid(path);
  return value as T;
}

function invalid(path: string): never {
  throw new TypeError(`Invalid agent MCP server management at ${path}.`);
}
