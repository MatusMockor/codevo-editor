use crate::project::WorkspaceDescriptor;
use crate::tools::{JavaScriptTypeScriptToolAvailability, PhpToolAvailability, ToolLocation};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerPlan {
    pub provider: LanguageServerProvider,
    pub status: LanguageServerPlanStatus,
    pub message: String,
    pub command: Option<LanguageServerCommand>,
    pub initialize_request: Option<JsonRpcRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LanguageServerProvider {
    Phpactor,
    TypeScriptLanguageServer,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LanguageServerPlanStatus {
    Blocked,
    Ready,
    Unavailable,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerCommand {
    pub executable: String,
    pub args: Vec<String>,
    pub working_directory: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    pub params: Value,
}

pub trait LanguageServerPlanner {
    fn plan(
        &self,
        root: &Path,
        trusted: bool,
        descriptor: &WorkspaceDescriptor,
        tools: &PhpToolAvailability,
    ) -> LanguageServerPlan;
}

pub trait JavaScriptTypeScriptLanguageServerPlanner {
    fn plan(
        &self,
        root: &Path,
        tools: &JavaScriptTypeScriptToolAvailability,
        settings: TypeScriptLanguageServerSettings,
    ) -> LanguageServerPlan;
}

pub trait InitializeRequestFactory {
    fn create(&self, root: &Path) -> JsonRpcRequest;
}

pub struct PhpactorLanguageServerPlanner<TFactory = PhpactorInitializeRequestFactory> {
    initialize_request_factory: TFactory,
}

impl PhpactorLanguageServerPlanner {
    pub fn new() -> Self {
        Self {
            initialize_request_factory: PhpactorInitializeRequestFactory,
        }
    }
}

impl<TFactory> PhpactorLanguageServerPlanner<TFactory>
where
    TFactory: InitializeRequestFactory,
{
    fn ready_plan(&self, root: &Path, phpactor: &ToolLocation) -> LanguageServerPlan {
        LanguageServerPlan {
            provider: LanguageServerProvider::Phpactor,
            status: LanguageServerPlanStatus::Ready,
            message: "PHPactor LSP is ready to start.".to_string(),
            command: Some(LanguageServerCommand {
                executable: phpactor.path.clone(),
                args: vec!["language-server".to_string()],
                working_directory: root.to_string_lossy().to_string(),
            }),
            initialize_request: Some(self.initialize_request_factory.create(root)),
        }
    }
}

impl<TFactory> LanguageServerPlanner for PhpactorLanguageServerPlanner<TFactory>
where
    TFactory: InitializeRequestFactory,
{
    fn plan(
        &self,
        root: &Path,
        trusted: bool,
        descriptor: &WorkspaceDescriptor,
        tools: &PhpToolAvailability,
    ) -> LanguageServerPlan {
        if !trusted {
            return blocked_plan("Trust this workspace to enable PHPactor LSP.");
        }

        if descriptor.php.is_none() {
            return unavailable_plan("This workspace is not a PHP Composer project.");
        }

        let Some(phpactor) = tools.phpactor.as_ref() else {
            return unavailable_plan(
                "Managed PHP IDE engine was not found. Install PHPactor into Mockor Editor tools or set MOCKOR_EDITOR_PHPACTOR_PATH.",
            );
        };

        self.ready_plan(root, phpactor)
    }
}

pub struct PhpactorInitializeRequestFactory;

impl InitializeRequestFactory for PhpactorInitializeRequestFactory {
    fn create(&self, root: &Path) -> JsonRpcRequest {
        let root_uri = file_uri(root);
        let workspace_name = root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("workspace");

        JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "initialize".to_string(),
            params: json!({
                "processId": Value::Null,
                "rootUri": root_uri,
                "capabilities": {},
                "workspaceFolders": [
                    {
                        "uri": root_uri,
                        "name": workspace_name,
                    }
                ],
            }),
        }
    }
}

pub struct TypeScriptLanguageServerPlanner<TFactory = TypeScriptInitializeRequestFactory> {
    initialize_request_factory: TFactory,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TypeScriptLanguageServerSettings {
    pub auto_imports: bool,
    pub code_lens: bool,
    pub inlay_hints: bool,
}

impl Default for TypeScriptLanguageServerSettings {
    fn default() -> Self {
        Self {
            auto_imports: true,
            code_lens: false,
            inlay_hints: true,
        }
    }
}

impl TypeScriptLanguageServerPlanner {
    pub fn new() -> Self {
        Self {
            initialize_request_factory: TypeScriptInitializeRequestFactory,
        }
    }
}

impl<TFactory> TypeScriptLanguageServerPlanner<TFactory>
where
    TFactory: InitializeRequestFactory,
{
    fn ready_plan(
        &self,
        root: &Path,
        server: &ToolLocation,
        typescript_server: Option<&ToolLocation>,
        settings: TypeScriptLanguageServerSettings,
    ) -> LanguageServerPlan {
        let mut initialize_request = self.initialize_request_factory.create(root);

        if let Some(typescript_server) = typescript_server {
            configure_typescript_server_path(&mut initialize_request, &typescript_server.path);
        }
        configure_typescript_auto_imports(&mut initialize_request, settings.auto_imports);
        configure_typescript_code_lens(&mut initialize_request, settings.code_lens);
        configure_typescript_inlay_hints(&mut initialize_request, settings.inlay_hints);

        LanguageServerPlan {
            provider: LanguageServerProvider::TypeScriptLanguageServer,
            status: LanguageServerPlanStatus::Ready,
            message: "TypeScript language server is ready to start.".to_string(),
            command: Some(LanguageServerCommand {
                executable: server.path.clone(),
                args: vec!["--stdio".to_string()],
                working_directory: root.to_string_lossy().to_string(),
            }),
            initialize_request: Some(initialize_request),
        }
    }
}

impl<TFactory> JavaScriptTypeScriptLanguageServerPlanner
    for TypeScriptLanguageServerPlanner<TFactory>
where
    TFactory: InitializeRequestFactory,
{
    fn plan(
        &self,
        root: &Path,
        tools: &JavaScriptTypeScriptToolAvailability,
        settings: TypeScriptLanguageServerSettings,
    ) -> LanguageServerPlan {
        if !is_javascript_typescript_workspace(root) {
            return unavailable_javascript_typescript_plan(
                "This workspace does not look like a JavaScript or TypeScript project.",
            );
        }

        let Some(server) = tools.typescript_language_server.as_ref() else {
            return unavailable_javascript_typescript_plan(
                "Managed TypeScript language server was not found.",
            );
        };

        self.ready_plan(root, server, tools.typescript_server.as_ref(), settings)
    }
}

fn configure_typescript_server_path(request: &mut JsonRpcRequest, path: &str) {
    let Some(params) = request.params.as_object_mut() else {
        return;
    };
    let initialization_options = params
        .entry("initializationOptions")
        .or_insert_with(|| json!({}));
    let Some(initialization_options) = initialization_options.as_object_mut() else {
        return;
    };

    initialization_options.insert(
        "tsserver".to_string(),
        json!({
            "path": path,
        }),
    );
}

fn configure_typescript_inlay_hints(request: &mut JsonRpcRequest, enabled: bool) {
    let Some(preferences) = typescript_preferences_mut(request) else {
        return;
    };

    preferences.insert(
        "includeInlayParameterNameHints".to_string(),
        Value::String(if enabled { "literals" } else { "none" }.to_string()),
    );
    preferences.insert(
        "includeInlayParameterNameHintsWhenArgumentMatchesName".to_string(),
        Value::Bool(false),
    );

    for key in [
        "includeInlayEnumMemberValueHints",
        "includeInlayFunctionLikeReturnTypeHints",
        "includeInlayFunctionParameterTypeHints",
        "includeInlayPropertyDeclarationTypeHints",
        "includeInlayVariableTypeHints",
        "includeInlayVariableTypeHintsWhenTypeMatchesName",
    ] {
        preferences.insert(key.to_string(), Value::Bool(enabled));
    }
}

fn configure_typescript_auto_imports(request: &mut JsonRpcRequest, enabled: bool) {
    let Some(preferences) = typescript_preferences_mut(request) else {
        return;
    };

    preferences.insert(
        "includeCompletionsForImportStatements".to_string(),
        Value::Bool(enabled),
    );
    preferences.insert(
        "includeCompletionsForModuleExports".to_string(),
        Value::Bool(enabled),
    );
    preferences.insert(
        "includePackageJsonAutoImports".to_string(),
        Value::String(if enabled { "auto" } else { "off" }.to_string()),
    );
}

fn configure_typescript_code_lens(request: &mut JsonRpcRequest, enabled: bool) {
    let Some(preferences) = typescript_preferences_mut(request) else {
        return;
    };

    preferences.insert("mockorCodeLensEnabled".to_string(), Value::Bool(enabled));
}

fn typescript_preferences_mut(
    request: &mut JsonRpcRequest,
) -> Option<&mut serde_json::Map<String, Value>> {
    let params = request.params.as_object_mut()?;
    let initialization_options = params
        .entry("initializationOptions")
        .or_insert_with(|| json!({}));
    let initialization_options = initialization_options.as_object_mut()?;
    let preferences = initialization_options
        .entry("preferences")
        .or_insert_with(|| json!({}));

    preferences.as_object_mut()
}

pub struct TypeScriptInitializeRequestFactory;

impl InitializeRequestFactory for TypeScriptInitializeRequestFactory {
    fn create(&self, root: &Path) -> JsonRpcRequest {
        let root_uri = file_uri(root);
        let workspace_name = root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("workspace");

        JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: 1,
            method: "initialize".to_string(),
            params: json!({
                "processId": Value::Null,
                "rootUri": root_uri,
                "capabilities": {
                    "textDocument": {
                        "completion": {
                            "completionItem": {
                                "commitCharactersSupport": true,
                                "deprecatedSupport": true,
                                "documentationFormat": ["markdown", "plaintext"],
                                "insertReplaceSupport": true,
                                "labelDetailsSupport": true,
                                "preselectSupport": true,
                                "snippetSupport": true,
                                "resolveSupport": {
                                    "properties": ["documentation", "detail", "additionalTextEdits", "labelDetails"]
                                }
                            },
                            "contextSupport": true,
                            "dynamicRegistration": false
                        },
                        "codeAction": {
                            "codeActionLiteralSupport": {
                                "codeActionKind": {
                                    "valueSet": [
                                        "",
                                        "quickfix",
                                        "refactor",
                                        "refactor.extract",
                                        "refactor.inline",
                                        "refactor.rewrite",
                                        "source",
                                        "source.fixAll",
                                        "source.organizeImports"
                                    ]
                                }
                            },
                            "dynamicRegistration": false,
                            "isPreferredSupport": true,
                            "resolveSupport": {
                                "properties": ["edit", "command"]
                            }
                        },
                        "codeLens": {
                            "dynamicRegistration": false
                        },
                        "definition": { "dynamicRegistration": false },
                        "documentHighlight": { "dynamicRegistration": false },
                        "documentLink": {
                            "dynamicRegistration": false,
                            "tooltipSupport": true
                        },
                        "documentSymbol": { "dynamicRegistration": false },
                        "formatting": { "dynamicRegistration": false },
                        "hover": {
                            "contentFormat": ["markdown", "plaintext"],
                            "dynamicRegistration": false
                        },
                        "implementation": { "dynamicRegistration": false },
                        "linkedEditingRange": { "dynamicRegistration": false },
                        "rangeFormatting": { "dynamicRegistration": false },
                        "publishDiagnostics": {
                            "relatedInformation": true,
                            "versionSupport": true
                        },
                        "references": { "dynamicRegistration": false },
                        "rename": {
                            "dynamicRegistration": false,
                            "prepareSupport": true
                        },
                        "selectionRange": { "dynamicRegistration": false },
                        "semanticTokens": {
                            "dynamicRegistration": false,
                            "formats": ["relative"],
                            "multilineTokenSupport": false,
                            "overlappingTokenSupport": false,
                            "requests": {
                                "full": true,
                                "range": false
                            },
                            "serverCancelSupport": false,
                            "tokenModifiers": [
                                "declaration",
                                "definition",
                                "readonly",
                                "static",
                                "deprecated",
                                "abstract",
                                "async",
                                "modification",
                                "documentation",
                                "defaultLibrary"
                            ],
                            "tokenTypes": [
                                "namespace",
                                "type",
                                "class",
                                "enum",
                                "interface",
                                "struct",
                                "typeParameter",
                                "parameter",
                                "variable",
                                "property",
                                "enumMember",
                                "event",
                                "function",
                                "method",
                                "macro",
                                "keyword",
                                "modifier",
                                "comment",
                                "string",
                                "number",
                                "regexp",
                                "operator"
                            ]
                        },
                        "synchronization": {
                            "didSave": true,
                            "dynamicRegistration": false,
                            "willSave": false,
                            "willSaveWaitUntil": false
                        },
                        "typeDefinition": { "dynamicRegistration": false }
                    },
                    "workspace": {
                        "codeLens": { "refreshSupport": true },
                        "configuration": true,
                        "didChangeConfiguration": { "dynamicRegistration": false },
                        "symbol": { "dynamicRegistration": false },
                        "workspaceEdit": {
                            "documentChanges": true
                        },
                        "workspaceFolders": true
                    }
                },
                "initializationOptions": {
                    "hostInfo": "Mockor Editor",
                    "preferences": {
                        "allowIncompleteCompletions": true,
                        "allowRenameOfImportPath": true,
                        "allowTextChangesInNewFiles": true,
                        "displayPartsForJSDoc": true,
                        "generateReturnInDocTemplate": true,
                        "importModuleSpecifierEnding": "auto",
                        "importModuleSpecifierPreference": "shortest",
                        "includeAutomaticOptionalChainCompletions": true,
                        "includeCompletionsForImportStatements": true,
                        "includeCompletionsForModuleExports": true,
                        "includeCompletionsWithClassMemberSnippets": true,
                        "includeCompletionsWithInsertText": true,
                        "includeCompletionsWithObjectLiteralMethodSnippets": true,
                        "includeCompletionsWithSnippetText": true,
                        "includePackageJsonAutoImports": "auto",
                        "jsxAttributeCompletionStyle": "auto",
                        "maximumHoverLength": 500,
                        "preferTypeOnlyAutoImports": false,
                        "providePrefixAndSuffixTextForRename": true,
                        "provideRefactorNotApplicableReason": true,
                        "quotePreference": "auto"
                    }
                },
                "workspaceFolders": [
                    {
                        "uri": root_uri,
                        "name": workspace_name,
                    }
                ],
            }),
        }
    }
}

fn blocked_plan(message: &str) -> LanguageServerPlan {
    LanguageServerPlan {
        provider: LanguageServerProvider::Phpactor,
        status: LanguageServerPlanStatus::Blocked,
        message: message.to_string(),
        command: None,
        initialize_request: None,
    }
}

fn unavailable_plan(message: &str) -> LanguageServerPlan {
    LanguageServerPlan {
        provider: LanguageServerProvider::Phpactor,
        status: LanguageServerPlanStatus::Unavailable,
        message: message.to_string(),
        command: None,
        initialize_request: None,
    }
}

fn unavailable_javascript_typescript_plan(message: &str) -> LanguageServerPlan {
    LanguageServerPlan {
        provider: LanguageServerProvider::TypeScriptLanguageServer,
        status: LanguageServerPlanStatus::Unavailable,
        message: message.to_string(),
        command: None,
        initialize_request: None,
    }
}

fn is_javascript_typescript_workspace(root: &Path) -> bool {
    ["package.json", "tsconfig.json", "jsconfig.json"]
        .iter()
        .any(|file_name| root.join(file_name).is_file())
}

pub fn file_uri(root: &Path) -> String {
    let path = root
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/");
    let encoded = encode_uri_path(&path);

    if encoded.starts_with('/') {
        return format!("file://{encoded}");
    }

    format!("file:///{encoded}")
}

fn encode_uri_path(path: &str) -> String {
    let mut encoded = String::new();

    for byte in path.bytes() {
        if is_uri_path_byte(byte) {
            encoded.push(byte as char);
            continue;
        }

        encoded.push_str(&format!("%{byte:02X}"));
    }

    encoded
}

fn is_uri_path_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'/' | b':'
                | b'-'
                | b'.'
                | b'_'
                | b'~'
                | b'!'
                | b'$'
                | b'&'
                | b'\''
                | b'('
                | b')'
                | b'*'
                | b'+'
                | b','
                | b';'
                | b'='
        )
}

