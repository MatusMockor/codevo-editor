use std::{
    io::ErrorKind,
    net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener, TcpStream},
    time::Duration,
};

const PROBE_TIMEOUT: Duration = Duration::from_millis(200);
const MIN_LOCAL_PORT: u16 = 1024;

pub(super) fn ephemeral() -> Result<u16, String> {
    let unavailable = || "No free local port is available for forwarding.".to_string();
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|_| unavailable())?;
    let port = listener.local_addr().map_err(|_| unavailable())?.port();
    if port < MIN_LOCAL_PORT {
        return Err(unavailable());
    }
    Ok(port)
}

pub(super) fn accepting(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        PROBE_TIMEOUT,
    )
    .is_ok()
}

pub(super) fn occupied(port: u16) -> bool {
    accepting(port) || TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_err()
}

pub(super) fn available(port: u16) -> bool {
    port >= MIN_LOCAL_PORT
        && !occupied(port)
        && TcpStream::connect_timeout(
            &SocketAddr::from((Ipv6Addr::LOCALHOST, port)),
            PROBE_TIMEOUT,
        )
        .is_err()
        && match TcpListener::bind((Ipv6Addr::LOCALHOST, port)) {
            Ok(_) => true,
            Err(error) => error.kind() == ErrorKind::AddrNotAvailable,
        }
}
