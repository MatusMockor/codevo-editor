export type MonacoWorkerConstructor<TWorker = Worker> = new () => TWorker;

export interface MonacoWorkerConstructors<TWorker = Worker> {
  css: MonacoWorkerConstructor<TWorker>;
  editor: MonacoWorkerConstructor<TWorker>;
  html: MonacoWorkerConstructor<TWorker>;
  json: MonacoWorkerConstructor<TWorker>;
  typescript: MonacoWorkerConstructor<TWorker>;
}

export function selectMonacoWorkerConstructor<TWorker>(
  label: string,
  workers: MonacoWorkerConstructors<TWorker>,
): MonacoWorkerConstructor<TWorker> {
  if (label === "json") {
    return workers.json;
  }

  if (label === "css" || label === "scss" || label === "less") {
    return workers.css;
  }

  if (label === "html" || label === "handlebars" || label === "razor") {
    return workers.html;
  }

  if (label === "typescript" || label === "javascript") {
    return workers.typescript;
  }

  return workers.editor;
}
