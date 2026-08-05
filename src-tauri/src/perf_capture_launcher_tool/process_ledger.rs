use std::{
    collections::BTreeSet,
    io,
    process::Child,
    time::{Duration, Instant},
};

const MAX_OWNED_PROCESSES: usize = 4 * 1024;
const MAX_CLEANUP_FAILURES: usize = 32;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProcessIdentity {
    pid: i32,
    ppid: i32,
    pgid: i32,
    start_seconds: u64,
    start_microseconds: u64,
    uid: libc::uid_t,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct ExpectedRootProcessIdentity {
    process: ProcessIdentity,
    root_pgid: i32,
    start_time_millis: i64,
}

impl ExpectedRootProcessIdentity {
    #[cfg(test)]
    pub(super) fn capture(root_pid: i32, launch_time_millis: i64) -> Result<Self, String> {
        let root = read_process_identity(root_pid)?.ok_or_else(|| {
            "The production capture root process identity is unavailable.".to_owned()
        })?;
        validate_root_owner(&root)?;
        let kernel_start_millis = process_start_time_millis(&root)?;
        if kernel_start_millis.abs_diff(launch_time_millis) > 1 {
            return Err("The production capture root process start identity changed.".to_owned());
        }
        Self::from_kernel_identity(root, root_pid)
    }

    pub(super) fn capture_direct(child: &mut Child) -> Result<Self, String> {
        if observe_child_exit_without_reaping(child)
            .map_err(|_| "The direct production capture child status is unavailable.".to_owned())?
        {
            return Err("The direct production capture child already terminated.".to_owned());
        }
        let root_pid = i32::try_from(child.id()).map_err(|_| {
            "The direct production capture child PID exceeded its bound.".to_owned()
        })?;
        let root = read_process_identity(root_pid)?.ok_or_else(|| {
            "The production capture root process identity is unavailable.".to_owned()
        })?;
        validate_root_owner(&root)?;
        if root.pgid != root_pid {
            return Err(
                "The production capture root process does not own its process group.".to_owned(),
            );
        }
        let expected = Self::from_kernel_identity(root, root_pid)?;
        if observe_child_exit_without_reaping(child)
            .map_err(|_| "The direct production capture child status is unavailable.".to_owned())?
        {
            return Err(
                "The direct production capture child terminated while binding its identity."
                    .to_owned(),
            );
        }
        expected.validate_current_identity(expected.current_identity()?)?;
        Ok(expected)
    }

    pub(super) fn start_time_millis(&self) -> i64 {
        self.start_time_millis
    }

    pub(super) fn owns_expected_process_group(&self) -> Result<bool, String> {
        Ok(self.current_identity()?.pgid == self.root_pgid)
    }

    fn current_identity(&self) -> Result<ProcessIdentity, String> {
        let current = read_process_identity(self.process.pid)?.ok_or_else(|| {
            "The production capture root process identity is unavailable.".to_owned()
        })?;
        self.validate_current_identity(current)?;
        Ok(current)
    }

    fn validate_current_identity(&self, current: ProcessIdentity) -> Result<(), String> {
        if !same_process(&self.process, &current) {
            return Err("The production capture root process owner changed.".to_owned());
        }
        Ok(())
    }

    fn from_kernel_identity(process: ProcessIdentity, root_pgid: i32) -> Result<Self, String> {
        Ok(Self {
            process,
            root_pgid,
            start_time_millis: process_start_time_millis(&process)?,
        })
    }
}

pub(super) struct OwnedProcessLedger {
    owned: Vec<ProcessIdentity>,
    observed_groups: BTreeSet<i32>,
    root_pid: i32,
    root_pgid: i32,
    uid: libc::uid_t,
    terminal_proven: bool,
    cleanup_finalized: Option<Result<(), String>>,
    #[cfg(test)]
    injected_cleanup_observe_failure: Option<String>,
}

impl OwnedProcessLedger {
    pub(super) fn new(expected_root: ExpectedRootProcessIdentity) -> Result<Self, String> {
        let mut ledger = Self::new_unobserved(expected_root)?;
        ledger.observe()?;
        Ok(ledger)
    }

    pub(super) fn new_unobserved(
        expected_root: ExpectedRootProcessIdentity,
    ) -> Result<Self, String> {
        let root = expected_root.current_identity()?;
        if root.pgid != expected_root.root_pgid {
            return Err(
                "The production capture root process does not own its process group.".to_owned(),
            );
        }
        validate_root_owner(&root)?;
        let uid = root.uid;
        let owned = vec![root];
        let observed_groups = BTreeSet::from([root.pgid]);
        Ok(Self {
            owned,
            observed_groups,
            root_pid: root.pid,
            root_pgid: root.pgid,
            uid,
            terminal_proven: false,
            cleanup_finalized: None,
            #[cfg(test)]
            injected_cleanup_observe_failure: None,
        })
    }

    pub(super) fn observe(&mut self) -> Result<(), String> {
        let mut active_owned = Vec::new();
        for expected in &self.owned {
            if let Some(observed) = read_process_identity(expected.pid)? {
                if same_process(expected, &observed) {
                    self.observed_groups.insert(observed.pgid);
                    active_owned.push(expected.pid);
                }
            }
        }
        let mut cursor = 0_usize;
        while cursor < active_owned.len() {
            let parent = active_owned[cursor];
            cursor += 1;
            for child_pid in list_child_pids(parent)? {
                let Some(identity) = read_process_identity(child_pid)? else {
                    continue;
                };
                if self.admit_child_identity(parent, identity)? {
                    active_owned.push(identity.pid);
                }
            }
        }
        Ok(())
    }

    fn admit_child_identity(
        &mut self,
        parent: i32,
        identity: ProcessIdentity,
    ) -> Result<bool, String> {
        if self
            .owned
            .iter()
            .any(|expected| same_process(expected, &identity))
        {
            return Ok(false);
        }
        if identity.uid != self.uid || identity.ppid != parent {
            return Err("A production capture child identity changed during admission.".to_owned());
        }
        if self.owned.len() >= MAX_OWNED_PROCESSES {
            return Err("The production capture process ledger exceeded its bound.".to_owned());
        }
        self.observed_groups.insert(identity.pgid);
        self.owned.push(identity);
        Ok(true)
    }

    #[cfg(test)]
    pub(super) fn terminate_and_prove(&mut self) -> Result<(), String> {
        self.terminate_and_prove_inner(None)
    }

    pub(super) fn terminate_and_prove_with_reaper(
        &mut self,
        root_child: &mut Child,
    ) -> Result<(), String> {
        self.terminate_and_prove_inner(Some(root_child))
    }

    fn terminate_and_prove_inner(
        &mut self,
        mut root_child: Option<&mut Child>,
    ) -> Result<(), String> {
        if let Some(result) = &self.cleanup_finalized {
            return result.clone();
        }
        if self.terminal_proven {
            return Ok(());
        }
        let mut failures = Vec::new();
        let mut root_reaped = root_child.is_none();
        let mut root_kill_authorized = match root_child.as_deref_mut() {
            Some(child) => {
                let child_pid = i32::try_from(child.id()).map_err(|_| {
                    "The direct production capture child PID exceeded its bound.".to_owned()
                })?;
                if child_pid != self.root_pid {
                    return Err(
                        "The direct production capture reaper has the wrong process identity."
                            .to_owned(),
                    );
                }
                match observe_child_exit_without_reaping(child) {
                    Ok(_) => true,
                    Err(error) => {
                        match child.try_wait() {
                            Ok(Some(_)) => root_reaped = true,
                            Ok(None) => retain_cleanup_failure(
                                &mut failures,
                                format!(
                                    "The direct production capture child status is unavailable: {error}."
                                ),
                            ),
                            Err(reap_error) => retain_cleanup_failure(
                                &mut failures,
                                format!(
                                    "The direct production capture child status is unavailable: {error}; reaper status also failed: {reap_error}."
                                ),
                            ),
                        }
                        false
                    }
                }
            }
            None => false,
        };
        self.observe_for_cleanup(&mut failures);
        let protected_root_pid = root_kill_authorized.then_some(self.root_pid);
        let groups = self.collect_live_owned_groups(protected_root_pid, &mut failures);
        signal_groups_best_effort(&groups, libc::SIGTERM, &mut failures);
        if self.wait_for_owned_processes_gone(
            Duration::from_secs(5),
            libc::SIGTERM,
            root_child.as_deref_mut(),
            &mut root_kill_authorized,
            &mut root_reaped,
            &mut failures,
        ) {
            return self.finish_cleanup(root_reaped, failures);
        }
        if let Some(child) = root_child.as_deref_mut() {
            kill_exact_root_best_effort(
                child,
                root_kill_authorized,
                &mut root_reaped,
                &mut failures,
            );
        }
        self.observe_for_cleanup(&mut failures);
        let surviving_groups = self.collect_live_owned_groups(
            (root_kill_authorized && !root_reaped).then_some(self.root_pid),
            &mut failures,
        );
        signal_groups_best_effort(&surviving_groups, libc::SIGKILL, &mut failures);
        if self.wait_for_owned_processes_gone(
            Duration::from_secs(5),
            libc::SIGKILL,
            root_child,
            &mut root_kill_authorized,
            &mut root_reaped,
            &mut failures,
        ) {
            return self.finish_cleanup(root_reaped, failures);
        }
        retain_cleanup_failure(
            &mut failures,
            "A production capture process group survived exact cleanup.".to_owned(),
        );
        Err(cleanup_failure_message(&failures))
    }

    #[cfg(test)]
    pub(super) fn is_terminal_proven(&self) -> bool {
        self.terminal_proven
    }

    pub(super) fn is_cleanup_finalized(&self) -> bool {
        self.cleanup_finalized.is_some()
    }

    pub(super) fn root_child_exited_without_reaping(&self, child: &Child) -> Result<bool, String> {
        let child_pid = i32::try_from(child.id()).map_err(|_| {
            "The direct production capture child PID exceeded its bound.".to_owned()
        })?;
        if child_pid != self.root_pid {
            return Err(
                "The direct production capture reaper has the wrong process identity.".to_owned(),
            );
        }
        observe_child_exit_without_reaping(child).map_err(|error| {
            format!("The direct production capture child status is unavailable: {error}.")
        })
    }

    fn finish_cleanup(&mut self, root_reaped: bool, failures: Vec<String>) -> Result<(), String> {
        if !root_reaped {
            return Err(cleanup_failure_message(&failures));
        }
        let result = if failures.is_empty() {
            self.terminal_proven = true;
            Ok(())
        } else {
            Err(cleanup_failure_message(&failures))
        };
        self.cleanup_finalized = Some(result.clone());
        result
    }

    pub(super) fn require_capture_separate_group_observed(&self) -> Result<(), String> {
        if self
            .observed_groups
            .iter()
            .any(|group| *group != self.root_pgid)
        {
            Ok(())
        } else {
            Err(
                "The production capture never observed its required separate process group."
                    .to_owned(),
            )
        }
    }

    fn observe_for_cleanup(&mut self, failures: &mut Vec<String>) {
        #[cfg(test)]
        if let Some(error) = self.injected_cleanup_observe_failure.take() {
            retain_cleanup_failure(
                failures,
                format!("The production capture process observation failed: {error}"),
            );
            return;
        }
        if let Err(error) = self.observe() {
            retain_cleanup_failure(
                failures,
                format!("The production capture process observation failed: {error}"),
            );
        }
    }

    fn collect_live_owned_groups(
        &self,
        protected_root_pid: Option<i32>,
        failures: &mut Vec<String>,
    ) -> BTreeSet<i32> {
        let mut live_groups = BTreeSet::new();
        for group in self.observed_groups.iter().copied() {
            match self.validate_live_group(group, protected_root_pid) {
                Ok(true) => {
                    live_groups.insert(group);
                }
                Ok(false) => {}
                Err(error) => retain_cleanup_failure(
                    failures,
                    format!("Production capture group {group} could not be authorized: {error}"),
                ),
            }
        }
        live_groups
    }

    fn validate_live_group(
        &self,
        group: i32,
        protected_root_pid: Option<i32>,
    ) -> Result<bool, String> {
        let deadline = Instant::now() + Duration::from_millis(250);
        loop {
            let members = list_group_pids(group)?;
            if members.is_empty() {
                return Ok(false);
            }
            let mut validated_members = 0_usize;
            for member_pid in members {
                let Some(candidate) = read_process_identity(member_pid)? else {
                    if protected_root_pid == Some(member_pid) {
                        validated_members += 1;
                    }
                    continue;
                };
                if self
                    .owned
                    .iter()
                    .all(|expected| !same_process(expected, &candidate))
                {
                    return Err(
                        "A production capture process group acquired a foreign member.".to_owned(),
                    );
                }
                validated_members += 1;
            }
            if validated_members > 0 {
                return Ok(true);
            }
            if Instant::now() >= deadline {
                return Err(
                    "A production capture process group changed during cleanup authorization."
                        .to_owned(),
                );
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn wait_for_owned_processes_gone(
        &mut self,
        timeout: Duration,
        signal: i32,
        mut root_child: Option<&mut Child>,
        root_kill_authorized: &mut bool,
        root_reaped: &mut bool,
        failures: &mut Vec<String>,
    ) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            *root_reaped = match root_child.as_deref_mut() {
                Some(child) => match child.try_wait() {
                    Ok(status) => status.is_some(),
                    Err(error) => {
                        *root_kill_authorized = false;
                        retain_cleanup_failure(
                            failures,
                            format!(
                                "The direct production capture child could not be reaped: {error}."
                            ),
                        );
                        false
                    }
                },
                None => true,
            };
            self.observe_for_cleanup(failures);
            let protected_root_pid =
                (*root_kill_authorized && !*root_reaped).then_some(self.root_pid);
            let groups = self.collect_live_owned_groups(protected_root_pid, failures);
            let live_owned = match self.has_live_owned_processes() {
                Ok(live) => live,
                Err(error) => {
                    retain_cleanup_failure(
                        failures,
                        format!("The production capture live-process proof failed: {error}"),
                    );
                    true
                }
            };
            if *root_reaped && groups.is_empty() && !live_owned {
                return true;
            }
            signal_groups_best_effort(&groups, signal, failures);
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn has_live_owned_processes(&self) -> Result<bool, String> {
        for expected in &self.owned {
            if read_process_identity(expected.pid)?
                .is_some_and(|observed| same_process(expected, &observed))
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    #[cfg(test)]
    fn contains_pid(&self, pid: i32) -> bool {
        self.owned.iter().any(|identity| identity.pid == pid)
    }

    #[cfg(test)]
    fn observed_group_ids(&self) -> &BTreeSet<i32> {
        &self.observed_groups
    }
}

fn list_child_pids(parent: i32) -> Result<Vec<i32>, String> {
    list_pids(|buffer, bytes| unsafe { libc::proc_listchildpids(parent, buffer, bytes) })
}

fn list_group_pids(group: i32) -> Result<Vec<i32>, String> {
    list_pids(|buffer, bytes| unsafe { libc::proc_listpgrppids(group, buffer, bytes) })
}

fn list_pids(call: impl FnOnce(*mut libc::c_void, i32) -> i32) -> Result<Vec<i32>, String> {
    let mut pids = vec![0_i32; MAX_OWNED_PROCESSES];
    let bytes = i32::try_from(pids.len() * std::mem::size_of::<i32>())
        .map_err(|_| "The production capture process inventory exceeded its bound.".to_owned())?;
    unsafe { *libc::__error() = 0 };
    let count = call(pids.as_mut_ptr().cast(), bytes);
    let errno = io::Error::last_os_error()
        .raw_os_error()
        .unwrap_or_default();
    if count < 0
        || (count == 0 && errno != 0)
        || usize::try_from(count)
            .ok()
            .is_none_or(|count| count >= pids.len())
    {
        return Err("The production capture process inventory failed.".to_owned());
    }
    pids.truncate(count as usize);
    pids.retain(|pid| *pid > 0);
    Ok(pids)
}

fn read_process_identity(pid: i32) -> Result<Option<ProcessIdentity>, String> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let expected = i32::try_from(std::mem::size_of::<libc::proc_bsdinfo>()).map_err(|_| {
        "The production capture process identity size exceeded its bound.".to_owned()
    })?;
    let read = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            expected,
        )
    };
    if read == 0 {
        return match io::Error::last_os_error().raw_os_error() {
            Some(code) if code == libc::ESRCH || code == libc::ENOENT => Ok(None),
            Some(code) => Err(format!(
                "The production capture process identity read failed with errno {code}."
            )),
            None => Err("The production capture process identity read failed.".to_owned()),
        };
    }
    if read != expected {
        return Err("The production capture process identity was truncated.".to_owned());
    }
    let info = unsafe { info.assume_init() };
    let identity = ProcessIdentity {
        pid: i32::try_from(info.pbi_pid)
            .map_err(|_| "A production capture PID exceeded its bound.".to_owned())?,
        ppid: i32::try_from(info.pbi_ppid)
            .map_err(|_| "A production capture parent PID exceeded its bound.".to_owned())?,
        pgid: i32::try_from(info.pbi_pgid)
            .map_err(|_| "A production capture process group exceeded its bound.".to_owned())?,
        start_seconds: info.pbi_start_tvsec,
        start_microseconds: info.pbi_start_tvusec,
        uid: info.pbi_uid,
    };
    if identity.pid != pid || identity.pgid <= 0 {
        return Err("The production capture process identity changed while reading.".to_owned());
    }
    Ok(Some(identity))
}

fn same_process(left: &ProcessIdentity, right: &ProcessIdentity) -> bool {
    left.pid == right.pid
        && left.start_seconds == right.start_seconds
        && left.start_microseconds == right.start_microseconds
        && left.uid == right.uid
}

fn validate_root_owner(root: &ProcessIdentity) -> Result<(), String> {
    if root.uid != unsafe { libc::geteuid() } {
        return Err("The production capture root process owner changed.".to_owned());
    }
    Ok(())
}

fn process_start_time_millis(identity: &ProcessIdentity) -> Result<i64, String> {
    if identity.start_microseconds >= 1_000_000 {
        return Err("The production capture root process start identity is invalid.".to_owned());
    }
    let millis = u128::from(identity.start_seconds)
        .checked_mul(1_000)
        .and_then(|seconds| {
            seconds.checked_add((u128::from(identity.start_microseconds) + 500) / 1_000)
        })
        .ok_or_else(|| {
            "The production capture root process start identity exceeded its bound.".to_owned()
        })?;
    i64::try_from(millis).map_err(|_| {
        "The production capture root process start identity exceeded its bound.".to_owned()
    })
}

fn observe_child_exit_without_reaping(child: &Child) -> io::Result<bool> {
    loop {
        let mut information = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                child.id(),
                information.as_mut_ptr(),
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        if result == 0 {
            let information = unsafe { information.assume_init() };
            return Ok(unsafe { information.si_pid() } != 0);
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

fn retain_cleanup_failure(failures: &mut Vec<String>, failure: String) {
    if failures.len() < MAX_CLEANUP_FAILURES && !failures.contains(&failure) {
        failures.push(failure);
    }
}

fn cleanup_failure_message(failures: &[String]) -> String {
    if failures.is_empty() {
        "The production capture cleanup proof is incomplete.".to_owned()
    } else {
        format!(
            "The production capture cleanup proof failed: {}",
            failures.join(" ")
        )
    }
}

fn kill_exact_root_best_effort(
    child: &mut Child,
    root_kill_authorized: bool,
    root_reaped: &mut bool,
    failures: &mut Vec<String>,
) {
    if *root_reaped || !root_kill_authorized {
        return;
    }
    let may_kill = match child.try_wait() {
        Ok(Some(_)) => {
            *root_reaped = true;
            return;
        }
        Ok(None) => true,
        Err(error) => {
            retain_cleanup_failure(
                failures,
                format!("The exact production capture root status failed before KILL: {error}."),
            );
            false
        }
    };
    if !may_kill {
        return;
    }
    if let Err(error) = child.kill() {
        retain_cleanup_failure(
            failures,
            format!("The exact production capture root KILL failed: {error}."),
        );
    }
}

fn signal_groups_best_effort(groups: &BTreeSet<i32>, signal: i32, failures: &mut Vec<String>) {
    for pgid in groups {
        if unsafe { libc::kill(-pgid, signal) } == 0 {
            continue;
        }
        // macOS may report EPERM after every authorized member became a zombie between
        // validation and delivery. The next bounded loop revalidates the group and still
        // fails closed if a live or foreign member remains.
        if !matches!(
            io::Error::last_os_error().raw_os_error(),
            Some(code) if code == libc::ESRCH || code == libc::EPERM
        ) {
            retain_cleanup_failure(
                failures,
                format!("Exact production capture group {pgid} could not receive signal {signal}."),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        env, fs,
        os::unix::process::CommandExt,
        path::{Path, PathBuf},
        process::{Child, Command, Stdio},
        thread,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn node_path() -> PathBuf {
        env::split_paths(&env::var_os("PATH").expect("PATH"))
            .map(|directory| directory.join("node"))
            .find(|candidate| candidate.is_file())
            .expect("node executable")
    }

    fn group_alive(pgid: i32) -> bool {
        (unsafe { libc::kill(-pgid, 0) }) == 0
    }

    fn unique_test_directory(label: &str) -> PathBuf {
        env::temp_dir().join(format!(
            "codevo-ledger-test-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ))
    }

    fn wait_for_file(path: &Path) -> String {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Ok(value) = fs::read_to_string(path) {
                return value;
            }
            assert!(Instant::now() < deadline, "timed out waiting for {path:?}");
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn capture_expected_root(pid: i32) -> ExpectedRootProcessIdentity {
        let identity = read_process_identity(pid)
            .expect("read root identity")
            .expect("live root identity");
        let launch_time_millis =
            process_start_time_millis(&identity).expect("root start time millis");
        ExpectedRootProcessIdentity::capture(pid, launch_time_millis)
            .expect("capture root identity")
    }

    struct GroupChild {
        child: Option<Child>,
        pgid: i32,
        additional_group_ids: Vec<i32>,
    }

    impl GroupChild {
        fn track_group(&mut self, pgid: i32) {
            self.additional_group_ids.push(pgid);
        }

        fn reap_and_disarm(&mut self) {
            if let Some(mut child) = self.child.take() {
                child.wait().expect("reap exact group leader");
            }
            self.pgid = 0;
        }
    }

    impl Drop for GroupChild {
        fn drop(&mut self) {
            if self.pgid > 0 && group_alive(self.pgid) {
                unsafe { libc::kill(-self.pgid, libc::SIGKILL) };
            }
            for pgid in self.additional_group_ids.drain(..) {
                if pgid > 0 && group_alive(pgid) {
                    unsafe { libc::kill(-pgid, libc::SIGKILL) };
                }
            }
            if let Some(mut child) = self.child.take() {
                let _ = child.wait();
            }
        }
    }

    #[test]
    fn stable_identity_ignores_parent_and_group_migration() {
        let original = ProcessIdentity {
            pid: 41,
            ppid: 7,
            pgid: 41,
            start_seconds: 13,
            start_microseconds: 17,
            uid: 23,
        };
        let migrated = ProcessIdentity {
            ppid: 1,
            pgid: 59,
            ..original
        };
        assert!(same_process(&original, &migrated));
    }

    #[test]
    fn stable_identity_rejects_a_reused_pid() {
        let original = ProcessIdentity {
            pid: 41,
            ppid: 7,
            pgid: 41,
            start_seconds: 13,
            start_microseconds: 17,
            uid: 23,
        };
        let reused = ProcessIdentity {
            start_microseconds: 18,
            ..original
        };
        assert!(!same_process(&original, &reused));
    }

    #[test]
    fn a_reused_descendant_pid_is_admitted_as_a_new_bounded_identity() {
        let original = ProcessIdentity {
            pid: 41,
            ppid: 7,
            pgid: 41,
            start_seconds: 13,
            start_microseconds: 17,
            uid: 23,
        };
        let reused_descendant = ProcessIdentity {
            ppid: 11,
            pgid: 59,
            start_microseconds: 18,
            ..original
        };
        let mut ledger = OwnedProcessLedger {
            owned: vec![original],
            observed_groups: BTreeSet::from([original.pgid]),
            root_pid: original.pid,
            root_pgid: original.pgid,
            uid: original.uid,
            terminal_proven: false,
            cleanup_finalized: None,
            injected_cleanup_observe_failure: None,
        };
        assert!(ledger
            .admit_child_identity(11, reused_descendant)
            .expect("admit reused descendant PID"));
        assert_eq!(ledger.owned.len(), 2);
        assert!(ledger.observed_groups.contains(&reused_descendant.pgid));
    }

    #[test]
    fn capture_rejects_a_kernel_start_that_does_not_match_launch_services() {
        let mut command = Command::new("/bin/sleep");
        command
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let child = command.spawn().expect("spawn identity fixture");
        let pid = i32::try_from(child.id()).expect("fixture pid");
        let child = GroupChild {
            child: Some(child),
            pgid: pid,
            additional_group_ids: Vec::new(),
        };
        let identity = read_process_identity(pid)
            .expect("read fixture identity")
            .expect("live fixture identity");
        let wrong_launch_time = process_start_time_millis(&identity)
            .expect("fixture start time")
            .saturating_add(2);
        assert!(ExpectedRootProcessIdentity::capture(pid, wrong_launch_time).is_err());
        drop(child);
    }

    #[test]
    fn direct_capture_binds_kernel_start_and_rejects_a_reused_pid_identity() {
        let mut command = Command::new("/bin/sleep");
        command
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let mut child = command.spawn().expect("spawn direct identity fixture");
        let pid = i32::try_from(child.id()).expect("direct fixture pid");
        let expected = ExpectedRootProcessIdentity::capture_direct(&mut child)
            .expect("capture direct identity");
        let mut child = GroupChild {
            child: Some(child),
            pgid: pid,
            additional_group_ids: Vec::new(),
        };
        assert_eq!(
            expected.start_time_millis(),
            process_start_time_millis(&expected.process).expect("direct kernel start")
        );
        assert!(expected
            .owns_expected_process_group()
            .expect("revalidate direct identity"));
        let reused = ProcessIdentity {
            start_seconds: expected.process.start_seconds.saturating_add(1),
            ..expected.process
        };
        assert!(expected.validate_current_identity(reused).is_err());
        let mut ledger = OwnedProcessLedger::new_unobserved(expected)
            .expect("construct direct ledger before observation");
        assert_eq!(ledger.owned.len(), 1);
        ledger.observe().expect("observe direct ledger");
        ledger
            .terminate_and_prove_with_reaper(child.child.as_mut().expect("direct fixture reaper"))
            .expect("clean direct fixture");
        assert!(ledger.is_terminal_proven());
        assert!(ledger.is_cleanup_finalized());
        ledger
            .terminate_and_prove_with_reaper(
                child
                    .child
                    .as_mut()
                    .expect("repeated direct fixture reaper"),
            )
            .expect("repeat proven cleanup idempotently");
        child.reap_and_disarm();
    }

    #[test]
    fn direct_capture_rejects_a_reaped_child_before_pid_reuse_can_be_admitted() {
        let mut command = Command::new("/usr/bin/true");
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let mut child = command.spawn().expect("spawn short-lived direct fixture");
        child.wait().expect("reap short-lived direct fixture");
        assert!(ExpectedRootProcessIdentity::capture_direct(&mut child).is_err());
    }

    #[test]
    fn exact_root_kill_is_revoked_after_external_reaping_reports_echild() {
        let mut command = Command::new("/bin/sleep");
        command
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let mut child = command.spawn().expect("spawn externally reaped fixture");
        let pid = i32::try_from(child.id()).expect("externally reaped fixture pid");
        assert_eq!(unsafe { libc::kill(pid, libc::SIGKILL) }, 0);
        let mut status = 0;
        assert_eq!(unsafe { libc::waitpid(pid, &mut status, 0) }, pid);
        let mut root_reaped = false;
        let mut failures = Vec::new();
        kill_exact_root_best_effort(&mut child, true, &mut root_reaped, &mut failures);
        assert!(!root_reaped);
        assert_eq!(failures.len(), 1);
        assert!(failures[0].contains("status failed before KILL"));
    }

    #[test]
    #[ignore = "subprocess helper for the real process-group migration tests"]
    fn migration_process_helper() {
        let Some(ready_path) = env::var_os("CODEVO_LEDGER_MIGRATION_READY") else {
            return;
        };
        let trigger_path = PathBuf::from(
            env::var_os("CODEVO_LEDGER_MIGRATION_TRIGGER").expect("migration trigger path"),
        );
        let ack_path =
            PathBuf::from(env::var_os("CODEVO_LEDGER_MIGRATION_ACK").expect("migration ack path"));
        let action = env::var("CODEVO_LEDGER_MIGRATION_ACTION").expect("migration action");
        if action.ends_with("-ignore-term") {
            unsafe { libc::signal(libc::SIGTERM, libc::SIG_IGN) };
        }
        fs::write(ready_path, b"ready").expect("publish migration readiness");
        wait_for_file(&trigger_path);
        let result = match action.as_str() {
            "setpgid" => unsafe { libc::setpgid(0, 0) },
            "setsid" | "setsid-ignore-term" => {
                let session = unsafe { libc::setsid() };
                if session < 0 {
                    -1
                } else {
                    0
                }
            }
            _ => panic!("unsupported migration action"),
        };
        assert_eq!(result, 0, "process-group migration failed");
        fs::write(ack_path, b"migrated").expect("publish migration acknowledgment");
        loop {
            thread::sleep(Duration::from_secs(1));
        }
    }

    #[test]
    #[ignore = "subprocess helper for the real process-group migration tests"]
    fn migration_root_helper() {
        let Some(child_pid_path) = env::var_os("CODEVO_LEDGER_MIGRATION_CHILD_PID") else {
            return;
        };
        let mut child = Command::new(env::current_exe().expect("test executable"));
        child
            .args([
                "--exact",
                "process_ledger::tests::migration_process_helper",
                "--ignored",
                "--nocapture",
            ])
            .env(
                "CODEVO_LEDGER_MIGRATION_READY",
                env::var_os("CODEVO_LEDGER_MIGRATION_READY").expect("migration ready path"),
            )
            .env(
                "CODEVO_LEDGER_MIGRATION_TRIGGER",
                env::var_os("CODEVO_LEDGER_MIGRATION_TRIGGER").expect("migration trigger path"),
            )
            .env(
                "CODEVO_LEDGER_MIGRATION_ACK",
                env::var_os("CODEVO_LEDGER_MIGRATION_ACK").expect("migration ack path"),
            )
            .env(
                "CODEVO_LEDGER_MIGRATION_ACTION",
                env::var_os("CODEVO_LEDGER_MIGRATION_ACTION").expect("migration action"),
            )
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = child.spawn().expect("spawn migration child");
        fs::write(child_pid_path, child.id().to_string()).expect("publish migration child PID");
        if let Some(exit_trigger) = env::var_os("CODEVO_LEDGER_ROOT_EXIT_TRIGGER") {
            wait_for_file(Path::new(&exit_trigger));
            drop(child);
            return;
        }
        child.wait().expect("wait for migration child");
    }

    fn assert_samples_migration_and_reparent_during_slow_verification(action: &str) {
        const SAMPLE_INTERVAL: Duration = Duration::from_millis(100);
        const VERIFICATION_SAMPLES: usize = 12;

        let directory = unique_test_directory(&format!("slow-verification-{action}"));
        fs::create_dir(&directory).expect("create slow verification directory");
        let child_pid_path = directory.join("child-pid");
        let ready_path = directory.join("ready");
        let migration_trigger_path = directory.join("migration-trigger");
        let migration_ack_path = directory.join("migration-ack");
        let root_exit_trigger_path = directory.join("root-exit-trigger");
        let mut command = Command::new(env::current_exe().expect("test executable"));
        command
            .args([
                "--exact",
                "process_ledger::tests::migration_root_helper",
                "--ignored",
                "--nocapture",
            ])
            .env("CODEVO_LEDGER_MIGRATION_CHILD_PID", &child_pid_path)
            .env("CODEVO_LEDGER_MIGRATION_READY", &ready_path)
            .env("CODEVO_LEDGER_MIGRATION_TRIGGER", &migration_trigger_path)
            .env("CODEVO_LEDGER_MIGRATION_ACK", &migration_ack_path)
            .env("CODEVO_LEDGER_MIGRATION_ACTION", action)
            .env("CODEVO_LEDGER_ROOT_EXIT_TRIGGER", &root_exit_trigger_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let mut root_process = command.spawn().expect("spawn slow verification root");
        let root_pid = i32::try_from(root_process.id()).expect("slow verification root pid");
        let expected = ExpectedRootProcessIdentity::capture_direct(&mut root_process)
            .expect("capture slow verification root");
        let mut ledger =
            OwnedProcessLedger::new(expected).expect("create slow verification ledger");
        let mut root = GroupChild {
            child: Some(root_process),
            pgid: root_pid,
            additional_group_ids: Vec::new(),
        };
        let child_pid = wait_for_file(&child_pid_path)
            .parse::<i32>()
            .expect("slow verification child pid");
        wait_for_file(&ready_path);
        root.track_group(child_pid);

        let mut last_sample = Instant::now();
        let mut migration_triggered = false;
        let mut root_exit_triggered = false;
        for sample in 0..VERIFICATION_SAMPLES {
            let now = Instant::now();
            assert!(
                now.duration_since(last_sample) <= Duration::from_millis(500),
                "process ledger sampling exceeded the production bound"
            );
            ledger.observe().expect("sample slow verification tree");
            last_sample = now;
            if sample == 3 {
                assert!(ledger.contains_pid(child_pid), "child was not admitted");
                fs::write(&migration_trigger_path, b"migrate")
                    .expect("trigger slow verification migration");
                migration_triggered = true;
            }
            if migration_triggered && !root_exit_triggered && migration_ack_path.is_file() {
                fs::write(&root_exit_trigger_path, b"exit")
                    .expect("trigger slow verification root exit");
                root_exit_triggered = true;
            }
            thread::sleep(SAMPLE_INTERVAL);
        }

        assert!(
            migration_ack_path.is_file(),
            "child did not acknowledge migration"
        );
        assert!(
            root_exit_triggered,
            "root exit was not triggered after migration"
        );
        let exit_deadline = Instant::now() + Duration::from_secs(5);
        loop {
            ledger.observe().expect("sample while awaiting reparenting");
            if observe_child_exit_without_reaping(
                root.child.as_ref().expect("slow verification root handle"),
            )
            .expect("observe slow verification root exit")
            {
                break;
            }
            assert!(
                Instant::now() < exit_deadline,
                "root did not exit during slow verification"
            );
            thread::sleep(SAMPLE_INTERVAL);
        }
        let reparent_deadline = Instant::now() + Duration::from_secs(5);
        let child_identity = loop {
            ledger.observe().expect("sample reparented child");
            let identity = read_process_identity(child_pid)
                .expect("read reparented child identity")
                .expect("live reparented child identity");
            if identity.ppid != root_pid {
                break identity;
            }
            assert!(
                Instant::now() < reparent_deadline,
                "child did not reparent during slow verification"
            );
            thread::sleep(SAMPLE_INTERVAL);
        };
        assert_ne!(child_identity.ppid, root_pid, "child was not reparented");
        assert_eq!(
            child_identity.pgid, child_pid,
            "child did not migrate groups"
        );
        assert!(ledger.observed_group_ids().contains(&child_pid));
        ledger
            .terminate_and_prove_with_reaper(
                root.child.as_mut().expect("slow verification root reaper"),
            )
            .expect("clean sampled migrated and reparented child");
        root.reap_and_disarm();
        root.additional_group_ids.clear();
        assert!(!group_alive(child_pid), "reparented child survived cleanup");
        fs::remove_dir_all(&directory).expect("remove slow verification directory");
    }

    #[test]
    fn ledger_samples_setpgid_and_reparent_during_slow_verification() {
        assert_samples_migration_and_reparent_during_slow_verification("setpgid");
    }

    #[test]
    fn ledger_samples_setsid_and_reparent_during_slow_verification() {
        assert_samples_migration_and_reparent_during_slow_verification("setsid");
    }

    fn assert_tracks_real_group_migration(action: &str, inject_cleanup_failure: bool) {
        let directory = unique_test_directory(action);
        fs::create_dir(&directory).expect("create migration directory");
        let child_pid_path = directory.join("child-pid");
        let ready_path = directory.join("ready");
        let trigger_path = directory.join("trigger");
        let ack_path = directory.join("ack");
        let mut command = Command::new(env::current_exe().expect("test executable"));
        command
            .args([
                "--exact",
                "process_ledger::tests::migration_root_helper",
                "--ignored",
                "--nocapture",
            ])
            .env("CODEVO_LEDGER_MIGRATION_CHILD_PID", &child_pid_path)
            .env("CODEVO_LEDGER_MIGRATION_READY", &ready_path)
            .env("CODEVO_LEDGER_MIGRATION_TRIGGER", &trigger_path)
            .env("CODEVO_LEDGER_MIGRATION_ACK", &ack_path)
            .env("CODEVO_LEDGER_MIGRATION_ACTION", action)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let root = command.spawn().expect("spawn migration root");
        let root_pid = i32::try_from(root.id()).expect("root pid");
        let mut root = GroupChild {
            child: Some(root),
            pgid: root_pid,
            additional_group_ids: Vec::new(),
        };
        let expected = capture_expected_root(root_pid);
        let mut ledger = OwnedProcessLedger::new(expected).expect("create exact ledger");
        let child_pid = wait_for_file(&child_pid_path)
            .parse::<i32>()
            .expect("migration child PID");
        wait_for_file(&ready_path);
        for _ in 0..100 {
            ledger.observe().expect("admit migration child");
            if ledger.contains_pid(child_pid) {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(ledger.contains_pid(child_pid));
        fs::write(&trigger_path, b"migrate").expect("trigger process-group migration");
        wait_for_file(&ack_path);
        ledger.observe().expect("observe migrated process");
        assert!(ledger.contains_pid(child_pid));
        assert!(ledger.observed_group_ids().contains(&child_pid));
        root.track_group(child_pid);
        ledger
            .require_capture_separate_group_observed()
            .expect("retain migrated group");
        if inject_cleanup_failure {
            ledger.injected_cleanup_observe_failure =
                Some("injected bounded observation failure".to_owned());
        }
        let cleanup = ledger.terminate_and_prove_with_reaper(
            root.child.as_mut().expect("owned migration root reaper"),
        );
        if inject_cleanup_failure {
            let original_error = cleanup.expect_err("injected cleanup failure was not reported");
            assert!(ledger.is_cleanup_finalized());
            assert!(!ledger.is_terminal_proven());
            let repeated_error = ledger
                .terminate_and_prove_with_reaper(
                    root.child.as_mut().expect("repeated failed cleanup reaper"),
                )
                .expect_err("repeated failed cleanup lost its original error");
            assert_eq!(repeated_error, original_error);
        } else {
            cleanup.expect("clean all observed owned groups");
        }
        root.reap_and_disarm();
        root.additional_group_ids.clear();
        assert!(!group_alive(child_pid), "migrated group survived cleanup");
        let mut status = 0;
        assert_eq!(
            unsafe { libc::waitpid(root_pid, &mut status, libc::WNOHANG) },
            -1
        );
        assert_eq!(
            io::Error::last_os_error().raw_os_error(),
            Some(libc::ECHILD)
        );
        fs::remove_dir_all(&directory).expect("remove migration directory");
    }

    #[test]
    fn ledger_tracks_a_real_setpgid_migration() {
        assert_tracks_real_group_migration("setpgid", false);
    }

    #[test]
    fn ledger_tracks_a_real_setsid_migration() {
        assert_tracks_real_group_migration("setsid", false);
    }

    #[test]
    fn ledger_escalates_and_reaps_a_term_resistant_migrated_child() {
        assert_tracks_real_group_migration("setsid-ignore-term", false);
    }

    #[test]
    fn cleanup_reports_observation_failure_after_killing_and_reaping_term_resistant_groups() {
        assert_tracks_real_group_migration("setsid-ignore-term", true);
    }

    #[test]
    fn capture_invariant_rejects_a_root_without_a_separate_group() {
        let mut command = Command::new("/bin/sleep");
        command
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let child = command.spawn().expect("spawn root-only group");
        let pgid = i32::try_from(child.id()).expect("root pid");
        let root = GroupChild {
            child: Some(child),
            pgid,
            additional_group_ids: Vec::new(),
        };
        let expected = capture_expected_root(pgid);
        let ledger = OwnedProcessLedger::new(expected).expect("root-only ledger");
        assert!(ledger.require_capture_separate_group_observed().is_err());
        drop(root);
    }

    #[test]
    fn cleanup_rejects_a_reaper_for_a_different_child_before_signalling() {
        let mut root_command = Command::new("/bin/sleep");
        root_command
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let mut root_process = root_command.spawn().expect("spawn exact cleanup root");
        let root_pid = i32::try_from(root_process.id()).expect("cleanup root pid");
        let expected = ExpectedRootProcessIdentity::capture_direct(&mut root_process)
            .expect("capture cleanup root");
        let mut ledger = OwnedProcessLedger::new(expected).expect("create cleanup ledger");
        let root = GroupChild {
            child: Some(root_process),
            pgid: root_pid,
            additional_group_ids: Vec::new(),
        };

        let mut foreign_command = Command::new("/bin/sleep");
        foreign_command
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let foreign_process = foreign_command.spawn().expect("spawn foreign reaper child");
        let foreign_pid = i32::try_from(foreign_process.id()).expect("foreign reaper pid");
        let mut foreign = GroupChild {
            child: Some(foreign_process),
            pgid: foreign_pid,
            additional_group_ids: Vec::new(),
        };

        assert!(ledger
            .terminate_and_prove_with_reaper(foreign.child.as_mut().expect("foreign reaper handle"))
            .is_err());
        assert!(group_alive(root_pid), "exact root was signalled");
        assert!(group_alive(foreign_pid), "foreign reaper was signalled");
        drop(foreign);
        drop(root);
    }

    #[test]
    fn ledger_tracks_reparented_separate_group_and_preserves_foreign_sibling() {
        let ready = env::temp_dir().join(format!(
            "codevo-ledger-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let script = format!(
            "const{{spawn}}=require('node:child_process');const{{writeFileSync}}=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{{}},1000)'],{{detached:true,stdio:'ignore'}});writeFileSync({},String(c.pid));setInterval(()=>{{}},1000)",
            serde_json::to_string(&ready).expect("path JSON")
        );
        let mut root_command = Command::new(node_path());
        root_command
            .args(["-e", &script])
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let root = root_command.spawn().expect("spawn ledger root");
        let root_pid = i32::try_from(root.id()).expect("root pid");
        let mut root = GroupChild {
            child: Some(root),
            pgid: root_pid,
            additional_group_ids: Vec::new(),
        };
        let mut foreign_command = Command::new("/bin/sleep");
        foreign_command
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let foreign = foreign_command.spawn().expect("spawn foreign group");
        let foreign_pgid = i32::try_from(foreign.id()).expect("foreign pid");
        let foreign = GroupChild {
            child: Some(foreign),
            pgid: foreign_pgid,
            additional_group_ids: Vec::new(),
        };
        let expected = capture_expected_root(root_pid);
        let mut ledger = OwnedProcessLedger::new(expected).expect("create exact ledger");
        let ready_deadline = Instant::now() + Duration::from_secs(5);
        let child_pid = loop {
            if let Ok(raw) = fs::read_to_string(&ready) {
                break raw.parse::<i32>().expect("child pid");
            }
            assert!(
                Instant::now() < ready_deadline,
                "timed out waiting for child pid"
            );
            thread::sleep(Duration::from_millis(10));
        };
        root.track_group(child_pid);
        for _ in 0..100 {
            ledger.observe().expect("observe descendants");
            if ledger.contains_pid(child_pid) {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(ledger.contains_pid(child_pid));
        ledger
            .require_capture_separate_group_observed()
            .expect("separate group invariant");
        unsafe { libc::kill(-root_pid, libc::SIGKILL) };
        root.reap_and_disarm();
        ledger.observe().expect("retain reparented identity");
        ledger
            .terminate_and_prove()
            .expect("clean exact owned groups");
        root.additional_group_ids.clear();
        assert!(group_alive(foreign_pgid), "foreign group was touched");
        let _ = fs::remove_file(ready);
        drop(foreign);
    }
}
