use super::{tests::fixture_server, Session};
use std::io::{Read, Write};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

fn listener(session: &Session) -> std::os::unix::net::UnixListener {
    let path = session
        .process
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .socket_path();
    let listener = std::os::unix::net::UnixListener::bind(path).unwrap();
    listener.set_nonblocking(true).unwrap();
    listener
}

fn accept(listener: &std::os::unix::net::UnixListener) -> std::os::unix::net::UnixStream {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match listener.accept() {
            Ok((socket, _)) => {
                socket.set_nonblocking(false).unwrap();
                return socket;
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(5))
            }
            Err(error) => panic!("fixture accept failed: {error}"),
        }
    }
}

fn read_request(socket: &mut std::os::unix::net::UnixStream) {
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut header = Vec::new();
    loop {
        let mut byte = [0];
        socket.read_exact(&mut byte).unwrap();
        header.push(byte[0]);
        if header.ends_with(b"\r\n\r\n") {
            return;
        }
    }
}

fn respond(socket: &mut std::os::unix::net::UnixStream) {
    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}").unwrap();
}

#[test]
fn sixteen_pending_reads_do_not_reject_actions_or_block_another_server() {
    let session = Arc::new(Session::fixture());
    let bound = listener(&session);
    let (ready, received) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let fixture = std::thread::spawn(move || {
        let mut sockets = Vec::new();
        for _ in 0..16 {
            let mut socket = accept(&bound);
            read_request(&mut socket);
            sockets.push(socket);
        }
        ready.send(()).unwrap();
        // An interactive request must arrive and finish before any read is released.
        let mut action = accept(&bound);
        read_request(&mut action);
        respond(&mut action);
        released.recv_timeout(Duration::from_secs(5)).unwrap();
        for socket in &mut sockets {
            respond(socket);
        }
    });
    let reads: Vec<_> = (0..16)
        .map(|_| {
            let session = session.clone();
            std::thread::spawn(move || {
                session.request(&fixture_server(), "GET", "/v1/tasks", None, vec![])
            })
        })
        .collect();
    received.recv_timeout(Duration::from_secs(5)).unwrap();
    let other = Session::fixture();
    let other_listener = listener(&other);
    let other_fixture = std::thread::spawn(move || {
        let mut socket = accept(&other_listener);
        read_request(&mut socket);
        respond(&mut socket);
    });
    assert_eq!(
        other
            .request(&fixture_server(), "GET", "/v1/runner", None, vec![])
            .unwrap()["ok"],
        true
    );
    other_fixture.join().unwrap();
    assert_eq!(
        session
            .request(&fixture_server(), "POST", "/v1/tasks", None, vec![])
            .unwrap()["ok"],
        true
    );
    release.send(()).unwrap();
    for read in reads {
        assert_eq!(read.join().unwrap().unwrap()["ok"], true);
    }
    fixture.join().unwrap();
}

#[test]
fn close_cancels_pending_http_without_waiting_for_deadline_or_replaying() {
    let session = Arc::new(Session::fixture());
    let listener = listener(&session);
    let pid = session.pid().unwrap();
    let (ready, received) = mpsc::channel();
    let (settled, cancellation_proven) = mpsc::channel();
    let fixture = std::thread::spawn(move || {
        let mut socket = accept(&listener);
        read_request(&mut socket);
        ready.send(()).unwrap();
        // The fixture socket belongs to this thread, not the tunnel process.
        // Reqwest may retain its background HTTP connection after cancellation;
        // peer EOF therefore is not evidence of request-task settlement.
        // Withhold the response until the caller has proven prompt cancellation.
        cancellation_proven
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        assert!(
            matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    });
    let owner = session.clone();
    let pending = std::thread::spawn(move || {
        owner.request(&fixture_server(), "POST", "/v1/tasks", None, vec![])
    });
    received.recv_timeout(Duration::from_secs(5)).unwrap();
    let started = Instant::now();
    session.close();
    assert!(pending.join().unwrap().unwrap_err().contains("changed"));
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(session.pid(), None);
    assert!(!session.is_alive());
    assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ESRCH)
    );
    assert!(session
        .request(&fixture_server(), "POST", "/v1/tasks", None, vec![])
        .is_err());
    settled.send(()).unwrap();
    fixture.join().unwrap();
}
