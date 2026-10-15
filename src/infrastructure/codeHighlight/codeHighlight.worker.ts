/// <reference lib="webworker" />

import { createAppHighlighter } from "../shikiHighlighter";
import type { CodeHighlightWorkerResponse } from "./codeHighlightProtocol";
import { createCodeHighlightWorkerHandler } from "./codeHighlightWorkerHandler";
import { highlightWithShiki } from "./shikiCodeTokens";

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

const handler = createCodeHighlightWorkerHandler({
  highlight: async (request) => highlightWithShiki(await createAppHighlighter(), request),
  post: (response: CodeHighlightWorkerResponse) => workerScope.postMessage(response),
});

workerScope.onmessage = (event: MessageEvent<unknown>) => handler.receive(event.data);

export {};
