declare module "monaco-editor/esm/vs/base/common/uri.js" {
  export interface UriValue {
    toString(): string;
  }

  export const URI: {
    parse(value: string): UriValue;
  };
}
