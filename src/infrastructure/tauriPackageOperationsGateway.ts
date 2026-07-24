import { invoke } from "@tauri-apps/api/core";
import type {
  PackageOperationPreview,
  PackageOperationRequest,
  PackageOperationRunResult,
  PackageOperationsGateway,
} from "../domain/packageOperations";
import {
  invokePackageOperationsIpc,
  PACKAGE_OPERATIONS_IPC_COMMANDS,
  type InvokePackageOperationsCommand,
} from "./tauriPackageOperationsIpcContract";

const invokePackageOperationsCommand: InvokePackageOperationsCommand = (command, args) =>
  invoke(command, args);

export class TauriPackageOperationsGateway implements PackageOperationsGateway {
  constructor(
    private readonly invokeCommand: InvokePackageOperationsCommand = invokePackageOperationsCommand,
  ) {}

  previewPackageOperation(request: PackageOperationRequest): Promise<PackageOperationPreview> {
    return invokePackageOperationsIpc(
      this.invokeCommand,
      PACKAGE_OPERATIONS_IPC_COMMANDS.preview,
      request,
    );
  }

  runPackageOperation(request: PackageOperationRequest): Promise<PackageOperationRunResult> {
    return invokePackageOperationsIpc(
      this.invokeCommand,
      PACKAGE_OPERATIONS_IPC_COMMANDS.run,
      request,
    );
  }
}
