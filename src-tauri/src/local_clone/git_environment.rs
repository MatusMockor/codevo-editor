use super::{
    directory::Destination,
    process::{plan_command, run_bounded, ProcessLimits},
    process_guard::ProcessKillSwitch,
};
use std::{ffi::OsString, path::PathBuf, process::Command, time::Duration};

const BATCH_SSH_COMMAND: &str = "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes";
const USER_SSH_ENVIRONMENT: [&str; 3] = ["GIT_SSH_COMMAND", "GIT_SSH", "GIT_SSH_VARIANT"];
const PASSTHROUGH_ENVIRONMENT: [&str; 4] = [
    "SSH_AUTH_SOCK",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
    "GIT_EXEC_PATH",
];
const CONFIG_QUERY_LIMITS: ProcessLimits = ProcessLimits {
    timeout: Duration::from_secs(5),
    stdout_bytes: 4096,
    stderr_bytes: 4096,
};

pub(super) struct GitEnvironment {
    home: PathBuf,
    search_path: String,
    passthrough: Vec<(&'static str, OsString)>,
}

impl GitEnvironment {
    pub(super) fn from_process() -> Result<Self, String> {
        let home = std::env::var_os("HOME").ok_or("The home folder is unavailable.")?;
        Ok(Self {
            home: home.into(),
            search_path: std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".into()),
            passthrough: PASSTHROUGH_ENVIRONMENT
                .iter()
                .filter_map(|key| std::env::var_os(key).map(|value| (*key, value)))
                .collect(),
        })
    }

    #[cfg(test)]
    pub(super) fn new(
        home: PathBuf,
        search_path: String,
        passthrough: Vec<(&'static str, OsString)>,
    ) -> Self {
        Self {
            home,
            search_path,
            passthrough,
        }
    }

    pub(super) fn command(&self, argv: &[String]) -> Command {
        let mut command = plan_command(
            std::path::Path::new("git"),
            argv,
            &self.home,
            &self.search_path,
        );
        for (key, value) in &self.passthrough {
            command.env(key, value);
        }
        command
    }

    pub(super) fn user_configures_ssh_command(
        &self,
        destination: &Destination,
        kill: &ProcessKillSwitch,
    ) -> bool {
        let mut command = self.command(&[
            "config".into(),
            "--includes".into(),
            "--get".into(),
            "core.sshCommand".into(),
        ]);
        if let Some(parent) = std::path::Path::new(&destination.path).parent() {
            command.env("GIT_CEILING_DIRECTORIES", parent);
        }
        destination.anchor(&mut command);
        run_bounded(command, CONFIG_QUERY_LIMITS, kill, &mut |_| {}).is_ok_and(|output| {
            output.success && !String::from_utf8_lossy(&output.stdout).trim().is_empty()
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum SshTransport {
    UserEnvironment(Vec<(&'static str, OsString)>),
    UserConfiguration,
    Batch,
}

impl SshTransport {
    pub(super) fn select(
        environment: impl Fn(&str) -> Option<OsString>,
        user_configures_ssh_command: impl FnOnce() -> bool,
    ) -> Self {
        let inherited: Vec<_> = USER_SSH_ENVIRONMENT
            .iter()
            .filter_map(|key| environment(key).map(|value| (*key, value)))
            .collect();
        if inherited
            .iter()
            .any(|(key, value)| *key != "GIT_SSH_VARIANT" && !value.is_empty())
        {
            return Self::UserEnvironment(inherited);
        }
        if user_configures_ssh_command() {
            return Self::UserConfiguration;
        }
        Self::Batch
    }

    pub(super) fn apply(&self, command: &mut Command) {
        command.env("SSH_ASKPASS_REQUIRE", "never");
        match self {
            Self::UserEnvironment(inherited) => {
                for (key, value) in inherited {
                    command.env(key, value);
                }
            }
            Self::UserConfiguration => {}
            Self::Batch => {
                command.env("GIT_SSH_COMMAND", BATCH_SSH_COMMAND);
            }
        }
    }
}

#[cfg(test)]
#[path = "git_environment_tests.rs"]
mod tests;
