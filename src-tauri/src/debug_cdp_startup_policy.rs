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
