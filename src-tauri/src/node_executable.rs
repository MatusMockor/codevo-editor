use std::{env, path::PathBuf};

const CODEVO_EDITOR_NODE_PATH: &str = "CODEVO_EDITOR_NODE_PATH";

pub(crate) fn node_executable_path() -> Option<String> {
    let configured = env::var_os(CODEVO_EDITOR_NODE_PATH).map(PathBuf::from);
    if let Some(path) = configured.filter(|path| path.is_file()) {
        return Some(path.to_string_lossy().to_string());
    }
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .map(|directory| directory.join("node"))
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().to_string())
}
