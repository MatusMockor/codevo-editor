#[cfg(unix)]
#[path = "tunnel_socket.rs"]
mod tunnel_socket;
#[cfg(unix)]
pub(super) use tunnel_socket::DeadlineStream;
#[path = "tunnel_session.rs"]
mod tunnel_session;
#[cfg(test)]
use std::io::{Read, Write};
#[cfg(test)]
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
#[cfg(test)]
use std::time::Instant;
pub(super) use tunnel_session::Session;

const MAX_INPUT: usize = 16 * 1024 * 1024;
const MAX_OUTPUT: usize = 4 * 1024 * 1024;
const MAX_IMAGE_OUTPUT: usize = (8 * 1024 * 1024_usize).div_ceil(3) * 4 + 1024;
const TIMEOUT: Duration = Duration::from_secs(30);
static ACTIVE_REQUESTS: AtomicUsize = AtomicUsize::new(0);

struct RequestPermit<'a>(&'a AtomicUsize);

impl<'a> RequestPermit<'a> {
    fn acquire(counter: &'a AtomicUsize) -> Result<Self, String> {
        counter
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                (active < 8).then_some(active + 1)
            })
            .map(|_| Self(counter))
            .map_err(|_| "Too many runner requests. Try again shortly.".into())
    }
}

impl Drop for RequestPermit<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

fn response_limit(method: &str, path: &str) -> usize {
    let attachment = path
        .strip_prefix("/v1/attachments/")
        .and_then(|value| value.strip_suffix("/content"));
    if method == "GET"
        && (attachment.is_some_and(|value| super::types::uuid(value).is_ok())
            || super::artifacts::is_content_path(path))
    {
        MAX_IMAGE_OUTPUT
    } else {
        MAX_OUTPUT
    }
}

fn validate_destination(host: &str, username: &str) -> Result<(), String> {
    let host_valid = host
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_alphanumeric)
        && host.len() <= 253
        && host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".-".contains(&c));
    let user_valid = username
        .as_bytes()
        .first()
        .is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_')
        && username.len() <= 64
        && username
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c));
    if !host_valid || !user_valid {
        return Err("Invalid SSH host or username.".into());
    }
    Ok(())
}

#[cfg(test)]
struct OwnedProcess(Child);

#[cfg(test)]
impl Drop for OwnedProcess {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.0.id() as i32), libc::SIGKILL);
        }
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[cfg(all(test, unix))]
fn nonblocking(pipe: &impl std::os::fd::AsRawFd) -> Result<(), String> {
    let fd = pipe.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err("Unable to configure SSH connection.".into());
    }
    Ok(())
}

#[cfg(test)]
fn drain(
    reader: &mut impl Read,
    output: &mut Vec<u8>,
    retain: bool,
    limit: usize,
) -> Result<(), String> {
    let mut buffer = [0_u8; 8192];
    // Bound each pass so a noisy process cannot prevent timeout checks.
    for _ in 0..64 {
        match reader.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(count) if retain => {
                if output.len() + count > limit {
                    return Err("Runner response exceeds the output limit.".into());
                }
                output.extend_from_slice(&buffer[..count]);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return Err("Unable to read SSH response.".into()),
        }
    }
    Ok(())
}

#[cfg(test)]
fn run(command: &mut Command, input: &[u8], timeout: Duration) -> Result<Vec<u8>, String> {
    run_with_limit(command, input, timeout, MAX_OUTPUT)
}

