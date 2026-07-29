import type {
  EditorChangeHunksComputationGateway,
  EditorChangeHunksComputationRequest,
  EditorChangeHunksComputationResponse,
} from "../application/editorChangeHunksComputation";

export const EDITOR_CHANGE_HUNKS_TIMEOUT_MS = 5_000;

type EditorChangeHunksWorker = Pick<
  Worker,
  "onerror" | "onmessage" | "onmessageerror" | "postMessage" | "terminate"
>;
type EditorChangeHunksWorkerFactory = () => EditorChangeHunksWorker;

export class BrowserEditorChangeHunksGateway implements EditorChangeHunksComputationGateway {
  private activeCancel: (() => void) | null = null;
  private worker: EditorChangeHunksWorker | null = null;

  constructor(
    private readonly createWorker: EditorChangeHunksWorkerFactory = defaultWorkerFactory,
    private readonly timeoutMs = EDITOR_CHANGE_HUNKS_TIMEOUT_MS,
  ) {}

  compute(
    request: EditorChangeHunksComputationRequest,
    signal: AbortSignal,
  ): Promise<EditorChangeHunksComputationResponse> {
    if (signal.aborted) {
      return Promise.reject(abortError());
    }

    // The gateway has one active editor owner. A newer request supersedes and
    // physically terminates an older worker computation before it can queue.
    this.activeCancel?.();
    let worker: EditorChangeHunksWorker;
    try {
      worker = this.worker ?? this.createWorker();
    } catch (error) {
      return Promise.reject(error);
    }
    this.worker = worker;

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: number | null = null;
      const settle = (
        outcome:
          | { readonly kind: "resolve"; readonly value: EditorChangeHunksComputationResponse }
          | { readonly kind: "reject"; readonly value: unknown },
        terminate: boolean,
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout !== null) {
          window.clearTimeout(timeout);
        }
        signal.removeEventListener("abort", cancel);
        if (this.activeCancel === cancel) {
          this.activeCancel = null;
        }
        if (terminate) {
          worker.terminate();
          if (this.worker === worker) {
            this.worker = null;
          }
        }
        if (outcome.kind === "resolve") {
          resolve(outcome.value);
        } else {
          reject(outcome.value);
        }
      };
      const cancel = () => settle({ kind: "reject", value: abortError() }, true);
      this.activeCancel = cancel;

      signal.addEventListener("abort", cancel, { once: true });
      timeout = window.setTimeout(
        () => {
          settle(
            {
              kind: "reject",
              value: new Error("Editor change calculation timed out."),
            },
            true,
          );
        },
        Math.max(1, this.timeoutMs),
      );
      worker.onerror = (event) => {
        settle(
          {
            kind: "reject",
            value: new Error(event.message || "Editor change calculation worker failed."),
          },
          true,
        );
      };
      worker.onmessageerror = () => {
        settle(
          {
            kind: "reject",
            value: new Error("Editor change calculation returned an unreadable response."),
          },
          true,
        );
      };
      worker.onmessage = (event: MessageEvent<EditorChangeHunksComputationResponse>) => {
        const response = event.data;
        if (
          response.generation !== request.generation ||
          response.ownerKey !== request.ownerKey ||
          response.path !== request.path
        ) {
          settle(
            {
              kind: "reject",
              value: new Error("Editor change calculation returned mismatched authority."),
            },
            true,
          );
          return;
        }
        settle({ kind: "resolve", value: response }, false);
      };

      try {
        worker.postMessage(request);
      } catch (error) {
        settle({ kind: "reject", value: error }, true);
      }
    });
  }
}

function defaultWorkerFactory(): EditorChangeHunksWorker {
  return new Worker(new URL("./editorChangeHunks.worker.ts", import.meta.url), {
    type: "module",
  });
}

function abortError(): DOMException {
  return new DOMException("Editor change calculation was cancelled.", "AbortError");
}
