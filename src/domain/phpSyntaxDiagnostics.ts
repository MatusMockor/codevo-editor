export interface PhpSyntaxDiagnostic {
  character: number;
  endCharacter: number;
  endLine: number;
  line: number;
  message: string;
}

export interface PhpSyntaxDiagnosticsGateway {
  validate(source: string): Promise<PhpSyntaxDiagnostic[]>;
}