#[cfg(unix)]
#[cfg(test)]
fn run_with_limit(
    command: &mut Command,
    input: &[u8],
    timeout: Duration,
    limit: usize,
) -> Result<Vec<u8>, String> {
    use std::os::unix::process::CommandExt;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    let mut child = OwnedProcess(
        command
            .spawn()
            .map_err(|_| "Unable to start SSH.".to_string())?,
    );
    let stdin = child.0.stdin.take().ok_or("Unable to open SSH input.")?;
    let mut stdout = child.0.stdout.take().ok_or("Unable to open SSH output.")?;
    let mut stderr = child
        .0
        .stderr
        .take()
        .ok_or("Unable to open SSH diagnostics.")?;
    nonblocking(&stdin)?;
    nonblocking(&stdout)?;
    nonblocking(&stderr)?;
    let mut stdin = Some(stdin);
    let mut written = 0;
    let mut output = Vec::new();
    let start = Instant::now();
    loop {
        if start.elapsed() >= timeout {
            return Err("SSH runner request timed out.".into());
        }
        if let Some(writer) = stdin.as_mut() {
            match writer.write(&input[written..]) {
                Ok(count) => written += count,
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) => {}
                Err(_) => return Err("Unable to send SSH request.".into()),
            }
            if written == input.len() {
                stdin = None;
            }
        }
        drain(&mut stdout, &mut output, true, limit)?;
        drain(&mut stderr, &mut Vec::new(), false, limit)?;
        if let Some(status) = child
            .0
            .try_wait()
            .map_err(|_| "Unable to wait for SSH.".to_string())?
        {
            drain(&mut stdout, &mut output, true, limit)?;
            if !status.success() {
                return Err("SSH connection failed. Check the server, SSH key, known host and runner service.".into());
            }
            return Ok(output);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(not(unix))]
#[cfg(test)]
fn run_with_limit(
    _command: &mut Command,
    _input: &[u8],
    _timeout: Duration,
    _limit: usize,
) -> Result<Vec<u8>, String> {
    Err("SSH runner connections are currently supported on macOS and Linux.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_image_content_reads_receive_the_larger_budget() {
        let path = "/v1/attachments/7389088c-29b8-4cec-9a15-e825e1fb2f66/content";
        assert_eq!(response_limit("GET", path), MAX_IMAGE_OUTPUT);
        assert_eq!(response_limit("POST", path), MAX_OUTPUT);
        assert_eq!(response_limit("GET", &format!("{path}?x=1")), MAX_OUTPUT);
        assert_eq!(
            response_limit("GET", "/v1/attachments/../content"),
            MAX_OUTPUT
        );
        assert_eq!(response_limit("GET", "/v1/tasks"), MAX_OUTPUT);
        let artifact = "/v1/tasks/7389088c-29b8-4cec-9a15-e825e1fb2f66/artifacts/7389088c-29b8-4cec-9a15-e825e1fb2f66/content";
        assert_eq!(response_limit("GET", artifact), MAX_IMAGE_OUTPUT);
        assert_eq!(response_limit("POST", artifact), MAX_OUTPUT);
        assert_eq!(
            response_limit("GET", &format!("{artifact}?token=x")),
            MAX_OUTPUT
        );
    }

    #[cfg(unix)]
    #[test]
    fn image_output_budget_is_bounded_and_preserves_large_payloads() {
        let mut command = Command::new("python3");
        command.args(["-c", "import sys;sys.stdout.write('x' * (8 * 1024 * 1024))"]);
        let output =
            run_with_limit(&mut command, b"", Duration::from_secs(10), MAX_IMAGE_OUTPUT).unwrap();
        assert_eq!(output.len(), 8 * 1024 * 1024);
        let mut command = Command::new("python3");
        command.args([
            "-c",
            "import sys;sys.stdout.write('x' * (12 * 1024 * 1024))",
        ]);
        assert!(
            run_with_limit(&mut command, b"", Duration::from_secs(10), MAX_IMAGE_OUTPUT)
                .unwrap_err()
                .contains("output limit")
        );
    }

    #[cfg(unix)]
    #[test]
    fn helper_encodes_bounded_images_and_rejects_other_media() {
        let script = r#"
import base64,contextlib,io,json,sys,unittest.mock
source=sys.stdin.read()
for media,size,ok in [('image/png',8388608,True),('image/jpeg',3,True),('text/html',3,False),('text/plain',5242880,True),('text/plain',5242881,False),('image/png',8388609,False),('image/png',0,False)]:
    class Response:
        status=200
        def read(self, limit): return b'x'*min(size,limit)
        def getheader(self,name): return media
    class Connection:
        def __init__(self,*args,**kwargs): pass
        def request(self,*args,**kwargs): pass
        def getresponse(self): return Response()
        def close(self): pass
    class Input:
        buffer=io.BytesIO(json.dumps({'method':'GET','path':'/v1/attachments/7389088c-29b8-4cec-9a15-e825e1fb2f66/content','headers':[]}).encode())
    output=io.StringIO()
    with unittest.mock.patch('sys.stdin',Input()), unittest.mock.patch('http.client.HTTPConnection',Connection), unittest.mock.patch('builtins.open',unittest.mock.mock_open(read_data='secret')), contextlib.redirect_stdout(output):
        try: exec(compile(source,'helper.py','exec'),{})
        except SystemExit: pass
    response=json.loads(output.getvalue())
    if ok:
        assert set(response['result'])=={'base64','mediaType'}
        assert response['result']['mediaType']==media
        assert base64.b64decode(response['result']['base64'],validate=True)==b'x'*size
    else: assert 'bridgeError' in response
print('verified')
"#;
        let mut command = Command::new("python3");
        command.args(["-c", script]);
        assert_eq!(
            run(
                &mut command,
                include_bytes!("helper.py"),
                Duration::from_secs(10)
            )
            .unwrap(),
            b"verified\n"
        );
    }

    #[test]
    fn destination_rejects_shell_and_option_injection() {
        for host in [
            "-oProxyCommand=x",
            "host; touch /tmp/x",
            "user@host",
            "host\n",
        ] {
            assert!(validate_destination(host, "codex").is_err());
        }
        assert!(validate_destination("192.168.1.110", "codex").is_ok());
        assert!(validate_destination("::1", "codex").is_err());
        assert!(validate_destination("host", "1user").is_err());
        assert!(validate_destination("host", "_user-1").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn helper_upload_preserves_raw_text_and_image_media() {
        let script = r#"
import base64,contextlib,io,json,sys,unittest.mock
source=sys.stdin.read()
for media,payload in [('text/plain','Long pasted text: ž🙂\n'.encode()),('image/png',b'\x89PNG\r\n\x1a\n')]:
    calls=[]
    class Response:
        status=200
        def read(self, limit): return b'{"created":true}'
    class Connection:
        def __init__(self,*args,**kwargs): pass
        def request(self,method,path,body=None,headers=None):
            calls.append((method,path,body,headers))
        def getresponse(self): return Response()
        def close(self): pass
    path='/v1/attachments/7389088c-29b8-4cec-9a15-e825e1fb2f66'
    class Input:
        buffer=io.BytesIO(json.dumps({'method':'PUT','path':path,
            'headers':[['content-type',media],['x-file-name','pasted-text.txt']],
            'body':{'base64':base64.b64encode(payload).decode()}}).encode())
    output=io.StringIO()
    with unittest.mock.patch('sys.stdin',Input()), unittest.mock.patch('http.client.HTTPConnection',Connection), unittest.mock.patch('builtins.open',unittest.mock.mock_open(read_data='secret')), contextlib.redirect_stdout(output):
        exec(compile(source,'helper.py','exec'),{})
    assert len(calls)==1
    method,actual_path,body,headers=calls[0]
    assert (method,actual_path,body)==('PUT',path,payload)
    assert headers['content-type']==media
    assert headers['x-file-name']=='pasted-text.txt'
    assert json.loads(output.getvalue())=={'result':{'created':True}}
print('verified')
"#;
        let mut command = Command::new("python3");
        command.args(["-c", script]);
        assert_eq!(
            run(
                &mut command,
                include_bytes!("helper.py"),
                Duration::from_secs(3)
            )
            .unwrap(),
            b"verified\n"
        );
    }

    #[test]
    fn request_permit_caps_concurrency_and_releases_on_unwind() {
        let counter = AtomicUsize::new(0);
        let permits: Vec<_> = (0..8)
            .map(|_| RequestPermit::acquire(&counter).unwrap())
            .collect();
        assert!(RequestPermit::acquire(&counter).is_err());
        drop(permits);
        let _ = std::panic::catch_unwind(|| {
            let _permit = RequestPermit::acquire(&counter).unwrap();
            panic!("exercise permit cleanup");
        });
        assert_eq!(counter.load(Ordering::Acquire), 0);
        assert!(RequestPermit::acquire(&counter).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn subprocess_is_bounded_and_discards_diagnostics() {
        let mut command = Command::new("sh");
        command.args(["-c", "printf secret >&2; printf '{}' "]);
        assert_eq!(
            run(&mut command, b"", Duration::from_secs(2)).unwrap(),
            b"{}"
        );
        let mut command = Command::new("sleep");
        command.arg("10");
        assert!(run(&mut command, b"", Duration::from_millis(50))
            .unwrap_err()
            .contains("timed out"));
    }

    #[cfg(unix)]
    #[test]
    fn subprocess_receives_eof_and_large_output_fails_closed() {
        let mut command = Command::new("cat");
        assert_eq!(
            run(&mut command, b"request", Duration::from_secs(2)).unwrap(),
            b"request"
        );
        let mut command = Command::new("python3");
        command.args(["-c", "import sys;sys.stdout.write('x' * (5 * 1024 * 1024))"]);
        assert!(run(&mut command, b"", Duration::from_secs(3))
            .unwrap_err()
            .contains("output limit"));
    }

    #[cfg(unix)]
    #[test]
    fn helper_checks_identity_before_mutating_and_keeps_token_private() {
        let script = r#"
import contextlib,io,json,sys,unittest.mock
source=sys.stdin.read()
for actual in ['expected', 'replacement']:
    calls=[]
    class Response:
        status=200
        def read(self, limit):
            if len(calls)==1:
                return json.dumps({'protocolVersion':1,'runnerId':actual}).encode()
            return b'{"ok":true}'
    class Connection:
        def __init__(self,*args,**kwargs): pass
        def request(self,method,path,body=None,headers=None):
            assert headers['authorization']=='Bearer test-secret'
            assert headers['x-codevo-runner-id']=='expected'
            calls.append((method,path))
        def getresponse(self): return Response()
        def close(self): pass
    class Input:
        buffer=io.BytesIO(json.dumps({'method':'POST','path':'/v1/tasks',
            'headers':[],'body':{},'expectedRunnerId':'expected'}).encode())
    output=io.StringIO()
    with unittest.mock.patch('sys.stdin',Input()), \
         unittest.mock.patch('http.client.HTTPConnection',Connection), \
         unittest.mock.patch('builtins.open',unittest.mock.mock_open(read_data='test-secret')), \
         contextlib.redirect_stdout(output):
        exec(compile(source,'helper.py','exec'),{})
    response=json.loads(output.getvalue())
    assert 'test-secret' not in output.getvalue()
    if actual=='expected':
        assert calls==[('GET','/v1/runner'),('POST','/v1/tasks')]
        assert response=={'result':{'ok':True}}
    else:
        assert calls==[('GET','/v1/runner')]
        assert 'identity changed' in response['bridgeError']
print('verified')
"#;
        let mut command = Command::new("python3");
        command.args(["-c", script]);
        assert_eq!(
            run(
                &mut command,
                include_bytes!("helper.py"),
                Duration::from_secs(3)
            )
            .unwrap(),
            b"verified\n"
        );
    }
}
