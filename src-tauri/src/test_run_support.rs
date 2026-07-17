use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static RESULT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub struct ResultFileGuard(pub PathBuf);

impl Drop for ResultFileGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub fn prepare_result_path(
    app_data_base: &Path,
    subdirectory: &str,
    label: &str,
) -> Result<PathBuf, String> {
    prepare_result_path_with_extension(app_data_base, subdirectory, label, "xml")
}

pub fn prepare_result_path_with_extension(
    app_data_base: &Path,
    subdirectory: &str,
    label: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    let directory = app_data_base.join(subdirectory);
    ensure_private_directory(&directory, label)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to create {label} filename: {error}"))?
        .as_nanos();
    let sequence = RESULT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    Ok(directory.join(format!(
        "{}-{timestamp}-{sequence}.{extension}",
        std::process::id()
    )))
}

pub fn ensure_private_directory(path: &Path, label: &str) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("Failed to create {label} directory: {error}"))?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect {label} directory: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(format!("{label} path is not a private directory."));
    }
    set_private_permissions(path, label)?;
    Ok(())
}

#[cfg(unix)]
fn set_private_permissions(path: &Path, label: &str) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Failed to secure {label} directory: {error}"))
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
pub fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
pub fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}
