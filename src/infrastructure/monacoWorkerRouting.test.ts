import { describe, expect, it } from "vitest";
import {
  selectMonacoWorkerConstructor,
  type MonacoWorkerConstructors,
} from "./monacoWorkerRouting";

class CssWorker {}
class EditorWorker {}
class HtmlWorker {}
class JsonWorker {}
class TypeScriptWorker {}

const workers: MonacoWorkerConstructors<object> = {
  css: CssWorker,
  editor: EditorWorker,
  html: HtmlWorker,
  json: JsonWorker,
  typescript: TypeScriptWorker,
};

describe("selectMonacoWorkerConstructor", () => {
  it("routes supported Monaco language labels", () => {
    expect(selectMonacoWorkerConstructor("json", workers)).toBe(JsonWorker);
    expect(selectMonacoWorkerConstructor("css", workers)).toBe(CssWorker);
    expect(selectMonacoWorkerConstructor("scss", workers)).toBe(CssWorker);
    expect(selectMonacoWorkerConstructor("less", workers)).toBe(CssWorker);
    expect(selectMonacoWorkerConstructor("html", workers)).toBe(HtmlWorker);
    expect(selectMonacoWorkerConstructor("handlebars", workers)).toBe(HtmlWorker);
    expect(selectMonacoWorkerConstructor("razor", workers)).toBe(HtmlWorker);
    expect(selectMonacoWorkerConstructor("typescript", workers)).toBe(TypeScriptWorker);
    expect(selectMonacoWorkerConstructor("javascript", workers)).toBe(TypeScriptWorker);
  });

  it("uses the editor worker for plain editor models", () => {
    expect(selectMonacoWorkerConstructor("php", workers)).toBe(EditorWorker);
    expect(selectMonacoWorkerConstructor("plaintext", workers)).toBe(EditorWorker);
  });
});
