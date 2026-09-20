import type {
  ExternalSessionImportGateway,
  ExternalSessionImportOwner,
  ExternalSessionImportProgress,
} from "../domain/externalSessionImport";

const MAX_IMPORT_STEPS_PER_RUN = 16_384;
/** A retry resumes the durable checkpoint. No provider process is started. */
export async function importSavedSessionHistory(
  gateway: ExternalSessionImportGateway,
  request: ExternalSessionImportOwner,
  isCurrent: () => boolean,
): Promise<ExternalSessionImportProgress> {
  for (let step = 0; step < MAX_IMPORT_STEPS_PER_RUN && isCurrent(); step += 1) {
    const progress = await gateway.importSessionHistory(request);
    if (!isCurrent()) throw new Error("The project changed while importing the session.");
    if (progress.complete) return progress;
  }
  if (!isCurrent()) throw new Error("The project changed while importing the session.");
  throw new Error(
    "The import checkpoint was saved. Retry importing this session to continue its remaining history.",
  );
}
