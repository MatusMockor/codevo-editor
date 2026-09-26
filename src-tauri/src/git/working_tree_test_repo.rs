use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_REPO: AtomicU64 = AtomicU64::new(0);

pub(crate) struct TestRepo {
    path: PathBuf,
}

impl TestRepo {
    pub(crate) fn new(label: &str) -> Self {
        let unique = NEXT_REPO.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "codevo-working-tree-{label}-{}-{unique}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create test repository");
        let repo = Self {
            path: path.canonicalize().expect("canonical test repository"),
        };
        repo.git(&["init", "-q"]);
        repo.git(&["symbolic-ref", "HEAD", "refs/heads/main"]);
        repo.git(&["config", "user.email", "tree@example.com"]);
        repo.git(&["config", "user.name", "Tree Author"]);
        repo.git(&["config", "commit.gpgsign", "false"]);
        repo
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn write(&self, relative: &str, content: &str) {
        let target = self.path.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).expect("create parent directory");
        }
        fs::write(target, content).expect("write test file");
    }

    pub(crate) fn read(&self, relative: &str) -> Option<String> {
        fs::read_to_string(self.path.join(relative)).ok()
    }

    pub(crate) fn commit_all(&self, message: &str) {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", message]);
    }

    pub(crate) fn git(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(&self.path)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_string()
    }
}

impl Drop for TestRepo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
