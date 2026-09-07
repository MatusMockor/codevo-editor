import type { DocumentSessionOwnerLease } from "../domain/documentSession";
import type { EditorDocument } from "../domain/workspace";
import type {
  DocumentSessionCompatibilityProjectionActivation,
  DocumentSessionCompatibilityProjectionLease,
} from "./documentSessionStorePort";

export interface StoredCompatibilityProjection {
  readonly activation: DocumentSessionCompatibilityProjectionActivation;
  readonly clear: () => void;
  readonly deleteDocument: (path: string) => void;
  readonly replaceAll: (documents: Readonly<Record<string, Readonly<EditorDocument>>>) => void;
  readonly setDocument: (document: Readonly<EditorDocument>) => void;
}
export function createStoredCompatibilityProjection(
  owner: DocumentSessionOwnerLease,
  documents: ReadonlyMap<string, { readonly document: Readonly<EditorDocument> }>,
): StoredCompatibilityProjection {
  let records = Object.create(null) as Record<string, Readonly<EditorDocument>>;
  for (const document of documents.values()) {
    records[document.document.path] = document.document;
  }
  const proxyTarget = Object.create(null) as Record<string, never>;
  const projection = new Proxy(proxyTarget, {
    defineProperty: () => false,
    deleteProperty: () => false,
    get: (_target, property) =>
      Object.prototype.hasOwnProperty.call(records, property)
        ? records[property as string]
        : undefined,
    getOwnPropertyDescriptor: (_target, property) => {
      if (!Object.prototype.hasOwnProperty.call(records, property)) {
        return undefined;
      }
      return {
        configurable: true,
        enumerable: true,
        value: records[property as string],
        writable: false,
      };
    },
    getPrototypeOf: () => null,
    has: (_target, property) => Object.prototype.hasOwnProperty.call(records, property),
    isExtensible: () => true,
    ownKeys: () => Reflect.ownKeys(records),
    preventExtensions: () => false,
    set: () => false,
    setPrototypeOf: () => false,
  }) as Readonly<Record<string, Readonly<EditorDocument>>>;
  const activation = Object.freeze({
    lease: Object.freeze({
      authority: Object.freeze({}),
      ownerGeneration: owner.generation,
      ownerIncarnation: owner.incarnation,
      ownerKey: owner.ownerKey,
    }),
    projection,
  });
  return {
    activation,
    clear: () => {
      records = Object.create(null) as Record<string, Readonly<EditorDocument>>;
    },
    deleteDocument: (path) => {
      delete records[path];
    },
    replaceAll: (documentsByPath) => {
      records = documentsByPath as Record<string, Readonly<EditorDocument>>;
    },
    setDocument: (document) => {
      records[document.path] = document;
    },
  };
}

export function compatibilityProjectionLeaseEqual(
  current: DocumentSessionCompatibilityProjectionLease,
  candidate: DocumentSessionCompatibilityProjectionLease,
): boolean {
  return (
    current.authority === candidate.authority &&
    current.ownerGeneration === candidate.ownerGeneration &&
    current.ownerIncarnation === candidate.ownerIncarnation &&
    current.ownerKey === candidate.ownerKey
  );
}
