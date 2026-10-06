use super::*;
use crate::agent_command_catalog_domain::CLAUDE_CONTROL_REQUEST_ID;
use serde_json::json;
use std::{
    cell::{Cell, RefCell},
    collections::VecDeque,
    sync::{Barrier, Condvar},
};

const CLAUDE: AgentCliInvocation = AgentCliInvocation::ClaudeCode;
const CODEX: AgentCliInvocation = AgentCliInvocation::CodexExec;

fn claude_stdout(names: &[&str]) -> Vec<u8> {
    let commands: Vec<_> = names.iter().map(|name| json!({"name": name})).collect();
    let response = json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": CLAUDE_CONTROL_REQUEST_ID,
            "response": {"commands": commands},
        },
    });
    let mut stdout = serde_json::to_vec(&response).unwrap();
    stdout.push(b'\n');
    stdout
}

fn codex_stdout(cwd: &str, names: &[&str]) -> Vec<u8> {
    let skills: Vec<_> = names
        .iter()
        .map(|name| json!({"name": name, "scope": "repo"}))
        .collect();
    let response = json!({"id": 1, "result": {"data": [{"cwd": cwd, "skills": skills}]}});
    let mut stdout = serde_json::to_vec(&response).unwrap();
    stdout.push(b'\n');
    stdout
}

struct FakeSource {
    generation: Cell<Option<u64>>,
    generation_after_probe: Cell<Option<Option<u64>>>,
    responses: RefCell<VecDeque<Result<Vec<u8>, String>>>,
    probes: RefCell<Vec<(AgentCliInvocation, u64, PathBuf)>>,
}

impl FakeSource {
    fn new(generation: u64, responses: Vec<Result<Vec<u8>, String>>) -> Self {
        Self {
            generation: Cell::new(Some(generation)),
            generation_after_probe: Cell::new(None),
            responses: RefCell::new(responses.into()),
            probes: RefCell::new(Vec::new()),
        }
    }

    fn probe_count(&self) -> usize {
        self.probes.borrow().len()
    }
}

impl AgentCommandCatalogSource for FakeSource {
    fn current_generation(&self, _provider: AgentCliInvocation) -> Option<u64> {
        self.generation.get()
    }

    fn probe(
        &self,
        provider: AgentCliInvocation,
        generation: u64,
        workspace_root: &Path,
    ) -> Result<Vec<u8>, String> {
        self.probes
            .borrow_mut()
            .push((provider, generation, workspace_root.to_path_buf()));
        if let Some(next) = self.generation_after_probe.take() {
            self.generation.set(next);
        }
        self.responses
            .borrow_mut()
            .pop_front()
            .unwrap_or_else(|| Err("exhausted".to_string()))
    }
}

struct BlockingSource {
    entered: Barrier,
    release: (Mutex<bool>, Condvar),
    stdout: Vec<u8>,
}

impl BlockingSource {
    fn new(stdout: Vec<u8>) -> Self {
        Self {
            entered: Barrier::new(2),
            release: (Mutex::new(false), Condvar::new()),
            stdout,
        }
    }

    fn release(&self) {
        let (lock, condvar) = &self.release;
        *lock.lock().unwrap() = true;
        condvar.notify_all();
    }
}

impl AgentCommandCatalogSource for BlockingSource {
    fn current_generation(&self, _provider: AgentCliInvocation) -> Option<u64> {
        Some(1)
    }

    fn probe(
        &self,
        _provider: AgentCliInvocation,
        _generation: u64,
        _workspace_root: &Path,
    ) -> Result<Vec<u8>, String> {
        self.entered.wait();
        let (lock, condvar) = &self.release;
        let mut released = lock.lock().unwrap();
        while !*released {
            released = condvar.wait(released).unwrap();
        }
        Ok(self.stdout.clone())
    }
}

struct PanickingSource;

impl AgentCommandCatalogSource for PanickingSource {
    fn current_generation(&self, _provider: AgentCliInvocation) -> Option<u64> {
        Some(1)
    }

    fn probe(
        &self,
        _provider: AgentCliInvocation,
        _generation: u64,
        _workspace_root: &Path,
    ) -> Result<Vec<u8>, String> {
        panic!("probe panicked");
    }
}

