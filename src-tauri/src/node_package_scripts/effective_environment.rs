use crate::effective_executable_environment::EffectiveExecutablePath;
use std::{env, process::Command};

const MAX_PACKAGE_ENV_VALUE_BYTES: usize = 64 * 1024;
const NODE_PACKAGE_TASK_INHERITED_ENV: [&str; 6] =
    ["HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG"];

pub(super) fn configure_node_package_environment(
    command: &mut Command,
    effective_path: EffectiveExecutablePath<'_>,
) {
    command.env_clear();
    for key in NODE_PACKAGE_TASK_INHERITED_ENV {
        let Ok(value) = env::var(key) else {
            continue;
        };
        if value.len() > MAX_PACKAGE_ENV_VALUE_BYTES {
            continue;
        }
        command.env(key, value);
    }
    command.env("PATH", effective_path.as_str());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_path_overrides_only_path() {
        let mut command = Command::new("npm");
        let effective_path =
            EffectiveExecutablePath::new("/opt/codevo/bin:/usr/bin").expect("effective path");

        configure_node_package_environment(&mut command, effective_path);

        let environment = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|value| value.to_string_lossy().into_owned()),
                )
            })
            .collect::<Vec<_>>();
        assert!(environment.iter().all(|(key, _)| {
            key == "PATH" || NODE_PACKAGE_TASK_INHERITED_ENV.contains(&key.as_str())
        }));
        assert_eq!(
            environment
                .iter()
                .find(|(key, _)| key == "PATH")
                .and_then(|(_, value)| value.as_deref()),
            Some("/opt/codevo/bin:/usr/bin")
        );
    }

    #[test]
    fn real_child_receives_path_without_sentinel_leakage() {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("printf '%s\\n%s' \"$PATH\" \"${CODEVO_SENTINEL-unset}\"")
            .env("CODEVO_SENTINEL", "must-not-leak");
        let effective_path =
            EffectiveExecutablePath::new("/opt/codevo/bin:/usr/bin").expect("effective path");

        configure_node_package_environment(&mut command, effective_path);
        let output = command.output().expect("run environment fixture");

        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).expect("utf8 output"),
            "/opt/codevo/bin:/usr/bin\nunset"
        );
    }
}
