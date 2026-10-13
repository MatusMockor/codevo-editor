use super::attachment_transfers::{Seat, WorkerPermit};
use super::attachment_watch::{Guard, Interrupted};
use super::commands::OPERATIONS_BUSY;
use super::transport::UploadFeed;
use crate::agent_file_source::{Reader, UNREADABLE};
use std::time::Duration;
use tokio::sync::{oneshot, watch};

pub(super) trait ChunkSource: Send {
    fn next(&mut self) -> Result<Option<Vec<u8>>, String>;
    fn digest(&self) -> Option<String>;
}

impl ChunkSource for Reader {
    fn next(&mut self) -> Result<Option<Vec<u8>>, String> {
        Reader::next(self)
    }

    fn digest(&self) -> Option<String> {
        Reader::digest(self)
    }
}

pub(super) type SourceOpener = Box<dyn FnOnce() -> Result<Box<dyn ChunkSource>, String> + Send>;
pub(super) type Digest = Option<Result<String, String>>;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Halted {
    Locally(String),
    Interrupted(Interrupted),
}

pub(super) struct Feeding {
    _seat: Seat,
    opened: Option<oneshot::Receiver<Result<(), String>>>,
    feeds: std::sync::mpsc::Sender<UploadFeed>,
    digest: watch::Receiver<Digest>,
}

impl Feeding {
    pub(super) fn start(
        (seat, permit): (Seat, WorkerPermit),
        open: SourceOpener,
        wanted: impl Fn() -> bool + Send + 'static,
    ) -> Result<Self, String> {
        let (opening, opened) = oneshot::channel();
        let (feeds, fed) = std::sync::mpsc::channel();
        let (reported, digest) = watch::channel(None);
        std::thread::Builder::new()
            .name("codevo-attachment-read".into())
            .spawn(move || {
                let _permit = permit;
                feed(open, opening, fed, reported, wanted);
            })
            .map_err(|_| OPERATIONS_BUSY)?;
        Ok(Self {
            _seat: seat,
            opened: Some(opened),
            feeds,
            digest,
        })
    }

    pub(super) fn opened(&mut self, guard: &mut Guard, patience: Duration) -> Result<(), Halted> {
        let Some(opened) = self.opened.take() else {
            return Err(Halted::Locally(UNREADABLE.into()));
        };
        tauri::async_runtime::block_on(async {
            tokio::select! {
                biased;
                opened = opened => opened
                    .unwrap_or_else(|_| Err(UNREADABLE.into()))
                    .map_err(Halted::Locally),
                interrupted = guard.interrupted(patience) => Err(Halted::Interrupted(interrupted)),
            }
        })
    }

    pub(super) fn feed(&self, feed: UploadFeed) {
        let _ = self.feeds.send(feed);
    }

    pub(super) fn failure(&self) -> Option<String> {
        self.digest.borrow().as_ref()?.as_ref().err().cloned()
    }

    pub(super) fn digest(&self) -> Option<String> {
        self.digest.borrow().as_ref()?.as_ref().ok().cloned()
    }

    pub(super) async fn failed(&mut self) -> String {
        loop {
            if let Some(failure) = self.failure() {
                return failure;
            }
            if self.digest.changed().await.is_err() {
                return std::future::pending().await;
            }
        }
    }
}

fn feed(
    open: SourceOpener,
    opening: oneshot::Sender<Result<(), String>>,
    fed: std::sync::mpsc::Receiver<UploadFeed>,
    reported: watch::Sender<Digest>,
    wanted: impl Fn() -> bool,
) {
    let mut source = match open() {
        Ok(source) => source,
        Err(error) => {
            let _ = opening.send(Err(error));
            return;
        }
    };
    if opening.send(Ok(())).is_err() {
        return;
    }
    let Ok(mut feed) = fed.recv() else {
        return;
    };
    while wanted() {
        let chunk = match source.next() {
            Ok(Some(chunk)) => chunk,
            Ok(None) => return,
            Err(error) => {
                reported.send_replace(Some(Err(error)));
                return;
            }
        };
        if let Some(digest) = source.digest() {
            reported.send_replace(Some(Ok(digest)));
        }
        if !feed.send(chunk) {
            return;
        }
    }
}
