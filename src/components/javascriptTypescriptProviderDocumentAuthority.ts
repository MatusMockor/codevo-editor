import type * as Monaco from "monaco-editor";
import {
  isLargeSmartDocument,
  normalizeLargeSmartDocumentPolicy,
  type LargeSmartDocumentPolicy,
} from "../domain/largeDocumentPolicy";
import type { EditorDocument } from "../domain/workspace";

type MonacoModel = Monaco.editor.ITextModel;

export interface JavaScriptTypeScriptProviderRegistrationLease {
  active: boolean;
}

export interface JavaScriptTypeScriptProviderRequestAuthority {
  readonly ownerEpoch: number;
  readonly registrationLease: JavaScriptTypeScriptProviderRegistrationLease;
}

export interface JavaScriptTypeScriptDocumentRequestAuthority extends JavaScriptTypeScriptProviderRequestAuthority {
  readonly model: MonacoModel;
  readonly modelVersion: number;
  readonly path: string;
  readonly rootPath: string;
  readonly sessionId?: number;
  syncVersion?: number;
}

export interface StoredJavaScriptTypeScriptDocumentAuthority {
  __documentModel?: MonacoModel;
  __documentModelVersion?: number;
  __documentOwnerEpoch?: number;
  __documentRegistrationLease?: JavaScriptTypeScriptProviderRegistrationLease;
  __documentSyncVersion?: number;
  __sourcePath?: string;
}

export interface JavaScriptTypeScriptDocumentAuthorityContext {
  getActiveJavaScriptTypeScriptOwnerEpoch(): number;
  getActiveDocument(): EditorDocument | null;
  getActiveModel?(): MonacoModel | null;
  getDocumentSyncVersion(rootPath: string, path: string): number | null;
  getLargeSmartDocumentPolicy(): LargeSmartDocumentPolicy;
}

const largeDocumentByModelRevision = new WeakMap<
  MonacoModel,
  {
    readonly characterLimit: number;
    readonly isLarge: boolean;
    readonly lineLimit: number;
    readonly modelVersion: number;
  }
>();

export function isLargeJavaScriptTypeScriptProviderDocument(
  model: MonacoModel,
  document: EditorDocument,
  policy: LargeSmartDocumentPolicy,
): boolean {
  const modelVersion = model.getVersionId();
  const normalizedPolicy = normalizeLargeSmartDocumentPolicy(policy);
  const cached = largeDocumentByModelRevision.get(model);
  if (
    cached?.modelVersion === modelVersion &&
    cached.characterLimit === normalizedPolicy.characterLimit &&
    cached.lineLimit === normalizedPolicy.lineLimit
  ) {
    return cached.isLarge;
  }

  if (typeof model.getValueLength !== "function" || typeof model.getLineCount !== "function") {
    return isLargeSmartDocument(document, normalizedPolicy);
  }

  const isLarge =
    model.getValueLength() > normalizedPolicy.characterLimit ||
    model.getLineCount() > normalizedPolicy.lineLimit;
  largeDocumentByModelRevision.set(model, {
    characterLimit: normalizedPolicy.characterLimit,
    isLarge,
    lineLimit: normalizedPolicy.lineLimit,
    modelVersion,
  });
  return isLarge;
}

export function attachStoredJavaScriptTypeScriptDocumentAuthority<T extends object>(
  payload: T,
  authority:
    JavaScriptTypeScriptDocumentRequestAuthority | StoredJavaScriptTypeScriptDocumentAuthority,
): T {
  const storedAuthority = "model" in authority ? null : authority;
  Object.defineProperties(payload, {
    __documentModel: {
      configurable: true,
      value: "model" in authority ? authority.model : storedAuthority?.__documentModel,
    },
    __documentModelVersion: {
      configurable: true,
      value:
        "modelVersion" in authority
          ? authority.modelVersion
          : storedAuthority?.__documentModelVersion,
    },
    __documentOwnerEpoch: {
      configurable: true,
      value:
        "ownerEpoch" in authority ? authority.ownerEpoch : storedAuthority?.__documentOwnerEpoch,
    },
    __documentRegistrationLease: {
      configurable: true,
      value:
        "registrationLease" in authority
          ? authority.registrationLease
          : storedAuthority?.__documentRegistrationLease,
    },
    __documentSyncVersion: {
      configurable: true,
      value:
        "syncVersion" in authority ? authority.syncVersion : storedAuthority?.__documentSyncVersion,
    },
  });
  return payload;
}

export function attachStoredJavaScriptTypeScriptExecutablePayloadAuthority<T extends object>(
  payload: T,
  authority:
    JavaScriptTypeScriptDocumentRequestAuthority | StoredJavaScriptTypeScriptDocumentAuthority,
  executeCommandId: string,
): T {
  const command = (payload as { command?: Monaco.languages.Command }).command;
  if (command?.id !== executeCommandId) {
    return attachStoredJavaScriptTypeScriptDocumentAuthority(payload, authority);
  }

  const [argument, ...remainingArguments] = command.arguments ?? [];
  if (!argument || typeof argument !== "object" || Array.isArray(argument)) {
    return attachStoredJavaScriptTypeScriptDocumentAuthority(payload, authority);
  }

  const authorizedArgument = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(argument),
  );
  attachStoredJavaScriptTypeScriptDocumentAuthority(authorizedArgument, authority);
  const authorizedPayload = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(payload),
  ) as T & { command: Monaco.languages.Command };
  Object.defineProperty(authorizedPayload, "command", {
    configurable: true,
    enumerable: true,
    value: {
      ...command,
      arguments: [authorizedArgument, ...remainingArguments],
    },
  });
  return attachStoredJavaScriptTypeScriptDocumentAuthority(authorizedPayload, authority) as T;
}