fn owner<'a>(root: &'a Path, workspace_id: &'a str, provider: AgentCliInvocation) -> CatalogOwner<'a> {
    CatalogOwner {
        workspace_root: root,
        workspace_id,
        provider,
    }
}

fn names(catalog: &AgentCommandCatalog) -> Vec<&str> {
    catalog
        .entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect()
}

#[test]
fn a_fresh_catalog_is_served_from_cache_until_the_ttl_expires() {
    let service = Arc::new(AgentCommandCatalogService::new());
    let root = PathBuf::from("/Users/dev/project");
    let owner = owner(&root, "ws-a", CLAUDE);
    let source = FakeSource::new(
        1,
        vec![Ok(claude_stdout(&["pr"])), Ok(claude_stdout(&["pr", "review"]))],
    );
    let now = Instant::now();
    let first = service.resolve(&source, owner, now).unwrap();
    assert_eq!(names(&first), ["pr"]);
    assert_eq!(source.probe_count(), 1);
    assert_eq!(source.probes.borrow()[0], (CLAUDE, 1, root.clone()));
    let hit = service
        .resolve(&source, owner, now + CATALOG_TTL - Duration::from_millis(1))
        .unwrap();
    assert!(Arc::ptr_eq(&first, &hit));
    assert_eq!(source.probe_count(), 1);
    let refreshed = service.resolve(&source, owner, now + CATALOG_TTL).unwrap();
    assert_eq!(names(&refreshed), ["pr", "review"]);
    assert_eq!(source.probe_count(), 2);
    assert_eq!(service.in_flight_count(), 0);
}

#[test]
fn a_changed_provider_generation_invalidates_the_cached_catalog() {
    let service = Arc::new(AgentCommandCatalogService::new());
    let root = PathBuf::from("/Users/dev/project");
    let owner = owner(&root, "ws-a", CODEX);
    let source = FakeSource::new(
        1,
        vec![
            Ok(codex_stdout("/Users/dev/project", &["pdf"])),
            Ok(codex_stdout("/Users/dev/project", &["pdf", "imagegen"])),
        ],
    );
    let now = Instant::now();
    let first = service.resolve(&source, owner, now).unwrap();
    assert_eq!(names(&first), ["pdf"]);
    source.generation.set(Some(2));
    let second = service.resolve(&source, owner, now).unwrap();
    assert_eq!(names(&second), ["pdf", "imagegen"]);
    assert_eq!(source.probes.borrow()[1], (CODEX, 2, root.clone()));
    assert!(service.cached(&owner, 1).is_none());
    assert!(service.cached(&owner, 2).is_some());
    source.generation.set(None);
    assert_eq!(
        service.resolve(&source, owner, now).err().as_deref(),
        Some(AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR)
    );
}

#[test]
fn a_provider_change_during_the_probe_is_never_installed_or_published() {
    let service = Arc::new(AgentCommandCatalogService::new());
    let root = PathBuf::from("/Users/dev/project");
    let owner = owner(&root, "ws-a", CLAUDE);
    let now = Instant::now();
    for next in [Some(2), None] {
        let source = FakeSource::new(1, vec![Ok(claude_stdout(&["pr"]))]);
        source.generation_after_probe.set(Some(next));
        let expected = match next {
            Some(_) => AGENT_COMMAND_CATALOG_PROVIDER_CHANGED_ERROR,
            None => AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR,
        };
        assert_eq!(
            service.resolve(&source, owner, now).err().as_deref(),
            Some(expected)
        );
        assert_eq!(source.probe_count(), 1);
        assert!(service.cached(&owner, 1).is_none());
        assert!(service.cached_roots().is_empty());
        assert_eq!(service.in_flight_count(), 0);
    }
}

#[test]
fn a_cached_catalog_is_not_published_once_its_provider_is_disabled_or_replaced() {
    let service = Arc::new(AgentCommandCatalogService::new());
    let root = PathBuf::from("/Users/dev/project");
    let owner = owner(&root, "ws-a", CLAUDE);
    let now = Instant::now();
    let source = FakeSource::new(1, vec![Ok(claude_stdout(&["pr"]))]);
    service.resolve(&source, owner, now).unwrap();
    assert!(service.cached(&owner, 1).is_some());
    source.generation.set(None);
    assert_eq!(
        service.resolve(&source, owner, now).err().as_deref(),
        Some(AGENT_COMMAND_CATALOG_PROVIDER_DISABLED_ERROR)
    );
    source.generation.set(Some(2));
    let replaced = FakeSource::new(2, vec![Err("probe failed".to_string())]);
    assert_eq!(
        service.resolve(&replaced, owner, now).err().as_deref(),
        Some("probe failed")
    );
    assert_eq!(source.probe_count(), 1);
    assert!(service.cached(&owner, 2).is_none());
}

