import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import {
  selectMonacoWorkerConstructor,
  type MonacoWorkerConstructors,
} from "./monacoWorkerRouting";

interface MonacoGlobal {
  MonacoEnvironment?: monaco.Environment;
}

const monacoWorkers: MonacoWorkerConstructors = {
  css: cssWorker,
  editor: editorWorker,
  html: htmlWorker,
  json: jsonWorker,
  typescript: tsWorker,
};

export function configureMonacoEnvironment(
  globalScope: MonacoGlobal = globalThis as unknown as MonacoGlobal,
): void {
  globalScope.MonacoEnvironment = {
    getWorker: (_workerId, label) => {
      const WorkerConstructor = selectMonacoWorkerConstructor(label, monacoWorkers);

      return new WorkerConstructor();
    },
  };

  loader.config({ monaco });
}
