use serde::Serialize;
use std::{
    fs,
    io::{self, Write},
    path::Path,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: FileEntryKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileEntryKind {
    Directory,
    File,
}

pub trait WorkspaceFileRepository {
    fn create_directory(&self, path: &Path) -> io::Result<()>;
    fn create_text_file(&self, path: &Path) -> io::Result<()>;
    fn delete_path(&self, path: &Path) -> io::Result<()>;
    fn read_directory(&self, path: &Path) -> io::Result<Vec<FileEntry>>;
    fn read_text_file(&self, path: &Path) -> io::Result<String>;
    fn rename_path(&self, from: &Path, to: &Path) -> io::Result<()>;
    fn write_text_file(&self, path: &Path, content: &str) -> io::Result<()>;
}

pub struct LocalWorkspaceFileRepository;

impl WorkspaceFileRepository for LocalWorkspaceFileRepository {
    fn create_directory(&self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::create_dir(path)
    }

    fn create_text_file(&self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .map(|_| ())
    }

    fn delete_path(&self, path: &Path) -> io::Result<()> {
        if !path.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Path does not exist",
            ));
        }

        if path.is_dir() {
            return fs::remove_dir_all(path);
        }

        fs::remove_file(path)
    }

    fn read_directory(&self, path: &Path) -> io::Result<Vec<FileEntry>> {
        if !path.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Path is not a directory",
            ));
        }

        let mut entries = Vec::new();

        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy().to_string();

            if should_hide_entry(&name) {
                continue;
            }

            let metadata = entry.metadata()?;
            let kind = if metadata.is_dir() {
                FileEntryKind::Directory
            } else {
                FileEntryKind::File
            };

            entries.push(FileEntry {
                name,
                path: entry.path().to_string_lossy().to_string(),
                kind,
            });
        }

        entries.sort_by(|left, right| {
            let left_rank = match left.kind {
                FileEntryKind::Directory => 0,
                FileEntryKind::File => 1,
            };
            let right_rank = match right.kind {
                FileEntryKind::Directory => 0,
                FileEntryKind::File => 1,
            };

            left_rank
                .cmp(&right_rank)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });

        Ok(entries)
    }

    fn read_text_file(&self, path: &Path) -> io::Result<String> {
        if !path.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Path is not a file",
            ));
        }

        fs::read_to_string(path)
    }

    fn rename_path(&self, from: &Path, to: &Path) -> io::Result<()> {
        if !from.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Source path does not exist",
            ));
        }

        if to.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "Target path already exists",
            ));
        }

        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::rename(from, to)
    }

    fn write_text_file(&self, path: &Path, content: &str) -> io::Result<()> {
        if path.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Cannot write text to a directory",
            ));
        }

        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(path)?;

        file.write_all(content.as_bytes())
    }
}

fn should_hide_entry(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "vendor"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | ".turbo"
            | ".cache"
            | "coverage"
    )
}

#[cfg(test)]
mod tests {
    use super::{LocalWorkspaceFileRepository, WorkspaceFileRepository};
    use std::{fs, time::SystemTime};

    #[test]
    fn read_directory_sorts_directories_before_files_and_hides_heavy_folders() {
        let root = create_temp_dir("workspace-directory");
        fs::create_dir(root.join("src")).expect("create src");
        fs::create_dir(root.join("vendor")).expect("create vendor");
        fs::write(root.join("README.md"), "hello").expect("write readme");
        fs::write(root.join("src").join("main.php"), "<?php").expect("write php");

        let repository = LocalWorkspaceFileRepository;
        let entries = repository.read_directory(&root).expect("read directory");

        let names = entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["src", "README.md"]);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn read_and_write_text_file_round_trip() {
        let root = create_temp_dir("workspace-file");
        let file_path = root.join("note.txt");
        let repository = LocalWorkspaceFileRepository;

        repository
            .write_text_file(&file_path, "saved")
            .expect("write file");

        let content = repository.read_text_file(&file_path).expect("read file");

        assert_eq!(content, "saved");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn create_rename_and_delete_file() {
        let root = create_temp_dir("workspace-mutations");
        let file_path = root.join("draft.txt");
        let renamed_path = root.join("final.txt");
        let repository = LocalWorkspaceFileRepository;

        repository
            .create_text_file(&file_path)
            .expect("create file");
        assert!(file_path.exists());

        repository
            .rename_path(&file_path, &renamed_path)
            .expect("rename file");
        assert!(!file_path.exists());
        assert!(renamed_path.exists());

        repository
            .delete_path(&renamed_path)
            .expect("delete renamed file");
        assert!(!renamed_path.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn create_and_delete_directory() {
        let root = create_temp_dir("workspace-directory-mutations");
        let directory_path = root.join("src").join("Domain");
        let repository = LocalWorkspaceFileRepository;

        repository
            .create_directory(&directory_path)
            .expect("create directory");
        assert!(directory_path.is_dir());

        repository
            .delete_path(&root.join("src"))
            .expect("delete directory tree");
        assert!(!directory_path.exists());
        fs::remove_dir_all(root).expect("cleanup");
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