#[test]
fn a_failed_or_malformed_probe_keeps_the_previous_catalog() {
    let service = Arc::new(AgentCommandCatalogService::new());
    let root = PathBuf::from("/Users/dev/project");
    let owner = owner(&root, "ws-a", CLAUDE);
    let now = Instant::now();
    let good = FakeSource::new(1, vec![Ok(claude_stdout(&["pr"]))]);
    let installed = service.resolve(&good, owner, now).unwrap();
    for failure in [
        Err("Provider command catalog probe failed.".to_string()),
        Ok(b"not json\n".to_vec()),
        Ok(claude_stdout(&["pr"])[..20].to_vec()),
        Ok(vec![b' '; 2 * 1024 * 1024 + 1]),
    ] {
        let source = FakeSource::new(1, vec![failure]);
        let later = now + CATALOG_TTL + Duration::from_secs(1);
        assert!(service.resolve(&source, owner, later).is_err());
        assert_eq!(source.probe_count(), 1);
        assert!(Arc::ptr_eq(
            &service.cached(&owner, 1).unwrap(),
            &installed
        ));
        assert_eq!(service.in_flight_count(), 0);
    }
}

#[test]
fn the_oldest_fetched_catalog_is_evicted_first() {
    let service = Arc::new(AgentCommandCatalogService::new());
    let now = Instant::now();
    let roots: Vec<PathBuf> = (0..MAX_CACHED_CATALOGS + 1)
        .map(|index| PathBuf::from(format!("/Users/dev/project-{index}")))
        .collect();
    for (index, root) in roots.iter().enumerate().skip(1) {
        let source = FakeSource::new(1, vec![Ok(claude_stdout(&["pr"]))]);
        service
            .resolve(
                &source,
                owner(root, "ws", CLAUDE),
                now + Duration::from_secs(index as u64),
            )
            .unwrap();
    }
    assert_eq!(service.cached_roots().len(), MAX_CACHED_CATALOGS);
    let source = FakeSource::new(1, vec![Ok(claude_stdout(&["pr"]))]);
    service
        .resolve(
            &source,
            owner(&roots[0], "ws", CLAUDE),
            now + Duration::from_secs(roots.len() as u64),
        )
        .unwrap();
    let cached = service.cached_roots();
    assert_eq!(cached.len(), MAX_CACHED_CATALOGS);
    assert!(cached.contains(&roots[0]));
    assert!(!cached.contains(&roots[1]));
    assert!(cached.contains(&roots[2]));
}

#[test]
fn different_workspaces_and_providers_never_share_catalogs() {
    let service = Arc::new(AgentCommandCatalogService::new());
    let now = Instant::now();
    let root_a = PathBuf::from("/Users/dev/a");
    let root_b = PathBuf::from("/Users/dev/b");
    let source = FakeSource::new(
        1,
        vec![
            Ok(claude_stdout(&["a-command"])),
            Ok(claude_stdout(&["b-command"])),
            Ok(codex_stdout("/Users/dev/a", &["a-skill"])),
            Ok(claude_stdout(&["a-command-reopened"])),
        ],
    );
    let a = service.resolve(&source, owner(&root_a, "ws-a1", CLAUDE), now).unwrap();
    let b = service.resolve(&source, owner(&root_b, "ws-b1", CLAUDE), now).unwrap();
    assert_eq!(names(&a), ["a-command"]);
    assert_eq!(names(&b), ["b-command"]);
    let a_codex = service.resolve(&source, owner(&root_a, "ws-a1", CODEX), now).unwrap();
    assert_eq!(names(&a_codex), ["a-skill"]);
    let a_again = service.resolve(&source, owner(&root_a, "ws-a1", CLAUDE), now).unwrap();
    assert!(Arc::ptr_eq(&a, &a_again));
    assert_eq!(source.probe_count(), 3);
    let reopened = service.resolve(&source, owner(&root_a, "ws-a2", CLAUDE), now).unwrap();
    assert_eq!(names(&reopened), ["a-command-reopened"]);
    assert_eq!(source.probe_count(), 4);
    assert!(service.cached(&owner(&root_a, "ws-a1", CLAUDE), 1).is_none());
    assert!(Arc::ptr_eq(
        &service.cached(&owner(&root_b, "ws-b1", CLAUDE), 1).unwrap(),
        &b
    ));
}

