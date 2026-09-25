use std::collections::{HashSet, VecDeque};

pub(crate) const MAX_REVOKED_ROOTS: usize = 256;

#[derive(Default)]
pub(crate) struct RevokedRoots {
    order: VecDeque<String>,
    members: HashSet<String>,
}

pub(crate) enum RevokedInsertion {
    Moved { position: usize },
    Inserted { evicted: Option<String> },
}

impl RevokedRoots {
    pub(crate) fn from_persisted(roots: Vec<String>) -> Self {
        let mut revoked = Self::default();
        for root in roots {
            revoked.insert(root);
        }
        revoked
    }

    pub(crate) fn contains(&self, root: &str) -> bool {
        self.members.contains(root)
    }

    pub(crate) fn insert(&mut self, root: String) -> RevokedInsertion {
        if let Some(position) = self.remove(&root) {
            self.members.insert(root.clone());
            self.order.push_back(root);
            return RevokedInsertion::Moved { position };
        }
        self.members.insert(root.clone());
        self.order.push_back(root);
        if self.order.len() <= MAX_REVOKED_ROOTS {
            return RevokedInsertion::Inserted { evicted: None };
        }
        let evicted = self.order.pop_front();
        if let Some(evicted) = &evicted {
            self.members.remove(evicted);
        }
        RevokedInsertion::Inserted { evicted }
    }

    pub(crate) fn remove(&mut self, root: &str) -> Option<usize> {
        if !self.members.remove(root) {
            return None;
        }
        let position = self.order.iter().position(|entry| entry == root)?;
        self.order.remove(position);
        Some(position)
    }

    pub(crate) fn restore(&mut self, root: String, position: usize) {
        if !self.members.insert(root.clone()) {
            return;
        }
        let position = position.min(self.order.len());
        self.order.insert(position, root);
    }

    pub(crate) fn undo_insert(&mut self, root: &str, insertion: RevokedInsertion) {
        self.remove(root);
        match insertion {
            RevokedInsertion::Moved { position } => self.restore(root.to_owned(), position),
            RevokedInsertion::Inserted { evicted: None } => {}
            RevokedInsertion::Inserted {
                evicted: Some(evicted),
            } => {
                if self.members.insert(evicted.clone()) {
                    self.order.push_front(evicted);
                }
            }
        }
    }

    pub(crate) fn persisted(&self) -> Vec<String> {
        self.order.iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{RevokedRoots, MAX_REVOKED_ROOTS};

    fn filled(count: usize) -> RevokedRoots {
        RevokedRoots::from_persisted((0..count).map(|index| format!("/r/{index:04}")).collect())
    }

    #[test]
    fn undo_insert_restores_the_exact_order_after_eviction() {
        let mut revoked = filled(MAX_REVOKED_ROOTS);
        let before = revoked.persisted();

        let insertion = revoked.insert("/r/new".to_owned());
        assert!(!revoked.contains("/r/0000"));
        assert!(revoked.contains("/r/new"));
        revoked.undo_insert("/r/new", insertion);

        assert_eq!(revoked.persisted(), before);
        assert!(revoked.contains("/r/0000"));
        assert!(!revoked.contains("/r/new"));
    }

    #[test]
    fn restore_reinserts_a_removed_root_at_its_position() {
        let mut revoked = filled(4);
        let before = revoked.persisted();
        let position = revoked.remove("/r/0002").unwrap();
        assert_eq!(position, 2);
        assert!(revoked.remove("/r/0002").is_none());
        revoked.restore("/r/0002".to_owned(), position);
        assert_eq!(revoked.persisted(), before);
    }

    #[test]
    fn from_persisted_keeps_the_newest_entries_and_moves_duplicates_to_the_end() {
        let mut roots: Vec<String> = (0..(MAX_REVOKED_ROOTS + 5))
            .map(|index| format!("/r/{index:04}"))
            .collect();
        roots.push("/r/0100".to_owned());
        let revoked = RevokedRoots::from_persisted(roots);
        let persisted = revoked.persisted();

        assert_eq!(persisted.len(), MAX_REVOKED_ROOTS);
        assert_eq!(persisted[0], "/r/0005");
        assert_eq!(persisted[MAX_REVOKED_ROOTS - 1], "/r/0100");
        assert!(!revoked.contains("/r/0004"));
        assert_eq!(
            persisted.iter().filter(|root| *root == "/r/0100").count(),
            1
        );
    }

    #[test]
    fn inserting_an_existing_root_moves_it_to_the_newest_position_and_undo_restores_it() {
        let mut revoked = filled(3);
        let before = revoked.persisted();

        let insertion = revoked.insert("/r/0000".to_owned());
        assert_eq!(revoked.persisted(), ["/r/0001", "/r/0002", "/r/0000"]);
        revoked.undo_insert("/r/0000", insertion);

        assert_eq!(revoked.persisted(), before);
    }
}
