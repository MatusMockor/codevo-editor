use super::super::gitlab;
use super::super::wire::{RepositoryHostName, RepositoryInfo};

const REQUESTED_HOST: &str = "gitlab.example.com";

const FOREIGN_SSH_URLS: [&str; 7] = [
    "ssh://git@gitlab.example.com.evil.net/platform/billing.git",
    "ssh://git@evil-gitlab.example.com/platform/billing.git",
    "ssh://git@gitlab.example.com./platform/billing.git",
    "ssh://gitlab.example.com@evil.net/platform/billing.git",
    "git@gitlab.example.com.evil.net:platform/billing.git",
    "git@evil.net:platform/billing.git",
    "git@xn--gitlb-zra.example.com:platform/billing.git",
];

const FOREIGN_HTTPS_URLS: [&str; 8] = [
    "https://gitlab.example.com.evil.net/platform/billing.git",
    "https://evil-gitlab.example.com/platform/billing.git",
    "https://gitlab.example.com./platform/billing.git",
    "https://gitlab.example.com@evil.net/platform/billing.git",
    "https://evil.net#@gitlab.example.com/platform/billing.git",
    "https://gitlab.example.com#@evil.net/platform/billing.git",
    "https://xn--gitlb-zra.example.com/platform/billing.git",
    "https://gitlab.ex\u{0430}mple.com/platform/billing.git",
];

const PINNED_URLS: [(&str, &str); 2] = [
    (
        "git@gitlab.example.com:platform/billing.git",
        "https://gitlab.example.com/platform/billing.git",
    ),
    (
        "ssh://git@gitlab.example.com:2222/platform/billing.git",
        "https://GitLab.Example.com/platform/billing.git",
    ),
];

fn parsed(ssh_url: &str, https_url: &str) -> RepositoryInfo {
    let host = RepositoryHostName::lowercased(REQUESTED_HOST).expect("host");
    let payload = format!(
        r#"{{"path_with_namespace":"platform/billing","ssh_url_to_repo":"{ssh_url}","http_url_to_repo":"{https_url}"}}"#
    );
    gitlab::parse_repository(&host, payload.as_bytes()).expect("gitlab repository")
}

#[test]
fn ssh_urls_outside_the_requested_host_are_dropped() {
    for ssh_url in FOREIGN_SSH_URLS {
        let repository = parsed(ssh_url, "https://gitlab.example.com/platform/billing.git");
        assert_eq!(repository.ssh_url, None, "{ssh_url}");
        assert!(repository.is_valid(), "{ssh_url}");
    }
}

#[test]
fn https_urls_outside_the_requested_host_are_dropped() {
    for https_url in FOREIGN_HTTPS_URLS {
        let repository = parsed(
            "ssh://git@gitlab.example.com/platform/billing.git",
            https_url,
        );
        assert_eq!(repository.https_url, None, "{https_url}");
        assert!(repository.is_valid(), "{https_url}");
    }
}

#[test]
fn clone_urls_on_the_requested_host_survive_scp_ssh_port_and_casing_forms() {
    for (ssh_url, https_url) in PINNED_URLS {
        let repository = parsed(ssh_url, https_url);
        assert_eq!(repository.ssh_url.as_deref(), Some(ssh_url), "{ssh_url}");
        assert_eq!(
            repository.https_url.as_deref(),
            Some(https_url),
            "{https_url}"
        );
        assert!(repository.is_valid(), "{ssh_url}");
    }
}