#[cfg(test)]
mod tests {
    use super::{
        file_uri, JavaScriptTypeScriptLanguageServerPlanner, LanguageServerPlanStatus,
        LanguageServerPlanner, LanguageServerProvider, PhpactorLanguageServerPlanner,
        TypeScriptLanguageServerPlanner, TypeScriptLanguageServerSettings,
    };
    use crate::project::{PhpProjectDescriptor, WorkspaceDescriptor};
    use crate::tools::{
        JavaScriptTypeScriptToolAvailability, PhpToolAvailability, ToolLocation, ToolSource,
    };
    use std::{fs, path::Path, time::SystemTime};

    #[test]
    fn untrusted_workspace_blocks_phpactor_plan() {
        let root = create_temp_dir("lsp-untrusted");
        let planner = PhpactorLanguageServerPlanner::new();
        let plan = planner.plan(
            &root,
            false,
            &php_descriptor(&root),
            &tools_with_phpactor(&root),
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Blocked));
        assert!(plan.command.is_none());
        assert!(plan.initialize_request.is_none());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn trusted_php_workspace_builds_phpactor_initialize_plan() {
        let root = create_temp_dir("lsp-ready");
        let planner = PhpactorLanguageServerPlanner::new();
        let plan = planner.plan(
            &root,
            true,
            &php_descriptor(&root),
            &tools_with_phpactor(&root),
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Ready));
        let command = plan.command.expect("language server command");
        assert_eq!(command.args, vec!["language-server"]);
        assert!(command.executable.ends_with("vendor/bin/phpactor"));

