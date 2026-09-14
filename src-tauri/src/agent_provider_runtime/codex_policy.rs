use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexTransport {
    #[default]
    AppServer,
    Exec,
}

pub fn validate_codex_policy_args(args: &[String]) -> Result<(), String> {
    if args.len() > 16 {
        return Err("Codex app-server accepts at most 16 extra arguments.".to_string());
    }
    for argument in args {
        if argument.is_empty() || argument.len() > 256 {
            return Err("Codex app-server arguments must contain 1 to 256 bytes.".to_string());
        }
        if !argument.bytes().all(|byte| (0x20..=0x7e).contains(&byte)) {
            return Err("Codex app-server arguments must use printable ASCII.".to_string());
        }
        let name = argument.split('=').next().unwrap_or(argument);
        if matches!(name, "--listen" | "--code-mode-host" | "--strict-config") {
            return Err("This Codex app-server argument is managed by the editor.".to_string());
        }
    }
    Ok(())
}
