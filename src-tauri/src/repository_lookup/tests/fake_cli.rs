use std::fs;
use std::io::Write;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::super::clock::TestClock;
use super::super::plan::CliProgram;
use super::super::resolver::{resolve_on_search_path, ExecutableResolver, ResolvedExecutable};
use super::super::service::RepositoryLookupService;
use super::super::wire::{RepositoryLookupRequest, RepositoryLookupRequestWire};

pub(super) const TEST_SEARCH_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";
pub(super) const PAST_SPAWN_INTERVAL: Duration = Duration::from_millis(500);

static NONCE: AtomicU64 = AtomicU64::new(0);

pub(super) struct FakeCliDirectory {
    base: PathBuf,
    clock: Arc<TestClock>,
}

impl FakeCliDirectory {
    pub(super) fn create(label: &str) -> Self {
        let nonce = NONCE.fetch_add(1, Ordering::Relaxed);
        let base = std::env::temp_dir().join(format!(
            "codevo-repository-lookup-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&base).expect("create fake cli directory");
        fs::set_permissions(&base, fs::Permissions::from_mode(0o700))
            .expect("restrict fake cli directory");
        Self {
            base,
            clock: Arc::new(TestClock::new()),
        }
    }

    pub(super) fn clock(&self) -> &TestClock {
        &self.clock
    }

    pub(super) fn advance_past_spawn_interval(&self) {
        self.clock.advance(PAST_SPAWN_INTERVAL);
    }

    pub(super) fn base(&self) -> &Path {
        &self.base
    }

    pub(super) fn file(&self, name: &str) -> PathBuf {
        self.base.join(name)
    }

    pub(super) fn script(&self, name: &str, body: &str) -> PathBuf {
        let path = self.file(name);
        let mut handle = fs::File::create(&path).expect("create fake cli script");
        handle
            .write_all(format!("#!/bin/sh\n{body}\n").as_bytes())
            .expect("write fake cli script");
        handle.sync_all().expect("flush fake cli script");
        drop(handle);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
            .expect("mark fake cli script executable");
        path
    }

    pub(super) fn service(&self) -> Arc<RepositoryLookupService> {
        Arc::new(RepositoryLookupService::with_clock(
            Arc::new(FakeExecutableResolver {
                base: self.base.clone(),
            }),
            self.base.clone(),
            Arc::clone(&self.clock) as Arc<dyn super::super::clock::Clock>,
        ))
    }

    pub(super) fn read(&self, name: &str) -> String {
        fs::read_to_string(self.file(name)).unwrap_or_default()
    }

    pub(super) fn await_file(&self, name: &str) -> bool {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if self.file(name).exists() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        false
    }
}

impl Drop for FakeCliDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

struct FakeExecutableResolver {
    base: PathBuf,
}

impl ExecutableResolver for FakeExecutableResolver {
    fn resolve(&self, program: CliProgram) -> Option<ResolvedExecutable> {
        let path = self.base.join(program.executable_name());
        let metadata = fs::metadata(&path).ok()?;
        if !metadata.is_file() || metadata.mode() & 0o111 == 0 {
            return None;
        }
        Some(ResolvedExecutable {
            path,
            search_path: TEST_SEARCH_PATH.to_string(),
        })
    }
}

pub(super) fn request(provider: &str, host: &str, path: &str) -> RepositoryLookupRequest {
    let wire = serde_json::from_value::<RepositoryLookupRequestWire>(serde_json::json!({
        "provider": provider,
        "host": host,
        "path": path
    }))
    .expect("deserialize lookup request");
    RepositoryLookupRequest::validate(&wire).expect("validate lookup request")
}

pub(super) fn await_process_exit(process_id: i32) -> bool {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if !process_is_alive(process_id) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    false
}

pub(super) fn terminate_process(process_id: i32) {
    if process_id <= 0 {
        return;
    }
    // SAFETY: the inspected pid belongs to a helper process this test spawned.
    unsafe {
        libc::kill(process_id, libc::SIGKILL);
    }
}

pub(super) fn detaching_sleep_command() -> Option<&'static str> {
    for candidate in [
        "perl -e 'use POSIX; POSIX::setsid(); sleep 300'",
        "python3 -c 'import os,time; os.setsid(); time.sleep(300)'",
    ] {
        let program = candidate.split(' ').next().unwrap_or_default();
        if resolve_on_search_path(TEST_SEARCH_PATH, program).is_some() {
            return Some(candidate);
        }
    }
    None
}

pub(super) fn process_is_alive(process_id: i32) -> bool {
    if process_id <= 0 {
        return false;
    }
    // SAFETY: signal 0 performs an existence check only and never delivers a
    // signal to the inspected process.
    unsafe { libc::kill(process_id, 0) == 0 }
}
