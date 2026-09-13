use super::types::Server;
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};

pub(super) trait ServerRepository: Send + Sync {
    fn load(&self) -> Result<Vec<Server>, String>;
    fn save(&self, servers: &[Server]) -> Result<(), String>;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reload_never_claims_live_connection() {
        let directory =
            std::env::temp_dir().join(format!("codevo-remote-repository-{}", std::process::id()));
        let repository = FileServerRepository(directory.join("servers.json"));
        let server = Server {
            id: "test".into(),
            name: "Test".into(),
            host: "127.0.0.1".into(),
            username: "codex".into(),
            port: 22,
            connected: true,
            runner_id: Some("runner-test".into()),
        };
        repository.save(&[server]).unwrap();
        assert!(!repository.load().unwrap()[0].connected);
        assert_eq!(
            repository.load().unwrap()[0].runner_id.as_deref(),
            Some("runner-test")
        );
        assert!(serde_json::to_value(&repository.load().unwrap()[0])
            .unwrap()
            .get("runnerId")
            .is_none());
        fs::write(&repository.0, b"[] trailing").unwrap();
        assert!(repository.load().is_err());
        fs::remove_file(&repository.0).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}

pub(super) struct FileServerRepository(pub PathBuf);

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredServer {
    server: Server,
    runner_id: Option<String>,
}

struct PendingFile(PathBuf);
impl Drop for PendingFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

impl ServerRepository for FileServerRepository {
    fn load(&self) -> Result<Vec<Server>, String> {
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        let file = match options.open(&self.0) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err("Could not read saved servers".into()),
        };
        if !file
            .metadata()
            .map_err(|_| "Could not read server storage")?
            .is_file()
        {
            return Err("Invalid server storage file".into());
        }
        let mut bytes = Vec::new();
        file.take(65_537)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read saved servers")?;
        if bytes.len() > 65_536 {
            return Err("Saved servers exceed storage limit".into());
        }
        let stored: Vec<StoredServer> =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid saved server settings")?;
        let mut servers: Vec<Server> = stored
            .into_iter()
            .map(|entry| {
                let mut server = entry.server;
                server.runner_id = entry.runner_id;
                server
            })
            .collect();
        if servers.len() > 32 {
            return Err("Too many saved servers".into());
        }
        for server in &mut servers {
            super::types::ConnectRequest {
                id: server.id.clone(),
                name: server.name.clone(),
                host: server.host.clone(),
                username: server.username.clone(),
                port: server.port,
            }
            .validate()?;
            if server.runner_id.as_ref().is_some_and(|id| {
                id.trim().is_empty() || id.len() > 128 || id.chars().any(char::is_control)
            }) {
                return Err("Invalid saved runner identity".into());
            }
            server.connected = false;
        }
        let mut ids = std::collections::HashSet::new();
        if servers.iter().any(|s| !ids.insert(&s.id)) {
            return Err("Duplicate saved server".into());
        }
        Ok(servers)
    }

    fn save(&self, servers: &[Server]) -> Result<(), String> {
        let parent = self.0.parent().ok_or("Invalid server storage path")?;
        fs::create_dir_all(parent).map_err(|_| "Could not create server storage")?;
        static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let temporary = self
            .0
            .with_extension(format!("json.{}.{sequence}.pending", std::process::id()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Could not save server settings")?;
        let pending = PendingFile(temporary);
        let stored: Vec<StoredServer> = servers
            .iter()
            .map(|server| StoredServer {
                server: server.clone(),
                runner_id: server.runner_id.clone(),
            })
            .collect();
        let bytes = serde_json::to_vec(&stored).map_err(|_| "Could not encode server settings")?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| "Could not save server settings")?;
        fs::rename(&pending.0, &self.0).map_err(|_| "Could not save server settings".into())
    }
}