export function isJavaScriptTypeScriptDocumentRequestAuthority(
  request:
    | { readonly rootPath: string; readonly sessionId?: number }
    | JavaScriptTypeScriptDocumentRequestAuthority,
): request is JavaScriptTypeScriptDocumentRequestAuthority {
  return "model" in request && "modelVersion" in request && "path" in request;
}

export function isJavaScriptTypeScriptProviderRequestAuthorityActive(
  context: Pick<
    JavaScriptTypeScriptDocumentAuthorityContext,
    "getActiveJavaScriptTypeScriptOwnerEpoch"
  >,
  request: JavaScriptTypeScriptProviderRequestAuthority,
): boolean {
  return (
    request.registrationLease.active &&
    context.getActiveJavaScriptTypeScriptOwnerEpoch() === request.ownerEpoch
  );
}

export function isJavaScriptTypeScriptDocumentRequestAuthorityActive(
  context: JavaScriptTypeScriptDocumentAuthorityContext,
  request: JavaScriptTypeScriptDocumentRequestAuthority,
  rootAndSessionActive: boolean,
  requireSyncAuthority = true,
): boolean {
  if (!rootAndSessionActive) {
    return false;
  }

  if (!isJavaScriptTypeScriptProviderRequestAuthorityActive(context, request)) {
    return false;
  }

  const activeDocument = context.getActiveDocument();
  if (
    !activeDocument ||
    activeDocument.path !== request.path ||
    isLargeJavaScriptTypeScriptProviderDocument(
      request.model,
      activeDocument,
      context.getLargeSmartDocumentPolicy(),
    ) ||
    (context.getActiveModel !== undefined && context.getActiveModel() !== request.model) ||
    request.model.getVersionId() !== request.modelVersion
  ) {
    return false;
  }

  if (!requireSyncAuthority) {
    return true;
  }

  return (
    request.syncVersion !== undefined &&
    context.getDocumentSyncVersion(request.rootPath, request.path) === request.syncVersion
  );
}

export function isStoredJavaScriptTypeScriptDocumentAuthorityActive(
  context: JavaScriptTypeScriptDocumentAuthorityContext,
  payload: StoredJavaScriptTypeScriptDocumentAuthority,
  authority: {
    readonly path: string;
    readonly rootAndSessionActive: boolean;
    readonly rootPath: string;
  },
): boolean {
  const model = payload.__documentModel;
  const modelVersion = payload.__documentModelVersion;
  const syncVersion = payload.__documentSyncVersion;
  if (!model || modelVersion === undefined || syncVersion === undefined) {
    return false;
  }

  const activeDocument = context.getActiveDocument();
  return (
    authority.rootAndSessionActive &&
    payload.__documentRegistrationLease?.active === true &&
    payload.__documentOwnerEpoch === context.getActiveJavaScriptTypeScriptOwnerEpoch() &&
    Boolean(activeDocument) &&
    activeDocument?.path === authority.path &&
    !isLargeJavaScriptTypeScriptProviderDocument(
      model,
      activeDocument,
      context.getLargeSmartDocumentPolicy(),
    ) &&
    (context.getActiveModel === undefined || context.getActiveModel() === model) &&
    model.getVersionId() === modelVersion &&
    context.getDocumentSyncVersion(authority.rootPath, authority.path) === syncVersion
  );
}

export function refreshStoredJavaScriptTypeScriptDocumentAuthority(
  context: JavaScriptTypeScriptDocumentAuthorityContext,
  payload: StoredJavaScriptTypeScriptDocumentAuthority,
  authority: {
    readonly path: string;
    readonly rootAndSessionActive: boolean;
    readonly rootPath: string;
  },
): boolean {
  const model = payload.__documentModel;
  if (
    !model ||
    !canContinueStoredJavaScriptTypeScriptDocumentAuthority(context, payload, authority)
  ) {
    return false;
  }

  const syncVersion = context.getDocumentSyncVersion(authority.rootPath, authority.path);
  if (syncVersion === null) {
    return false;
  }

  Object.defineProperties(payload, {
    __documentModelVersion: { configurable: true, value: model.getVersionId() },
    __documentOwnerEpoch: {
      configurable: true,
      value: context.getActiveJavaScriptTypeScriptOwnerEpoch(),
    },
    __documentSyncVersion: { configurable: true, value: syncVersion },
  });
  return true;
}

export function canContinueStoredJavaScriptTypeScriptDocumentAuthority(
  context: JavaScriptTypeScriptDocumentAuthorityContext,
  payload: StoredJavaScriptTypeScriptDocumentAuthority,
  authority: {
    readonly path: string;
    readonly rootAndSessionActive: boolean;
    readonly rootPath: string;
  },
): boolean {
  const model = payload.__documentModel;
  const activeDocument = context.getActiveDocument();
  if (!model || !activeDocument) {
    return false;
  }

  return (
    authority.rootAndSessionActive &&
    payload.__documentRegistrationLease?.active === true &&
    activeDocument.path === authority.path &&
    (context.getActiveModel === undefined || context.getActiveModel() === model) &&
    !isLargeJavaScriptTypeScriptProviderDocument(
      model,
      activeDocument,
      context.getLargeSmartDocumentPolicy(),
    )
  );
}
