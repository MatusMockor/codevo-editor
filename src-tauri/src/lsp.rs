use crate::project::WorkspaceDescriptor;
use crate::tools::{PhpToolAvailability, ToolLocation};
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
                "PHPactor was not found. Install it in vendor/bin or make it available on PATH.",
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
        file_uri, LanguageServerPlanStatus, LanguageServerPlanner, PhpactorLanguageServerPlanner,
    };
    use crate::project::{PhpProjectDescriptor, WorkspaceDescriptor};
    use crate::tools::{PhpToolAvailability, ToolLocation, ToolSource};
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
                has_composer: true,
                package_name: Some("example/app".to_string()),
                psr4_roots: Vec::new(),
            }),
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
