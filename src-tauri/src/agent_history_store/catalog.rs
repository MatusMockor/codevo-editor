use super::{legacy::AgentThread, pages, sql, AgentHistoryStore, MAX_PAGE_BYTES};
use rusqlite::OptionalExtension;
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadPage {
    pub threads: Vec<AgentThread>,
    pub has_earlier: bool,
    pub before_thread_id: Option<String>,
    pub revisions: std::collections::BTreeMap<String, u64>,
}
#[derive(Serialize)]
pub(crate) struct FoundImport {
    pub thread: AgentThread,
    pub revision: u64,
}
impl AgentHistoryStore {
    pub(crate) fn read_threads(
        &self,
        root: &str,
        owner: &str,
        before: Option<&str>,
    ) -> Result<ThreadPage, String> {
        if let Some(id) = before {
            crate::git_worktree::safe_agent_task_id(id)?;
        }
        self.with_connection(root, owner, |connection| {
            let transaction = sql(connection.transaction())?;
            let connection = &transaction;
            let ordinal = match before {
                None => i64::MAX,
                Some(id) => sql(connection
                    .query_row("SELECT rowid FROM threads WHERE thread_id=?1", [id], |r| {
                        r.get::<_, i64>(0)
                    })
                    .optional())?
                .ok_or("The thread page cursor is unavailable.")?,
            };
            let mut statement = sql(connection.prepare(
                "SELECT thread_id,payload FROM threads WHERE rowid<?1 ORDER BY rowid DESC LIMIT 33",
            ))?;
            let rows = sql(statement.query_map([ordinal], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            }))?;
            let mut threads = Vec::new();
            let mut revisions = std::collections::BTreeMap::new();
            let mut bytes = 0;
            let mut has_earlier = false;
            for row in rows {
                let (id, payload) = sql(row)?;
                if threads.len() == 32 || bytes + payload.len() > MAX_PAGE_BYTES - 1024 {
                    has_earlier = true;
                    break;
                }
                // Catalog rows intentionally carry metadata only; opening a row loads its turns.
                let mut thread: AgentThread =
                    serde_json::from_str(&payload).map_err(|e| e.to_string())?;
                super::validate(root, &thread)?;
                if thread.thread_id != id {
                    return Err(super::legacy::AGENT_THREAD_OWNER_MISMATCH_ERROR.into());
                }
                if thread.thread_id != id {
                    return Err(super::legacy::AGENT_THREAD_OWNER_MISMATCH_ERROR.into());
                }
                thread.turns_truncated = true;
                let revision: i64 = sql(connection.query_row(
                    "SELECT revision FROM threads WHERE thread_id=?1",
                    [&thread.thread_id],
                    |r| r.get(0),
                ))?;
                if revision < 1 || revision > super::legacy::MAX_AGENT_SAFE_INTEGER as i64 {
                    return Err("Invalid saved history revision.".into());
                }
                revisions.insert(thread.thread_id.clone(), revision as u64);
                bytes += payload.len();
                threads.push(thread);
            }
            let before_thread_id = threads.last().map(|thread| thread.thread_id.clone());
            Ok(ThreadPage {
                threads,
                has_earlier,
                before_thread_id,
                revisions,
            })
        })
    }
    pub(crate) fn find_import(
        &self,
        root: &str,
        owner: &str,
        provider: crate::agent_task_spawner::AgentCliInvocation,
        session: &str,
        repository: &str,
    ) -> Result<Option<FoundImport>, String> {
        crate::agent_task_spawner::validate_resume_session_id(session)?;
        self.with_connection(root,owner,|connection| {
            let transaction=sql(connection.transaction())?;
            let connection=&transaction;
            let provider=serde_json::to_string(&provider).map_err(|e|e.to_string())?;
            let payload:Option<(String,String)>=sql(connection.query_row("SELECT t.thread_id,t.payload FROM threads t JOIN import_identity i ON t.thread_id=i.thread_id WHERE i.provider=?1 AND i.session_id=?2 AND i.repository_root=?3",rusqlite::params![provider,session,repository],|r|Ok((r.get(0)?,r.get(1)?))).optional())?;
            let Some((id,payload))=payload else {return Ok(None);};
            let mut thread:AgentThread=serde_json::from_str(&payload).map_err(|e|e.to_string())?;
            super::validate(root,&thread)?;
            if thread.thread_id!=id {return Err(super::legacy::AGENT_THREAD_OWNER_MISMATCH_ERROR.into());}
            let page=pages::read(connection,root,&thread.thread_id,None,MAX_PAGE_BYTES.saturating_sub(payload.len()+1024))?;
            let revision=page.revision;
            if page.turns.is_empty() && page.has_earlier {return Err("The saved turn exceeds the bounded history page size.".into());}
            thread.turns=page.turns;thread.turns_truncated|=page.has_earlier;
            Ok(Some(FoundImport{thread,revision}))
        })
    }
}
