use crate::effective_executable_environment::EffectiveExecutablePath;
use portable_pty::CommandBuilder;
use std::env;

const MAX_TERMINAL_ENV_VALUE_BYTES: usize = 64 * 1024;
const TERMINAL_INHERITED_ENV: [&str; 9] = [
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "COLORTERM",
];

pub(super) fn configure_terminal_environment(
    command: &mut CommandBuilder,
    effective_path: EffectiveExecutablePath<'_>,
) {
    let integration_zdotdir = command
        .get_env("ZDOTDIR")
        .filter(|value| value.len() <= MAX_TERMINAL_ENV_VALUE_BYTES)
        .map(ToOwned::to_owned);
    let original_zdotdir = command
        .get_env("EDITOR_ORIGINAL_ZDOTDIR")
        .filter(|value| value.len() <= MAX_TERMINAL_ENV_VALUE_BYTES)
        .map(ToOwned::to_owned);
    command.env_clear();
    for key in TERMINAL_INHERITED_ENV {
        let Ok(value) = env::var(key) else {
            continue;
        };
        if value.len() > MAX_TERMINAL_ENV_VALUE_BYTES {
            continue;
        }
        command.env(key, value);
    }
    if command.get_env("SHELL").is_none() {
        command.env("SHELL", "/bin/sh");
    }
    if let Some(value) = original_zdotdir {
        command.env("EDITOR_ORIGINAL_ZDOTDIR", value);
    }
    if let Some(value) = integration_zdotdir {
        command.env("ZDOTDIR", value);
    }
    command.env("PATH", effective_path.as_str());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        terminal::{TerminalProfile, TerminalSize},
        terminal_session::{
            command_builder, spawn_prepared_command_with_child, TerminalLaunchRequest,
        },
    };

    #[test]
    fn effective_path_overrides_only_path() {
        let profile = TerminalProfile {
            command: Some("/bin/sh".to_string()),
            id: "sh".to_string(),
            label: "sh".to_string(),
        };
        let mut command = command_builder(&profile, None);
        let effective_path =
            EffectiveExecutablePath::new("/opt/codevo/bin:/usr/bin").expect("effective path");

        configure_terminal_environment(&mut command, effective_path);

        assert_eq!(
            command.get_env("PATH").and_then(|value| value.to_str()),
            Some("/opt/codevo/bin:/usr/bin")
        );
        assert!(command.get_env("CODEVO_DISCOVERED_CLAUDE").is_none());
        assert!(command.get_env("CODEVO_DISCOVERED_CODEX").is_none());
    }

    #[test]
    fn excludes_unlisted_builder_sentinel() {
        let profile = TerminalProfile {
            command: Some("/bin/sh".to_string()),
            id: "sh".to_string(),
            label: "sh".to_string(),
        };
        let mut command = command_builder(&profile, None);
        command.env("CODEVO_SENTINEL", "must-not-leak");
        let effective_path =
            EffectiveExecutablePath::new("/opt/codevo/bin:/usr/bin").expect("effective path");

        configure_terminal_environment(&mut command, effective_path);

        assert!(command.get_env("CODEVO_SENTINEL").is_none());
        assert_eq!(
            command.get_env("PATH").and_then(|value| value.to_str()),
            Some("/opt/codevo/bin:/usr/bin")
        );
    }

    #[cfg(unix)]
    #[test]
    fn real_child_receives_path_without_sentinel_leakage() {
        let fixture =
            std::env::temp_dir().join(format!("terminal-effective-path-{}", std::process::id()));
        std::fs::create_dir_all(&fixture).expect("create fixture");
        let output_path = fixture.join("environment.txt");
        let mut command = CommandBuilder::new("/bin/sh");
        command.args([
            "-c".as_ref(),
            "printf '%s\\n%s' \"$PATH\" \"${CODEVO_SENTINEL-unset}\" > \"$1\"".as_ref(),
            "terminal-environment".as_ref(),
            output_path.as_os_str(),
        ]);
        command.env("CODEVO_SENTINEL", "must-not-leak");
        let effective_path =
            EffectiveExecutablePath::new("/opt/codevo/bin:/usr/bin").expect("effective path");
        configure_terminal_environment(&mut command, effective_path);
        let request = TerminalLaunchRequest {
            cwd: fixture.clone(),
            cwd_directory: None,
            effective_path: effective_path.as_str().to_string(),
            profile: TerminalProfile {
                command: Some("/bin/sh".to_string()),
                id: "sh".to_string(),
                label: "sh".to_string(),
            },
            shell_integration_base_dir: None,
            size: TerminalSize::default(),
        };

        let mut spawned =
            spawn_prepared_command_with_child(&request, command, || Ok(()), |child| child)
                .expect("spawn terminal fixture");
        let status = spawned.child.wait().expect("wait terminal fixture");

        assert_eq!(status.exit_code, Some(0));
        assert_eq!(
            std::fs::read_to_string(&output_path).expect("read terminal environment"),
            "/opt/codevo/bin:/usr/bin\nunset"
        );
        std::fs::remove_dir_all(fixture).expect("remove fixture");
    }
}
