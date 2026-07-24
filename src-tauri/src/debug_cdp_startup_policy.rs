pub(super) fn loopback_web_socket_port(url: &str) -> Result<u16, String> {
    let remainder = url
        .strip_prefix("ws://127.0.0.1:")
        .ok_or_else(|| "Node inspector WebSocket must use IPv4 loopback.".to_string())?;
    let (port, token) = remainder
        .split_once('/')
        .ok_or_else(|| "Node inspector WebSocket URL is invalid.".to_string())?;
    if token.is_empty() {
        return Err("Node inspector WebSocket URL is invalid.".to_string());
    }
    port.parse::<u16>()
        .ok()
        .filter(|port| *port != 0)
        .ok_or_else(|| "Node inspector WebSocket port is invalid.".to_string())
}

pub(crate) fn ensure_startup_current(
    is_current: &(dyn Fn() -> bool + Send + Sync),
) -> Result<(), String> {
    if is_current() {
        Ok(())
    } else {
        Err("The workspace debugger lifecycle changed during startup.".to_string())
    }
}

pub(super) fn first_pause_seen_at_transport_open(attached: bool, stop_on_entry: bool) -> bool {
    attached || stop_on_entry
}

pub(super) fn should_arm_startup_entry_probe(stop_on_entry: bool) -> bool {
    !stop_on_entry
}

pub(super) fn should_surface_startup_entry(attached: bool, stop_on_entry: bool) -> bool {
    !attached && stop_on_entry
}

#[cfg(test)]
mod tests {
    use super::{
        first_pause_seen_at_transport_open, should_arm_startup_entry_probe,
        should_surface_startup_entry,
    };

    #[test]
    fn spawned_entry_pause_auto_resumes_by_default_and_surfaces_when_requested() {
        assert!(!first_pause_seen_at_transport_open(false, false));
        assert!(should_arm_startup_entry_probe(false));
        assert!(first_pause_seen_at_transport_open(false, true));
        assert!(!should_arm_startup_entry_probe(true));
        assert!(should_surface_startup_entry(false, true));
        assert!(!should_surface_startup_entry(false, false));
    }

    #[test]
    fn attached_sessions_never_treat_the_first_pause_as_startup_entry() {
        assert!(first_pause_seen_at_transport_open(true, false));
        assert!(first_pause_seen_at_transport_open(true, true));
        assert!(!should_surface_startup_entry(true, false));
        assert!(!should_surface_startup_entry(true, true));
    }
}