        let request = plan.initialize_request.expect("initialize request");
        assert_eq!(request.method, "initialize");
        assert_eq!(request.params["rootUri"], file_uri(&root));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn missing_phpactor_reports_unavailable_plan() {
        let root = create_temp_dir("lsp-missing-tool");
        let planner = PhpactorLanguageServerPlanner::new();
        let plan = planner.plan(
            &root,
            true,
            &php_descriptor(&root),
            &PhpToolAvailability {
                phpactor: None,
                intelephense: None,
            },
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Unavailable));
        assert!(plan.command.is_none());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn javascript_typescript_workspace_builds_typescript_language_server_plan() {
        let root = create_temp_dir("lsp-typescript-ready");
        fs::write(root.join("package.json"), "{}").expect("write package.json");
        let planner = TypeScriptLanguageServerPlanner::new();
        let plan = planner.plan(
            &root,
            &tools_with_typescript_language_server(&root),
            TypeScriptLanguageServerSettings::default(),
        );

        assert!(matches!(
            plan.provider,
            LanguageServerProvider::TypeScriptLanguageServer
        ));
        assert!(matches!(plan.status, LanguageServerPlanStatus::Ready));
        let command = plan.command.expect("language server command");
        assert_eq!(command.args, vec!["--stdio"]);
        assert!(command
            .executable
            .ends_with("node_modules/.bin/typescript-language-server"));

        let request = plan.initialize_request.expect("initialize request");
        assert_eq!(request.method, "initialize");
        assert_eq!(request.params["rootUri"], file_uri(&root));
        assert_eq!(
            request.params["initializationOptions"]["hostInfo"],
            "Mockor Editor"
        );
        assert!(request.params["initializationOptions"]["tsserver"]["path"]
            .as_str()
            .expect("tsserver path")
            .ends_with("node_modules/typescript/lib/tsserver.js"));
        assert_eq!(
            request.params["initializationOptions"]["preferences"]
                ["includeInlayParameterNameHints"],
            "literals"
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]["includeInlayVariableTypeHints"],
            true
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]
                ["includeCompletionsForModuleExports"],
            true
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]
                ["includeCompletionsWithSnippetText"],
            true
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]
                ["includeCompletionsWithObjectLiteralMethodSnippets"],
            true
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]
                ["provideRefactorNotApplicableReason"],
            true
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]["includePackageJsonAutoImports"],
            "auto"
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]["mockorCodeLensEnabled"],
            false
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["completion"]["completionItem"]
                ["labelDetailsSupport"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["codeLens"]["dynamicRegistration"],
            false
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["completion"]["completionItem"]
                ["insertReplaceSupport"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["completion"]["completionItem"]
                ["commitCharactersSupport"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["documentHighlight"]
                ["dynamicRegistration"],
            false
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["documentLink"]["tooltipSupport"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["selectionRange"]["dynamicRegistration"],
            false
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["rangeFormatting"]
                ["dynamicRegistration"],
            false
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["linkedEditingRange"]
                ["dynamicRegistration"],
            false
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["typeDefinition"]["dynamicRegistration"],
            false
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["semanticTokens"]["formats"][0],
            "relative"
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["semanticTokens"]["requests"]["full"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["codeLens"]["refreshSupport"],
            true
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn javascript_typescript_plan_can_disable_completion_preferences() {
        let root = create_temp_dir("lsp-typescript-completion-preferences-disabled");
        fs::write(root.join("package.json"), "{}").expect("write package.json");
        let planner = TypeScriptLanguageServerPlanner::new();
        let plan = planner.plan(
            &root,
            &tools_with_typescript_language_server(&root),
            TypeScriptLanguageServerSettings {
                auto_imports: false,
                code_lens: true,
                inlay_hints: false,
            },
        );

        let request = plan.initialize_request.expect("initialize request");
        assert_eq!(
            request.params["initializationOptions"]["preferences"]
                ["includeInlayParameterNameHints"],
            "none"
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]["includeInlayVariableTypeHints"],
            false
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]
                ["includeCompletionsForModuleExports"],
            false
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]["includePackageJsonAutoImports"],
            "off"
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]["mockorCodeLensEnabled"],
            true
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn non_javascript_typescript_workspace_reports_unavailable_plan() {
        let root = create_temp_dir("lsp-typescript-unavailable");
        let planner = TypeScriptLanguageServerPlanner::new();
        let plan = planner.plan(
            &root,
            &tools_with_typescript_language_server(&root),
            TypeScriptLanguageServerSettings::default(),
        );

        assert!(matches!(
            plan.provider,
            LanguageServerProvider::TypeScriptLanguageServer
        ));
        assert!(matches!(plan.status, LanguageServerPlanStatus::Unavailable));
        assert!(plan.command.is_none());
        assert!(plan.initialize_request.is_none());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn file_uri_encodes_spaces() {
        assert_eq!(
            file_uri(Path::new("/tmp/project with spaces")),
            "file:///tmp/project%20with%20spaces"
        );
    }

    fn php_descriptor(root: &Path) -> WorkspaceDescriptor {
        WorkspaceDescriptor {
            root_path: root.to_string_lossy().to_string(),
            php: Some(PhpProjectDescriptor {
                classmap_roots: Vec::new(),
                has_composer: true,
                package_name: Some("example/app".to_string()),
                packages: Vec::new(),
                php_platform_version: None,
                php_version_constraint: Some("^8.3".to_string()),
                psr4_roots: Vec::new(),
            }),
            js_ts: None,
        }
    }

    fn tools_with_phpactor(root: &Path) -> PhpToolAvailability {
        PhpToolAvailability {
            phpactor: Some(ToolLocation {
                executable: "phpactor".to_string(),
                path: root
                    .join("vendor")
                    .join("bin")
                    .join("phpactor")
                    .to_string_lossy()
                    .to_string(),
                source: ToolSource::WorkspaceVendorBin,
            }),
            intelephense: None,
        }
    }

    fn tools_with_typescript_language_server(root: &Path) -> JavaScriptTypeScriptToolAvailability {
        JavaScriptTypeScriptToolAvailability {
            typescript_language_server: Some(ToolLocation {
                executable: "typescript-language-server".to_string(),
                path: root
                    .join("node_modules")
                    .join(".bin")
                    .join("typescript-language-server")
                    .to_string_lossy()
                    .to_string(),
                source: ToolSource::WorkspaceNodeModulesBin,
            }),
            typescript_server: Some(ToolLocation {
                executable: "tsserver.js".to_string(),
                path: root
                    .join("node_modules")
                    .join("typescript")
                    .join("lib")
                    .join("tsserver.js")
                    .to_string_lossy()
                    .to_string(),
                source: ToolSource::WorkspaceNodeModulesBin,
            }),
        }
    }

    fn create_temp_dir(prefix: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("{prefix}-{nanos}"));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }
}
