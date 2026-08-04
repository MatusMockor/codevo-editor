import type * as Monaco from "monaco-editor";
import type {
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerSignature,
  LanguageServerSignatureHelp,
  LanguageServerSignatureHelpContext,
  LanguageServerSignatureParameter,
} from "../../domain/languageServerFeatures";
import {
  javaScriptTypeScriptProviderRequestDidNotComplete,
  runBoundedJavaScriptTypeScriptProviderRequest,
  type JavaScriptTypeScriptProviderRequestBoundary,
  type JavaScriptTypeScriptProviderRequestCancellationPort,
} from "./requestBoundary";

interface SignatureHelpProviderContext {
  cancelRequest?: JavaScriptTypeScriptProviderRequestCancellationPort;
  featuresGateway: Pick<JavaScriptTypeScriptLanguageServerFeaturesGateway, "signatureHelp">;
}

export async function provideJavaScriptTypeScriptSignatureHelp<
  Context extends SignatureHelpProviderContext,
>(
  context: Context,
  boundary: JavaScriptTypeScriptProviderRequestBoundary<Context>,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  token?: Monaco.CancellationToken,
  signatureContext?: Monaco.languages.SignatureHelpContext,
): Promise<Monaco.languages.SignatureHelpResult | null> {
  const request = boundary.createFeatureRequest(context, model, position, "signatureHelp");

  if (!request) {
    return null;
  }

  try {
    if (!(await boundary.flushActiveRequest(context, request))) {
      return null;
    }

    const languageServerSignatureContext = toLanguageServerSignatureHelpContext(signatureContext);
    const signatureHelp = await runBoundedJavaScriptTypeScriptProviderRequest(
      languageServerSignatureContext
        ? context.featuresGateway.signatureHelp(
            request.rootPath,
            request.position,
            languageServerSignatureContext,
            request.sessionId,
          )
        : context.featuresGateway.signatureHelp(
            request.rootPath,
            request.position,
            undefined,
            request.sessionId,
          ),
      request.sessionId,
      token,
      request.rootPath,
      undefined,
      context.cancelRequest,
    );

    if (javaScriptTypeScriptProviderRequestDidNotComplete(signatureHelp)) {
      return null;
    }

    if (token?.isCancellationRequested) {
      return null;
    }

    if (!boundary.isActiveRequest(context, request)) {
      return null;
    }

    return signatureHelp ? toMonacoSignatureHelp(signatureHelp) : null;
  } catch (error) {
    if (token?.isCancellationRequested) {
      return null;
    }
    boundary.reportActiveRequestError(context, request, error);
    return null;
  }
}

function toLanguageServerSignatureHelpContext(
  context: Monaco.languages.SignatureHelpContext | undefined,
): LanguageServerSignatureHelpContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    ...(context.activeSignatureHelp
      ? {
          activeSignatureHelp: toLanguageServerSignatureHelp(context.activeSignatureHelp),
        }
      : {}),
    isRetrigger: context.isRetrigger,
    ...(context.triggerCharacter ? { triggerCharacter: context.triggerCharacter } : {}),
    triggerKind: context.triggerKind as LanguageServerSignatureHelpContext["triggerKind"],
  };
}

function toLanguageServerSignatureHelp(
  signatureHelp: Monaco.languages.SignatureHelp,
): LanguageServerSignatureHelp {
  return {
    activeParameter: signatureHelp.activeParameter,
    activeSignature: signatureHelp.activeSignature,
    signatures: signatureHelp.signatures.map(toLanguageServerSignature),
  };
}

function toLanguageServerSignature(
  signature: Monaco.languages.SignatureInformation,
): LanguageServerSignature {
  return {
    documentation: markdownStringValue(signature.documentation),
    label: signature.label,
    parameters: signature.parameters.map((parameter) =>
      toLanguageServerSignatureParameter(signature.label, parameter),
    ),
  };
}

function toLanguageServerSignatureParameter(
  signatureLabel: string,
  parameter: Monaco.languages.ParameterInformation,
): LanguageServerSignatureParameter {
  return {
    documentation: markdownStringValue(parameter.documentation),
    label: signatureParameterLabel(signatureLabel, parameter.label),
  };
}

function signatureParameterLabel(signatureLabel: string, label: string | [number, number]): string {
  if (typeof label === "string") {
    return label;
  }

  const [start, end] = label;
  return signatureLabel.slice(start, end);
}

function markdownStringValue(value: Monaco.IMarkdownString | string | undefined): string | null {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.value;
}

function toMonacoSignatureHelp(
  signatureHelp: LanguageServerSignatureHelp,
): Monaco.languages.SignatureHelpResult {
  return {
    dispose: () => undefined,
    value: {
      activeParameter: signatureHelp.activeParameter,
      activeSignature: signatureHelp.activeSignature,
      signatures: signatureHelp.signatures.map(toMonacoSignatureInformation),
    },
  };
}

function toMonacoSignatureInformation(
  signature: LanguageServerSignature,
): Monaco.languages.SignatureInformation {
  return {
    documentation: signature.documentation || undefined,
    label: signature.label,
    parameters: signature.parameters.map(toMonacoParameterInformation),
  };
}

function toMonacoParameterInformation(
  parameter: LanguageServerSignatureParameter,
): Monaco.languages.ParameterInformation {
  return {
    documentation: parameter.documentation || undefined,
    label: parameter.label,
  };
}
