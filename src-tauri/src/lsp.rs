use crate::project::WorkspaceDescriptor;
use crate::tools::{
    JavaScriptTypeScriptToolAvailability, PhpToolAvailability, ToolLocation, ToolSource,
};
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
    Intelephense,
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
    /// Extra environment variables applied to the spawned process (and inherited
    /// by any children it spawns). For managed PHPactor this carries both
    /// `PHPRC=<managed.ini>` and `PHP_INI_SCAN_DIR=<managed-empty-dir>` so every
    /// PHP process in the PHPactor tree boots from the clean managed `php.ini`
    /// and skips noisy user or package scan-dir fragments such as a broken
    /// `imagick.ini`. Without both, child PHP helpers can print startup warnings
    /// onto stdout before their JSON, causing PHPactor to surface "Could not
    /// decode JSON: Warning: PHP Startup...".
    #[serde(default)]
    pub env: Vec<(String, String)>,
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
        settings: &PhpLanguageServerSettings,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PhpBackendPreference {
    Auto,
    Phpactor,
    Intelephense,
}

impl PhpBackendPreference {
    fn from_setting(value: Option<&str>) -> Self {
        match value {
            Some("phpactor") => Self::Phpactor,
            Some("intelephense") => Self::Intelephense,
            _ => Self::Auto,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PhpLanguageServerSettings {
    pub backend: PhpBackendPreference,
    pub intelephense_path: Option<String>,
    pub phpactor_path: Option<String>,
}

impl PhpLanguageServerSettings {
    pub fn from_options(
        backend: Option<&str>,
        phpactor_path: Option<&str>,
        intelephense_path: Option<&str>,
    ) -> Self {
        Self {
            backend: PhpBackendPreference::from_setting(backend),
            intelephense_path: trimmed_non_empty(intelephense_path),
            phpactor_path: trimmed_non_empty(phpactor_path),
        }
    }
}

impl Default for PhpLanguageServerSettings {
    fn default() -> Self {
        Self {
            backend: PhpBackendPreference::Auto,
            intelephense_path: None,
            phpactor_path: None,
        }
    }
}

/// PHP's environment variable for the `php.ini` location. Set to the managed
/// minimal `php.ini` on the PHPactor process so it is inherited by every child
/// PHP process PHPactor spawns (outsourced code actions, diagnostics, php-lint,
/// psalm, phpstan, php-cs-fixer). Those children are launched via `PHP_BINARY`
/// without the parent's `-c <ini>` argument (CLI args are not inherited), so
/// `PHPRC` is needed to avoid the user's main `php.ini`.
const PHP_RUN_CONFIG_ENV: &str = "PHPRC";
/// PHP's additional ini scan directory variable. Pointing it at the managed
/// empty scan directory disables the normal `conf.d` scan for the managed
/// PHPactor process tree, preventing extension fragments such as `imagick.ini`
/// from loading after the clean `PHPRC` main ini.
const PHP_INI_SCAN_DIR_ENV: &str = "PHP_INI_SCAN_DIR";

/// A resolved isolated PHP launcher for the managed PHPactor engine: an explicit
/// `php` interpreter plus a minimal `php.ini` that replaces the user's main
/// `php.ini`. The command env also disables PHP's scan-dir loading so broken or
/// noisy extension fragments (e.g. `imagick.ini`) stay out of the LSP handshake.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PhpLauncher {
    pub php_path: String,
    pub ini_path: String,
    pub ini_scan_dir_path: String,
}

/// Resolves an isolated PHP launcher for the managed PHPactor engine. Failures
/// are surfaced to the planner instead of falling back to a direct PHPactor
/// launch, because direct launch bypasses the managed `codevo-php.ini` and can
/// reintroduce PHP startup noise on the LSP JSON channel.
pub trait PhpInterpreterLauncher {
    fn resolve(&self) -> Result<PhpLauncher, String>;
}

/// Default launcher: resolves a `php` interpreter and ensures the managed minimal
/// `php.ini` exists next to the managed PHPactor install.
pub struct ManagedPhpInterpreterLauncher;

impl PhpInterpreterLauncher for ManagedPhpInterpreterLauncher {
    fn resolve(&self) -> Result<PhpLauncher, String> {
        let php_path = crate::tools::php_executable_path().ok_or_else(|| {
            "Unable to resolve a PHP interpreter for managed PHPactor launch.".to_string()
        })?;
        let ini_path = crate::managed_phpactor::ensure_managed_php_ini()?;
        let ini_scan_dir_path = crate::managed_phpactor::ensure_managed_php_ini_scan_dir()?;

        Ok(PhpLauncher {
            php_path,
            ini_path: ini_path.to_string_lossy().to_string(),
            ini_scan_dir_path: ini_scan_dir_path.to_string_lossy().to_string(),
        })
    }
}

pub struct PhpactorLanguageServerPlanner<
    TFactory = PhpactorInitializeRequestFactory,
    TLauncher = ManagedPhpInterpreterLauncher,
> {
    initialize_request_factory: TFactory,
    php_interpreter_launcher: TLauncher,
}

impl PhpactorLanguageServerPlanner {
    pub fn new() -> Self {
        Self {
            initialize_request_factory: PhpactorInitializeRequestFactory,
            php_interpreter_launcher: ManagedPhpInterpreterLauncher,
        }
    }
}

impl<TFactory, TLauncher> PhpactorLanguageServerPlanner<TFactory, TLauncher>
where
    TFactory: InitializeRequestFactory,
    TLauncher: PhpInterpreterLauncher,
{
    #[cfg(test)]
    fn with_launcher(
        initialize_request_factory: TFactory,
        php_interpreter_launcher: TLauncher,
    ) -> Self {
        Self {
            initialize_request_factory,
            php_interpreter_launcher,
        }
    }

    fn ready_plan(&self, root: &Path, phpactor: &ToolLocation) -> LanguageServerPlan {
        let command = match self.phpactor_command(root, phpactor) {
            Ok(command) => command,
            Err(error) => {
                return unavailable_plan(&format!(
                    "Managed PHP IDE engine cannot start with isolated PHP configuration: {error}"
                ));
            }
        };

        LanguageServerPlan {
            provider: LanguageServerProvider::Phpactor,
            status: LanguageServerPlanStatus::Ready,
            message: "PHPactor LSP is ready to start.".to_string(),
            command: Some(command),
            initialize_request: Some(self.initialize_request_factory.create(root)),
        }
    }

    /// Builds the PHPactor launch command. When an isolated PHP interpreter is
    /// available we launch `php -n -c <managed.ini> <phpactor> language-server`
    /// so a broken user/global `php.ini` (imagick warning on stdout) cannot
    /// corrupt the LSP handshake.
    fn phpactor_command(
        &self,
        root: &Path,
        phpactor: &ToolLocation,
    ) -> Result<LanguageServerCommand, String> {
        let working_directory = root.to_string_lossy().to_string();
        let launcher = self.php_interpreter_launcher.resolve()?;

        // `-n -c <managed.ini>` makes the parent PHPactor process ignore every
        // user/global startup ini and load only the managed file. `PHPRC` and
        // `PHP_INI_SCAN_DIR` are still required for PHPactor's helper PHP
        // processes, which are spawned via `PHP_BINARY` without inheriting the
        // parent's CLI flags.
        let php_env = vec![
            (PHP_RUN_CONFIG_ENV.to_string(), launcher.ini_path.clone()),
            (
                PHP_INI_SCAN_DIR_ENV.to_string(),
                launcher.ini_scan_dir_path.clone(),
            ),
        ];

        Ok(LanguageServerCommand {
            executable: launcher.php_path,
            args: vec![
                "-n".to_string(),
                "-c".to_string(),
                launcher.ini_path,
                phpactor.path.clone(),
                "language-server".to_string(),
            ],
            working_directory,
            env: php_env,
        })
    }
}

impl<TFactory, TLauncher> LanguageServerPlanner
    for PhpactorLanguageServerPlanner<TFactory, TLauncher>
where
    TFactory: InitializeRequestFactory,
    TLauncher: PhpInterpreterLauncher,
{
    fn plan(
        &self,
        root: &Path,
        trusted: bool,
        descriptor: &WorkspaceDescriptor,
        tools: &PhpToolAvailability,
        settings: &PhpLanguageServerSettings,
    ) -> LanguageServerPlan {
        if !trusted {
            return blocked_plan("Trust this workspace to enable PHPactor LSP.");
        }

        if descriptor.php.is_none() {
            return unavailable_plan("This workspace is not a PHP Composer project.");
        }

        if matches!(settings.backend, PhpBackendPreference::Intelephense) {
            let message = if settings.intelephense_path.is_some() {
                "Configured Intelephense path was received, but Intelephense language server support is not available yet. Choose the managed PHP engine to use PHPactor."
            } else {
                "Intelephense language server support is not available yet. Choose the managed PHP engine to use PHPactor."
            };

            return unavailable_intelephense_plan(message);
        }

        let configured_phpactor = settings
            .phpactor_path
            .as_ref()
            .and_then(|path| configured_phpactor_location(path));

        let Some(phpactor) = configured_phpactor.as_ref().or(tools.phpactor.as_ref()) else {
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
                // Phpactor reads `initializationOptions` as a flat map of dotted
                // config keys. Run diagnostics in-process so we avoid the per-run
                // `php` subprocess that fails in the Tauri GUI environment (reduced
                // PATH / missing env) and therefore never publishes diagnostics, and
                // shorten the diagnostics grace window to reduce the publish race.
                "initializationOptions": {
                    "language_server.diagnostic_outsource": false,
                    // Run code actions in-process for the same reason as
                    // diagnostics: avoid extra helper PHP processes in the reduced
                    // Tauri GUI environment and keep smart features inside the
                    // already-clean managed-PHP parent.
                    "language_server.code_action_outsource": false,
                    "language_server.diagnostic_sleep_time": 150,
                    // Keep the Laravel Idea (PhpStorm plugin) IDE-helper stubs out
                    // of the index. They re-declare real `App\Models\*` classes as
                    // empty stubs in `vendor/_laravel_idea/`, so worse-reflection
                    // resolves the FQN to the stub instead of the real model:
                    // Cmd+Click lands on the stub and `Model::CONST` triggers a
                    // false-positive `worse.missing_member`. Excluding the stub
                    // paths removes the duplicate empty declaration from the index
                    // so both navigation and reflection resolve the real model.
                    //
                    // Patterns are root-relative globs (phpactor prepends the
                    // project root) and PHPactor merges this array over its own
                    // defaults wholesale, so the upstream defaults are repeated
                    // here. We exclude ONLY the stub paths, never the whole
                    // `vendor/` tree, so reflection of real dependencies still
                    // works.
                    "indexer.exclude_patterns": [
                        "/vendor/**/Tests/**/*",
                        "/vendor/**/tests/**/*",
                        "/vendor/composer/**/*",
                        "/vendor/rector/rector/stubs-rector",
                        "/vendor/_laravel_idea/**/*",
                        "/_ide_helper*.php",
                    ],
                },
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
    pub automatic_type_acquisition: bool,
    pub code_lens: bool,
    pub import_module_specifier_preference: TypeScriptImportModuleSpecifierPreference,
    pub inlay_hints: bool,
    pub prefer_type_only_auto_imports: bool,
    pub quote_preference: TypeScriptQuotePreference,
    pub validation: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TypeScriptImportModuleSpecifierPreference {
    Shortest,
    Relative,
    NonRelative,
    ProjectRelative,
}

impl TypeScriptImportModuleSpecifierPreference {
    pub fn from_setting(value: Option<&str>) -> Self {
        match value {
            Some("relative") => Self::Relative,
            Some("non-relative") => Self::NonRelative,
            Some("project-relative") => Self::ProjectRelative,
            _ => Self::Shortest,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Shortest => "shortest",
            Self::Relative => "relative",
            Self::NonRelative => "non-relative",
            Self::ProjectRelative => "project-relative",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TypeScriptQuotePreference {
    Auto,
    Single,
    Double,
}

impl TypeScriptQuotePreference {
    pub fn from_setting(value: Option<&str>) -> Self {
        match value {
            Some("single") => Self::Single,
            Some("double") => Self::Double,
            _ => Self::Auto,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Single => "single",
            Self::Double => "double",
        }
    }
}

impl Default for TypeScriptLanguageServerSettings {
    fn default() -> Self {
        Self {
            auto_imports: true,
            automatic_type_acquisition: false,
            code_lens: false,
            import_module_specifier_preference: TypeScriptImportModuleSpecifierPreference::Shortest,
            inlay_hints: true,
            prefer_type_only_auto_imports: false,
            quote_preference: TypeScriptQuotePreference::Auto,
            validation: true,
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
        vue_typescript_plugin: Option<&ToolLocation>,
        settings: TypeScriptLanguageServerSettings,
    ) -> LanguageServerPlan {
        let mut initialize_request = self.initialize_request_factory.create(root);

        if let Some(typescript_server) = typescript_server {
            configure_typescript_server_path(&mut initialize_request, &typescript_server.path);
        }
        if let Some(vue_typescript_plugin) = vue_typescript_plugin {
            configure_vue_typescript_plugin(&mut initialize_request, &vue_typescript_plugin.path);
        }
        configure_typescript_auto_imports(&mut initialize_request, settings.auto_imports);
        configure_typescript_automatic_type_acquisition(
            &mut initialize_request,
            settings.automatic_type_acquisition,
        );
        configure_typescript_code_lens(&mut initialize_request, settings.code_lens);
        configure_typescript_inlay_hints(&mut initialize_request, settings.inlay_hints);
        configure_typescript_import_preferences(&mut initialize_request, settings);
        configure_typescript_validation(&mut initialize_request, settings.validation);

        LanguageServerPlan {
            provider: LanguageServerProvider::TypeScriptLanguageServer,
            status: LanguageServerPlanStatus::Ready,
            message: "TypeScript language server is ready to start.".to_string(),
            command: Some(LanguageServerCommand {
                executable: server.path.clone(),
                args: vec!["--stdio".to_string()],
                working_directory: root.to_string_lossy().to_string(),
                env: Vec::new(),
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
        let Some(server) = tools.typescript_language_server.as_ref() else {
            return unavailable_javascript_typescript_plan(
                "Managed TypeScript language server was not found.",
            );
        };

        self.ready_plan(
            root,
            server,
            tools.typescript_server.as_ref(),
            tools.vue_typescript_plugin.as_ref(),
            settings,
        )
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

    let tsserver = initialization_options
        .entry("tsserver")
        .or_insert_with(|| json!({}));
    let Some(tsserver) = tsserver.as_object_mut() else {
        return;
    };

    tsserver.insert("path".to_string(), Value::String(path.to_string()));
}

/// Registers `@vue/typescript-plugin` with the existing tsserver so `.vue`
/// `<script>` blocks gain TypeScript intelligence without spawning a separate
/// Volar process. The `languages: ["vue"]` entry tells the language server to
/// accept `.vue` documents (a language id it does not handle by default). When
/// no plugin location is available this is never called, so `.vue` files keep
/// highlighting only.
fn configure_vue_typescript_plugin(request: &mut JsonRpcRequest, location: &str) {
    let Some(params) = request.params.as_object_mut() else {
        return;
    };
    let initialization_options = params
        .entry("initializationOptions")
        .or_insert_with(|| json!({}));
    let Some(initialization_options) = initialization_options.as_object_mut() else {
        return;
    };

    let plugins = initialization_options
        .entry("plugins")
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(plugins) = plugins.as_array_mut() else {
        return;
    };

    plugins.push(json!({
        "name": "@vue/typescript-plugin",
        "location": location,
        "languages": ["vue"],
    }));
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

fn configure_typescript_import_preferences(
    request: &mut JsonRpcRequest,
    settings: TypeScriptLanguageServerSettings,
) {
    let Some(preferences) = typescript_preferences_mut(request) else {
        return;
    };

    preferences.insert(
        "importModuleSpecifierPreference".to_string(),
        Value::String(
            settings
                .import_module_specifier_preference
                .as_str()
                .to_string(),
        ),
    );
    preferences.insert(
        "preferTypeOnlyAutoImports".to_string(),
        Value::Bool(settings.prefer_type_only_auto_imports),
    );
    preferences.insert(
        "quotePreference".to_string(),
        Value::String(settings.quote_preference.as_str().to_string()),
    );
}

fn configure_typescript_automatic_type_acquisition(request: &mut JsonRpcRequest, enabled: bool) {
    let Some(params) = request.params.as_object_mut() else {
        return;
    };
    let initialization_options = params
        .entry("initializationOptions")
        .or_insert_with(|| json!({}));
    let Some(initialization_options) = initialization_options.as_object_mut() else {
        return;
    };

    let tsserver = initialization_options
        .entry("tsserver")
        .or_insert_with(|| json!({}));
    let Some(tsserver) = tsserver.as_object_mut() else {
        return;
    };

    tsserver.insert(
        "disableAutomaticTypingAcquisition".to_string(),
        Value::Bool(!enabled),
    );
}

fn configure_typescript_code_lens(request: &mut JsonRpcRequest, enabled: bool) {
    let Some(preferences) = typescript_preferences_mut(request) else {
        return;
    };

    preferences.insert("mockorCodeLensEnabled".to_string(), Value::Bool(enabled));
}

fn configure_typescript_validation(request: &mut JsonRpcRequest, enabled: bool) {
    let Some(preferences) = typescript_preferences_mut(request) else {
        return;
    };

    preferences.insert("mockorValidationEnabled".to_string(), Value::Bool(enabled));
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

        let mut request = JsonRpcRequest {
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
                                "insertTextModeSupport": {
                                    "valueSet": [1, 2]
                                },
                                "labelDetailsSupport": true,
                                "preselectSupport": true,
                                "snippetSupport": true,
                                "tagSupport": {
                                    "valueSet": [1]
                                },
                                "resolveSupport": {
                                    "properties": ["documentation", "detail", "additionalTextEdits", "labelDetails", "command"]
                                }
                            },
                            "contextSupport": true,
                            "dynamicRegistration": false
                        },
                        "signatureHelp": {
                            "contextSupport": true
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
                                        "refactor.move",
                                        "refactor.rewrite",
                                        "source",
                                        "source.fixAll",
                                        "source.fixAll.ts",
                                        "source.addMissingImports.ts",
                                        "source.organizeImports",
                                        "source.organizeImports.ts",
                                        "source.removeUnused.ts",
                                        "source.removeUnusedImports.ts",
                                        "source.sortImports.ts"
                                    ]
                                }
                            },
                            "disabledSupport": true,
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
                        "inlayHint": {
                            "dynamicRegistration": false,
                            "resolveSupport": {
                                "properties": [
                                    "tooltip",
                                    "label.tooltip",
                                    "label.location",
                                    "textEdits",
                                    "label.command"
                                ]
                            }
                        },
                        "linkedEditingRange": { "dynamicRegistration": false },
                        "onTypeFormatting": { "dynamicRegistration": false },
                        "rangeFormatting": { "dynamicRegistration": false },
                        "publishDiagnostics": {
                            "codeDescriptionSupport": true,
                            "dataSupport": true,
                            "relatedInformation": true,
                            "tagSupport": {
                                "valueSet": [1, 2]
                            },
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
                                "range": true
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
                        "didChangeWatchedFiles": {
                            "dynamicRegistration": false,
                            "relativePatternSupport": true
                        },
                        "inlayHint": { "refreshSupport": true },
                        "semanticTokens": { "refreshSupport": true },
                        "symbol": { "dynamicRegistration": false },
                        "workspaceEdit": {
                            "documentChanges": true,
                            "resourceOperations": ["create", "rename", "delete"]
                        },
                        "fileOperations": {
                            "didCreate": true,
                            "didDelete": true,
                            "didRename": true,
                            "dynamicRegistration": false,
                            "willCreate": true,
                            "willDelete": true,
                            "willRename": true
                        },
                        "workspaceFolders": true
                    }
                },
                "initializationOptions": {
                    "hostInfo": "Mockor Editor",
                    "supportsMoveToFileCodeAction": true,
                    "tsserver": {
                        "useClientFileWatcher": true,
                        "disableAutomaticTypingAcquisition": true
                    },
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
        };

        request.params["capabilities"]["textDocument"]["callHierarchy"] = json!({
            "dynamicRegistration": false,
        });
        request.params["capabilities"]["textDocument"]["declaration"] = json!({
            "dynamicRegistration": false,
            "linkSupport": true,
        });

        request
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

fn unavailable_intelephense_plan(message: &str) -> LanguageServerPlan {
    LanguageServerPlan {
        provider: LanguageServerProvider::Intelephense,
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

fn trimmed_non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn configured_phpactor_location(path: &str) -> Option<ToolLocation> {
    let configured_path = Path::new(path);

    if !is_launchable_file(configured_path) {
        return None;
    }

    Some(ToolLocation {
        executable: configured_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("phpactor")
            .to_string(),
        path: path.to_string(),
        source: ToolSource::Path,
    })
}

fn is_launchable_file(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };

    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        metadata.permissions().mode() & 0o111 != 0
    }

    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{
        file_uri, InitializeRequestFactory, JavaScriptTypeScriptLanguageServerPlanner,
        LanguageServerPlanStatus, LanguageServerPlanner, LanguageServerProvider,
        PhpBackendPreference, PhpInterpreterLauncher, PhpLanguageServerSettings, PhpLauncher,
        PhpactorInitializeRequestFactory, PhpactorLanguageServerPlanner,
        TypeScriptImportModuleSpecifierPreference, TypeScriptLanguageServerPlanner,
        TypeScriptLanguageServerSettings, TypeScriptQuotePreference,
    };
    use crate::project::{PhpProjectDescriptor, WorkspaceDescriptor};
    use crate::tools::{
        JavaScriptTypeScriptToolAvailability, PhpToolAvailability, ToolLocation, ToolSource,
    };
    use serde_json::{json, Value};
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
            &PhpLanguageServerSettings::default(),
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Blocked));
        assert!(plan.command.is_none());
        assert!(plan.initialize_request.is_none());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn trusted_php_workspace_builds_phpactor_initialize_plan() {
        let root = create_temp_dir("lsp-ready");
        let planner = planner_with_php(
            "/usr/bin/php",
            "/managed/codevo-php.ini",
            "/managed/empty-php-conf.d",
        );
        let plan = planner.plan(
            &root,
            true,
            &php_descriptor(&root),
            &tools_with_phpactor(&root),
            &PhpLanguageServerSettings::default(),
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Ready));
        let command = plan.command.expect("language server command");
        assert_eq!(command.executable, "/usr/bin/php");
        assert_eq!(
            command.args.last().map(String::as_str),
            Some("language-server")
        );
        assert!(command
            .args
            .iter()
            .any(|arg| arg.ends_with("vendor/bin/phpactor")));

        let request = plan.initialize_request.expect("initialize request");
        assert_eq!(request.method, "initialize");
        assert_eq!(request.params["rootUri"], file_uri(&root));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn phpactor_initialize_request_disables_outsourced_diagnostics() {
        let root = create_temp_dir("lsp-phpactor-diagnostics");
        let request = PhpactorInitializeRequestFactory.create(&root);

        // Existing initialize fields must be preserved.
        assert_eq!(request.method, "initialize");
        assert_eq!(request.params["rootUri"], file_uri(&root));
        assert_eq!(request.params["processId"], Value::Null);
        assert!(request.params["capabilities"].is_object());
        assert!(request.params["workspaceFolders"].is_array());

        // In-process diagnostics avoid the per-run `php` subprocess that fails in
        // the Tauri GUI environment, and a shorter sleep time shrinks the
        // diagnostics grace-period race window.
        assert_eq!(
            request.params["initializationOptions"]["language_server.diagnostic_outsource"],
            Value::Bool(false)
        );
        // Code actions must also run in-process so smart features avoid extra
        // helper PHP processes in the reduced Tauri GUI environment.
        assert_eq!(
            request.params["initializationOptions"]["language_server.code_action_outsource"],
            Value::Bool(false)
        );
        assert_eq!(
            request.params["initializationOptions"]["language_server.diagnostic_sleep_time"],
            json!(150)
        );

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn phpactor_initialize_request_excludes_laravel_idea_stubs_from_index() {
        let root = create_temp_dir("lsp-phpactor-exclude-stubs");
        let request = PhpactorInitializeRequestFactory.create(&root);

        // The diagnostics and code-action options must survive alongside the new
        // indexer config.
        assert_eq!(
            request.params["initializationOptions"]["language_server.diagnostic_outsource"],
            Value::Bool(false)
        );
        assert_eq!(
            request.params["initializationOptions"]["language_server.code_action_outsource"],
            Value::Bool(false)
        );
        assert_eq!(
            request.params["initializationOptions"]["language_server.diagnostic_sleep_time"],
            json!(150)
        );

        let exclude_patterns = request.params["initializationOptions"]["indexer.exclude_patterns"]
            .as_array()
            .expect("indexer.exclude_patterns must be an array");
        let patterns: Vec<&str> = exclude_patterns
            .iter()
            .map(|value| value.as_str().expect("pattern must be a string"))
            .collect();

        // PHPactor merges this array over its defaults wholesale (top-level
        // array_merge keyed by the dotted config key), so we must re-declare the
        // upstream defaults or we would silently drop them.
        assert!(
            patterns.contains(&"/vendor/**/Tests/**/*"),
            "must preserve phpactor default exclude: /vendor/**/Tests/**/*"
        );
        assert!(
            patterns.contains(&"/vendor/**/tests/**/*"),
            "must preserve phpactor default exclude: /vendor/**/tests/**/*"
        );
        assert!(
            patterns.contains(&"/vendor/composer/**/*"),
            "must preserve phpactor default exclude: /vendor/composer/**/*"
        );
        assert!(
            patterns.contains(&"/vendor/rector/rector/stubs-rector"),
            "must preserve phpactor default exclude: /vendor/rector/rector/stubs-rector"
        );

        // Laravel Idea (PhpStorm plugin) IDE-helper stubs re-declare real
        // App\Models classes as empty stubs, which corrupts navigation and
        // member reflection. Exclude only those stub paths from the index.
        assert!(
            patterns.contains(&"/vendor/_laravel_idea/**/*"),
            "must exclude Laravel Idea stub directory from the index"
        );
        assert!(
            patterns.contains(&"/_ide_helper*.php"),
            "must exclude generated _ide_helper stub files from the index"
        );

        // The whole vendor/ tree must stay indexed so reflection of real
        // dependencies keeps working.
        assert!(
            !patterns.contains(&"/vendor/**/*"),
            "must NOT exclude the entire vendor/ tree"
        );

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
            &PhpLanguageServerSettings::default(),
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Unavailable));
        assert!(plan.command.is_none());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn configured_phpactor_path_wins_over_detected_phpactor() {
        let root = create_temp_dir("lsp-configured-phpactor");
        let configured_phpactor_path = root.join("custom-tools").join("phpactor");
        fs::create_dir_all(configured_phpactor_path.parent().expect("custom tools dir"))
            .expect("create custom tools dir");
        fs::write(&configured_phpactor_path, "").expect("write configured phpactor");
        make_executable(&configured_phpactor_path);
        let configured_phpactor = configured_phpactor_path.to_string_lossy().to_string();
        let planner = planner_with_php(
            "/usr/bin/php",
            "/managed/codevo-php.ini",
            "/managed/empty-php-conf.d",
        );
        let plan = planner.plan(
            &root,
            true,
            &php_descriptor(&root),
            &tools_with_phpactor(&root),
            &PhpLanguageServerSettings {
                backend: PhpBackendPreference::Auto,
                intelephense_path: None,
                phpactor_path: Some(configured_phpactor.clone()),
            },
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Ready));
        let command = plan.command.expect("language server command");
        assert_eq!(command.executable, "/usr/bin/php");
        assert!(command.args.contains(&configured_phpactor));
        assert_eq!(
            command.args.last().map(String::as_str),
            Some("language-server")
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn missing_configured_phpactor_path_falls_back_to_detected_phpactor() {
        let root = create_temp_dir("lsp-missing-configured-phpactor");
        let planner = planner_with_php(
            "/usr/bin/php",
            "/managed/codevo-php.ini",
            "/managed/empty-php-conf.d",
        );
        let plan = planner.plan(
            &root,
            true,
            &php_descriptor(&root),
            &tools_with_phpactor(&root),
            &PhpLanguageServerSettings {
                backend: PhpBackendPreference::Auto,
                intelephense_path: None,
                phpactor_path: Some(
                    root.join("missing")
                        .join("phpactor")
                        .to_string_lossy()
                        .to_string(),
                ),
            },
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Ready));
        let command = plan.command.expect("language server command");
        let detected_phpactor = root
            .join("vendor")
            .join("bin")
            .join("phpactor")
            .to_string_lossy()
            .to_string();
        assert_eq!(command.executable, "/usr/bin/php");
        assert!(command.args.contains(&detected_phpactor));
        assert_eq!(
            command.args.last().map(String::as_str),
            Some("language-server")
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn phpactor_plan_is_unavailable_when_isolated_php_launcher_is_unavailable() {
        let root = create_temp_dir("lsp-php-launcher-unavailable");
        let planner = planner_without_php();

        let plan = planner.plan(
            &root,
            true,
            &php_descriptor(&root),
            &tools_with_phpactor(&root),
            &PhpLanguageServerSettings::default(),
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Unavailable));
        assert!(plan.command.is_none());
        assert!(plan.initialize_request.is_none());
        assert!(plan.message.contains("isolated PHP configuration"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn phpactor_plan_does_not_fall_back_to_direct_launch_without_managed_ini() {
        let root = create_temp_dir("lsp-php-launcher-no-direct-fallback");
        let planner = planner_without_php();

        let plan = planner.plan(
            &root,
            true,
            &php_descriptor(&root),
            &tools_with_phpactor(&root),
            &PhpLanguageServerSettings::default(),
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Unavailable));
        assert!(
            plan.command.is_none(),
            "must not launch vendor/bin/phpactor directly"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn intelephense_backend_does_not_start_phpactor() {
        let root = create_temp_dir("lsp-intelephense-backend");
        let planner = PhpactorLanguageServerPlanner::new();
        let plan = planner.plan(
            &root,
            true,
            &php_descriptor(&root),
            &tools_with_phpactor(&root),
            &PhpLanguageServerSettings {
                backend: PhpBackendPreference::Intelephense,
                intelephense_path: Some("/tools/intelephense".to_string()),
                phpactor_path: Some("/tools/phpactor".to_string()),
            },
        );

        assert!(matches!(
            plan.provider,
            LanguageServerProvider::Intelephense
        ));
        assert!(matches!(plan.status, LanguageServerPlanStatus::Unavailable));
        assert!(plan.command.is_none());
        assert!(plan.initialize_request.is_none());
        assert!(plan.message.contains("not available yet"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn phpactor_backend_ignores_intelephense_tools() {
        let root = create_temp_dir("lsp-phpactor-backend");
        let planner = PhpactorLanguageServerPlanner::new();
        let plan = planner.plan(
            &root,
            true,
            &php_descriptor(&root),
            &PhpToolAvailability {
                phpactor: None,
                intelephense: Some(ToolLocation {
                    executable: "intelephense".to_string(),
                    path: "/tools/intelephense".to_string(),
                    source: ToolSource::Path,
                }),
            },
            &PhpLanguageServerSettings {
                backend: PhpBackendPreference::Phpactor,
                intelephense_path: Some("/tools/intelephense".to_string()),
                phpactor_path: None,
            },
        );

        assert!(matches!(plan.provider, LanguageServerProvider::Phpactor));
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
            request.params["initializationOptions"]["tsserver"]["useClientFileWatcher"],
            true
        );
        assert_eq!(
            request.params["initializationOptions"]["tsserver"]
                ["disableAutomaticTypingAcquisition"],
            true
        );
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
            request.params["capabilities"]["textDocument"]["codeAction"]["disabledSupport"],
            true
        );
        let code_action_kinds = request.params["capabilities"]["textDocument"]["codeAction"]
            ["codeActionLiteralSupport"]["codeActionKind"]["valueSet"]
            .as_array()
            .expect("code action kind value set");
        for kind in [
            "refactor.move",
            "source.addMissingImports.ts",
            "source.fixAll.ts",
            "source.organizeImports.ts",
            "source.removeUnused.ts",
            "source.removeUnusedImports.ts",
            "source.sortImports.ts",
        ] {
            assert!(code_action_kinds.contains(&json!(kind)));
        }
        assert_eq!(
            request.params["capabilities"]["textDocument"]["publishDiagnostics"]["tagSupport"]
                ["valueSet"],
            json!([1, 2])
        );
        assert_eq!(
            request.params["initializationOptions"]["supportsMoveToFileCodeAction"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["publishDiagnostics"]
                ["codeDescriptionSupport"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["publishDiagnostics"]["dataSupport"],
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
                ["insertTextModeSupport"]["valueSet"],
            json!([1, 2])
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["completion"]["completionItem"]
                ["commitCharactersSupport"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["completion"]["completionItem"]
                ["tagSupport"]["valueSet"],
            json!([1])
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["completion"]["completionItem"]
                ["resolveSupport"]["properties"],
            json!([
                "documentation",
                "detail",
                "additionalTextEdits",
                "labelDetails",
                "command"
            ])
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["signatureHelp"]["contextSupport"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["callHierarchy"]["dynamicRegistration"],
            false
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["declaration"]["dynamicRegistration"],
            false
        );
        assert_eq!(
            request.params["capabilities"]["textDocument"]["declaration"]["linkSupport"],
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
            request.params["capabilities"]["textDocument"]["inlayHint"]["resolveSupport"]
                ["properties"],
            json!([
                "tooltip",
                "label.tooltip",
                "label.location",
                "textEdits",
                "label.command"
            ])
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
            request.params["capabilities"]["textDocument"]["onTypeFormatting"]
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
            request.params["capabilities"]["textDocument"]["semanticTokens"]["requests"]["range"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["codeLens"]["refreshSupport"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["inlayHint"]["refreshSupport"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["semanticTokens"]["refreshSupport"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["workspaceEdit"]["resourceOperations"],
            json!(["create", "rename", "delete"])
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["didChangeWatchedFiles"]
                ["dynamicRegistration"],
            false
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["didChangeWatchedFiles"]
                ["relativePatternSupport"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["fileOperations"]["willCreate"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["fileOperations"]["didCreate"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["fileOperations"]["willRename"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["fileOperations"]["didRename"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["fileOperations"]["willDelete"],
            true
        );
        assert_eq!(
            request.params["capabilities"]["workspace"]["fileOperations"]["didDelete"],
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
                automatic_type_acquisition: true,
                code_lens: true,
                import_module_specifier_preference:
                    TypeScriptImportModuleSpecifierPreference::Relative,
                inlay_hints: false,
                prefer_type_only_auto_imports: true,
                quote_preference: TypeScriptQuotePreference::Single,
                validation: false,
            },
        );

        let request = plan.initialize_request.expect("initialize request");
        assert_eq!(
            request.params["initializationOptions"]["tsserver"]
                ["disableAutomaticTypingAcquisition"],
            false
        );
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
        assert_eq!(
            request.params["initializationOptions"]["preferences"]["mockorValidationEnabled"],
            false
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]
                ["importModuleSpecifierPreference"],
            "relative"
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]["preferTypeOnlyAutoImports"],
            true
        );
        assert_eq!(
            request.params["initializationOptions"]["preferences"]["quotePreference"],
            "single"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn javascript_typescript_plan_registers_vue_typescript_plugin_when_available() {
        let root = create_temp_dir("lsp-typescript-vue-plugin");
        fs::write(root.join("package.json"), "{}").expect("write package.json");
        let plugin_location = root
            .join("node_modules")
            .join("@vue")
            .join("typescript-plugin")
            .to_string_lossy()
            .to_string();
        let planner = TypeScriptLanguageServerPlanner::new();
        let plan = planner.plan(
            &root,
            &tools_with_vue_typescript_plugin(&root, &plugin_location),
            TypeScriptLanguageServerSettings::default(),
        );

        let request = plan.initialize_request.expect("initialize request");
        let plugins = request.params["initializationOptions"]["plugins"]
            .as_array()
            .expect("plugins array");
        let vue_plugin = plugins
            .iter()
            .find(|plugin| plugin["name"] == "@vue/typescript-plugin")
            .expect("vue plugin entry");
        assert_eq!(vue_plugin["location"], plugin_location);
        assert_eq!(vue_plugin["languages"], json!(["vue"]));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn javascript_typescript_plan_omits_plugins_when_vue_plugin_missing() {
        let root = create_temp_dir("lsp-typescript-without-vue-plugin");
        fs::write(root.join("package.json"), "{}").expect("write package.json");
        let planner = TypeScriptLanguageServerPlanner::new();
        let plan = planner.plan(
            &root,
            &tools_with_typescript_language_server(&root),
            TypeScriptLanguageServerSettings::default(),
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Ready));
        let request = plan.initialize_request.expect("initialize request");
        assert!(request.params["initializationOptions"]["plugins"].is_null());
        // The JS/TS server itself must still be configured normally.
        assert!(request.params["initializationOptions"]["tsserver"]["path"]
            .as_str()
            .expect("tsserver path")
            .ends_with("node_modules/typescript/lib/tsserver.js"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn plain_workspace_gets_typescript_inferred_project_plan() {
        let root = create_temp_dir("lsp-typescript-inferred-project");
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
        assert!(plan.command.is_some());
        assert!(plan.initialize_request.is_some());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn file_uri_encodes_spaces() {
        assert_eq!(
            file_uri(Path::new("/tmp/project with spaces")),
            "file:///tmp/project%20with%20spaces"
        );
    }

    struct StubPhpLauncher {
        launcher: Option<PhpLauncher>,
    }

    impl PhpInterpreterLauncher for StubPhpLauncher {
        fn resolve(&self) -> Result<PhpLauncher, String> {
            self.launcher
                .clone()
                .ok_or_else(|| "test PHP launcher unavailable".to_string())
        }
    }

    fn planner_with_php(
        php_path: &str,
        ini_path: &str,
        ini_scan_dir_path: &str,
    ) -> PhpactorLanguageServerPlanner<PhpactorInitializeRequestFactory, StubPhpLauncher> {
        PhpactorLanguageServerPlanner::with_launcher(
            PhpactorInitializeRequestFactory,
            StubPhpLauncher {
                launcher: Some(PhpLauncher {
                    php_path: php_path.to_string(),
                    ini_path: ini_path.to_string(),
                    ini_scan_dir_path: ini_scan_dir_path.to_string(),
                }),
            },
        )
    }

    fn planner_without_php(
    ) -> PhpactorLanguageServerPlanner<PhpactorInitializeRequestFactory, StubPhpLauncher> {
        PhpactorLanguageServerPlanner::with_launcher(
            PhpactorInitializeRequestFactory,
            StubPhpLauncher { launcher: None },
        )
    }

    #[test]
    fn phpactor_launches_through_isolated_php_interpreter_when_available() {
        let root = create_temp_dir("lsp-php-launcher");
        let planner = planner_with_php(
            "/usr/bin/php",
            "/managed/codevo-php.ini",
            "/managed/empty-php-conf.d",
        );

        let plan = planner.plan(
            &root,
            true,
            &php_descriptor(&root),
            &tools_with_phpactor(&root),
            &PhpLanguageServerSettings::default(),
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Ready));
        let command = plan.command.expect("language server command");
        let phpactor_path = root
            .join("vendor")
            .join("bin")
            .join("phpactor")
            .to_string_lossy()
            .to_string();
        assert_eq!(command.executable, "/usr/bin/php");
        assert_eq!(
            command.args,
            vec![
                "-n".to_string(),
                "-c".to_string(),
                "/managed/codevo-php.ini".to_string(),
                phpactor_path,
                "language-server".to_string(),
            ]
        );
        // PHPRC must carry the managed ini and PHP_INI_SCAN_DIR must point at the
        // managed empty scan dir so PHPactor's outsourced child PHP processes
        // inherit the clean, imagick-free configuration. Unlike `-c`, env vars
        // propagate to children.
        assert_eq!(
            command.env,
            vec![
                ("PHPRC".to_string(), "/managed/codevo-php.ini".to_string()),
                (
                    "PHP_INI_SCAN_DIR".to_string(),
                    "/managed/empty-php-conf.d".to_string()
                ),
            ]
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn phpactor_isolated_launcher_disables_php_ini_scan_dir_for_child_helpers() {
        let root = create_temp_dir("lsp-php-launcher-scan-dir");
        let planner = planner_with_php(
            "/usr/bin/php",
            "/managed/codevo-php.ini",
            "/managed/empty-php-conf.d",
        );

        let plan = planner.plan(
            &root,
            true,
            &php_descriptor(&root),
            &tools_with_phpactor(&root),
            &PhpLanguageServerSettings::default(),
        );

        let command = plan.command.expect("language server command");
        assert!(
            command
                .env
                .contains(&("PHPRC".to_string(), "/managed/codevo-php.ini".to_string())),
            "PHPRC isolates the main php.ini for parent and child PHP processes"
        );
        assert!(
            command.env.contains(&(
                "PHP_INI_SCAN_DIR".to_string(),
                "/managed/empty-php-conf.d".to_string()
            )),
            "managed empty PHP_INI_SCAN_DIR disables user/package conf.d fragments like imagick.ini"
        );

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn configured_phpactor_launches_through_isolated_php_interpreter() {
        let root = create_temp_dir("lsp-php-launcher-configured");
        let configured_phpactor_path = root.join("custom-tools").join("phpactor");
        fs::create_dir_all(configured_phpactor_path.parent().expect("custom tools dir"))
            .expect("create custom tools dir");
        fs::write(&configured_phpactor_path, "").expect("write configured phpactor");
        make_executable(&configured_phpactor_path);
        let configured_phpactor = configured_phpactor_path.to_string_lossy().to_string();
        let planner = planner_with_php(
            "/usr/bin/php",
            "/managed/codevo-php.ini",
            "/managed/empty-php-conf.d",
        );

        let plan = planner.plan(
            &root,
            true,
            &php_descriptor(&root),
            &tools_with_phpactor(&root),
            &PhpLanguageServerSettings {
                backend: PhpBackendPreference::Auto,
                intelephense_path: None,
                phpactor_path: Some(configured_phpactor.clone()),
            },
        );

        assert!(matches!(plan.status, LanguageServerPlanStatus::Ready));
        let command = plan.command.expect("language server command");
        assert_eq!(command.executable, "/usr/bin/php");
        assert_eq!(
            command.args,
            vec![
                "-n".to_string(),
                "-c".to_string(),
                "/managed/codevo-php.ini".to_string(),
                configured_phpactor,
                "language-server".to_string(),
            ]
        );
        fs::remove_dir_all(root).expect("cleanup");
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
            vue_typescript_plugin: None,
        }
    }

    fn tools_with_vue_typescript_plugin(
        root: &Path,
        plugin_location: &str,
    ) -> JavaScriptTypeScriptToolAvailability {
        let mut tools = tools_with_typescript_language_server(root);
        tools.vue_typescript_plugin = Some(ToolLocation {
            executable: "typescript-plugin".to_string(),
            path: plugin_location.to_string(),
            source: ToolSource::WorkspaceNodeModulesBin,
        });
        tools
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

    #[cfg(unix)]
    fn make_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("set executable permissions");
    }

    #[cfg(not(unix))]
    fn make_executable(_path: &Path) {}
}
