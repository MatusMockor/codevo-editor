use super::*;
use std::{
    cell::Cell,
    collections::HashMap,
    ffi::OsStr,
    sync::atomic::{AtomicU64, Ordering},
};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "codevo-clone-ssh-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(path.join("home")).unwrap();
        std::fs::create_dir_all(path.join("parent")).unwrap();
        Self(std::fs::canonicalize(path).unwrap())
    }
    fn environment(&self, global_config: &str) -> GitEnvironment {
        let config = self.0.join("gitconfig");
        std::fs::write(&config, global_config).unwrap();
        GitEnvironment::new(
            self.0.join("home"),
            std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".into()),
            vec![
                ("GIT_CONFIG_GLOBAL", config.into_os_string()),
                ("GIT_CONFIG_SYSTEM", OsString::from("/dev/null")),
            ],
        )
    }
    fn destination(&self) -> Destination {
        Destination::reserve_under(
            self.0.join("parent").to_str().unwrap(),
            "repo",
            false,
            Some(&self.0.join("home")),
        )
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn environment_of(command: &Command) -> HashMap<String, Option<String>> {
    command
        .get_envs()
        .map(|(key, value)| {
            (
                key.to_string_lossy().into_owned(),
                value.map(|value| value.to_string_lossy().into_owned()),
            )
        })
        .collect()
}

fn variables(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
    let pairs: HashMap<String, OsString> = pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), OsString::from(value)))
        .collect();
    move |key| pairs.get(key).cloned()
}

#[test]
fn inherited_ssh_environment_wins_without_querying_configuration() {
    for key in ["GIT_SSH_COMMAND", "GIT_SSH"] {
        let queried = Cell::new(false);
        let transport = SshTransport::select(variables(&[(key, "my-ssh")]), || {
            queried.set(true);
            true
        });
        assert_eq!(
            transport,
            SshTransport::UserEnvironment(vec![(key, OsString::from("my-ssh"))])
        );
        assert!(!queried.get());
    }
}

#[test]
fn configured_ssh_command_is_preserved_and_batch_mode_is_only_a_fallback() {
    let empty = variables(&[("GIT_SSH_COMMAND", ""), ("GIT_SSH_VARIANT", "ssh")]);
    assert_eq!(
        SshTransport::select(&empty, || true),
        SshTransport::UserConfiguration
    );
    assert_eq!(SshTransport::select(&empty, || false), SshTransport::Batch);
}

#[test]
fn applied_transport_never_overrides_a_user_ssh_command() {
    let mut configured = Command::new("git");
    SshTransport::UserConfiguration.apply(&mut configured);
    let configured = environment_of(&configured);
    assert!(!configured.contains_key("GIT_SSH_COMMAND"));
    assert_eq!(configured["SSH_ASKPASS_REQUIRE"].as_deref(), Some("never"));

    let mut inherited = Command::new("git");
    SshTransport::UserEnvironment(vec![("GIT_SSH", OsString::from("/opt/ssh-wrapper"))])
        .apply(&mut inherited);
    let inherited = environment_of(&inherited);
    assert!(!inherited.contains_key("GIT_SSH_COMMAND"));
    assert_eq!(inherited["GIT_SSH"].as_deref(), Some("/opt/ssh-wrapper"));
    assert_eq!(inherited["SSH_ASKPASS_REQUIRE"].as_deref(), Some("never"));

    let mut batch = Command::new("git");
    SshTransport::Batch.apply(&mut batch);
    assert_eq!(
        environment_of(&batch)["GIT_SSH_COMMAND"].as_deref(),
        Some(BATCH_SSH_COMMAND)
    );
}

#[test]
fn configuration_query_reads_global_ssh_command_without_network() {
    let fixture = Fixture::new();
    let destination = fixture.destination();
    let kill = ProcessKillSwitch::default();
    let configured = fixture.environment("[core]\n\tsshCommand = ssh -i ~/.ssh/work\n");
    assert!(configured.user_configures_ssh_command(&destination, &kill));
    let unconfigured = fixture.environment("[user]\n\tname = Someone\n");
    assert!(!unconfigured.user_configures_ssh_command(&destination, &kill));
}

#[test]
fn configuration_query_ignores_an_enclosing_repository() {
    let fixture = Fixture::new();
    let parent = fixture.0.join("parent");
    assert!(Command::new("git")
        .args(["init", "--quiet"])
        .arg(&parent)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .unwrap()
        .success());
    assert!(Command::new("git")
        .arg("-C")
        .arg(&parent)
        .args(["config", "core.sshCommand", "ssh -i enclosing"])
        .status()
        .unwrap()
        .success());
    let destination = fixture.destination();
    let environment = fixture.environment("");
    assert!(!environment.user_configures_ssh_command(&destination, &ProcessKillSwitch::default()));
    assert!(environment_of(&environment.command(&[]))
        .get("GIT_CONFIG_SYSTEM")
        .is_some_and(|value| value.as_deref().map(OsStr::new) == Some(OsStr::new("/dev/null"))));
}