#[test]
fn an_in_flight_probe_serves_stale_catalogs_or_a_loading_error() {
    let service = Arc::new(AgentCommandCatalogService::new());
    let root = PathBuf::from("/Users/dev/project");
    let now = Instant::now();
    let blocking = Arc::new(BlockingSource::new(claude_stdout(&["fresh"])));
    let worker_service = Arc::clone(&service);
    let worker_source = Arc::clone(&blocking);
    let worker = std::thread::spawn(move || {
        worker_service.resolve(
            worker_source.as_ref(),
            owner(Path::new("/Users/dev/project"), "ws-a", CLAUDE),
            now,
        )
    });
    blocking.entered.wait();
    assert_eq!(service.in_flight_count(), 1);
    assert_eq!(
        service
            .resolve(blocking.as_ref(), owner(&root, "ws-a", CLAUDE), now)
            .err()
            .as_deref(),
        Some(AGENT_COMMAND_CATALOG_LOADING_ERROR)
    );
    let other = FakeSource::new(1, vec![Ok(claude_stdout(&["other"]))]);
    let other_root = PathBuf::from("/Users/dev/other");
    assert_eq!(
        names(&service.resolve(&other, owner(&other_root, "ws-b", CLAUDE), now).unwrap()),
        ["other"]
    );
    blocking.release();
    let fresh = worker.join().unwrap().unwrap();
    assert_eq!(names(&fresh), ["fresh"]);
    assert_eq!(service.in_flight_count(), 0);

    let later = now + CATALOG_TTL + Duration::from_secs(1);
    let blocking = Arc::new(BlockingSource::new(claude_stdout(&["newer"])));
    let worker_service = Arc::clone(&service);
    let worker_source = Arc::clone(&blocking);
    let worker = std::thread::spawn(move || {
        worker_service.resolve(
            worker_source.as_ref(),
            owner(Path::new("/Users/dev/project"), "ws-a", CLAUDE),
            later,
        )
    });
    blocking.entered.wait();
    let stale = service
        .resolve(blocking.as_ref(), owner(&root, "ws-a", CLAUDE), later)
        .unwrap();
    assert!(Arc::ptr_eq(&stale, &fresh));
    blocking.release();
    assert_eq!(names(&worker.join().unwrap().unwrap()), ["newer"]);
    assert_eq!(names(&service.cached(&owner(&root, "ws-a", CLAUDE), 1).unwrap()), ["newer"]);
}

#[test]
fn a_panicking_probe_releases_the_in_flight_slot() {
    let service = Arc::new(AgentCommandCatalogService::new());
    let root = PathBuf::from("/Users/dev/project");
    let now = Instant::now();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        service.resolve(&PanickingSource, owner(&root, "ws-a", CLAUDE), now)
    }));
    assert!(outcome.is_err());
    assert_eq!(service.in_flight_count(), 0);
    let source = FakeSource::new(1, vec![Ok(claude_stdout(&["pr"]))]);
    assert_eq!(
        names(&service.resolve(&source, owner(&root, "ws-a", CLAUDE), now).unwrap()),
        ["pr"]
    );
}

#[test]
fn a_non_utf8_root_is_refused_before_probing() {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let service = Arc::new(AgentCommandCatalogService::new());
        let root = PathBuf::from(std::ffi::OsStr::from_bytes(b"/Users/dev/\xff"));
        let source = FakeSource::new(1, vec![Ok(claude_stdout(&["pr"]))]);
        assert!(service
            .resolve(&source, owner(&root, "ws-a", CLAUDE), Instant::now())
            .is_err());
        assert_eq!(source.probe_count(), 0);
        assert_eq!(service.in_flight_count(), 0);
    }
}
