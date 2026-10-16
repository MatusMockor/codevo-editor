use super::mcp_device_config::{DeviceConfigError, MAX_DEVICE_CONFIG_BYTES};
use std::ffi::OsString;
use std::io::Read;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

const CONFIG_FILE_NAME: &str = ".claude.json";
const UNREADABLE: &str = "The Claude configuration on this Mac could not be read.";

pub(super) fn config_path(
    config_dir: Option<OsString>,
    home: Option<OsString>,
) -> Result<PathBuf, &'static str> {
    if let Some(dir) = config_dir.filter(|dir| !dir.is_empty()) {
        return Ok(PathBuf::from(dir).join(CONFIG_FILE_NAME));
    }
    home.filter(|home| !home.is_empty())
        .map(|home| PathBuf::from(home).join(CONFIG_FILE_NAME))
        .ok_or(UNREADABLE)
}

pub(super) fn device_config_path() -> Result<PathBuf, &'static str> {
    config_path(
        std::env::var_os("CLAUDE_CONFIG_DIR"),
        std::env::var_os("HOME"),
    )
}

pub(super) fn read_bounded(path: &Path) -> Result<Option<Vec<u8>>, &'static str> {
    let file = match std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(UNREADABLE),
    };
    let metadata = file.metadata().map_err(|_| UNREADABLE)?;
    if !metadata.is_file() {
        return Err(UNREADABLE);
    }
    if metadata.len() > MAX_DEVICE_CONFIG_BYTES as u64 {
        return Err(DeviceConfigError::TooLarge.message());
    }
    let mut bytes = Vec::new();
    file.take(MAX_DEVICE_CONFIG_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| UNREADABLE)?;
    if bytes.len() > MAX_DEVICE_CONFIG_BYTES {
        return Err(DeviceConfigError::TooLarge.message());
    }
    Ok(Some(bytes))
}
