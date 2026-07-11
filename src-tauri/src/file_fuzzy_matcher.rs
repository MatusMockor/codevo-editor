use std::cmp::Ordering;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct FileMatchRank {
    tier: u8,
    score: i64,
}

impl Ord for FileMatchRank {
    fn cmp(&self, other: &Self) -> Ordering {
        self.tier
            .cmp(&other.tier)
            .then_with(|| other.score.cmp(&self.score))
    }
}

impl PartialOrd for FileMatchRank {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

struct TokenMatch {
    start: usize,
    score: i64,
    in_filename: bool,
}

pub(crate) fn file_match_rank(path: &str, query: &str) -> Option<FileMatchRank> {
    let query = query.trim();
    if query.is_empty() {
        return Some(FileMatchRank { tier: 2, score: 0 });
    }

    let filename_start = path.rfind(['/', '\\']).map_or(0, |index| index + 1);
    let filename = &path[filename_start..];
    let mut tokens = query.split_whitespace();
    let first_token = tokens.next()?;
    let has_multiple_tokens = tokens.next().is_some();

    if !has_multiple_tokens && equal_case_insensitive(filename, first_token) {
        return Some(FileMatchRank {
            tier: 0,
            score: i64::MAX,
        });
    }
    if !has_multiple_tokens && starts_with_case_insensitive(filename, first_token) {
        return Some(FileMatchRank {
            tier: 1,
            score: i64::MAX,
        });
    }

    for token in query.split_whitespace() {
        match_token(path, token, 0, filename_start)?;
    }

    let mut score = 0;
    let mut minimum_start = 0;
    for token in query.split_whitespace() {
        let filename_match = match_token(filename, token, 0, 0).map(|matched| TokenMatch {
            start: matched.start + filename_start,
            score: matched.score,
            in_filename: true,
        });
        let matched = filename_match
            .filter(|matched| matched.start >= minimum_start)
            .or_else(|| match_token(path, token, minimum_start, filename_start))
            .or_else(|| match_token(path, token, 0, filename_start))?;
        minimum_start = matched.start;
        score += matched.score;
        if matched.in_filename {
            score += 220;
        }
    }

    Some(FileMatchRank { tier: 2, score })
}

pub(crate) fn compare_ranked_paths(
    left_path: &str,
    left_rank: FileMatchRank,
    right_path: &str,
    right_rank: FileMatchRank,
) -> Ordering {
    left_rank
        .cmp(&right_rank)
        .then_with(|| left_path.len().cmp(&right_path.len()))
        .then_with(|| left_path.cmp(right_path))
}

fn match_token(
    path: &str,
    token: &str,
    minimum_start: usize,
    filename_start: usize,
) -> Option<TokenMatch> {
    let mut query = token.chars();
    let mut wanted = query.next()?;
    let mut started = false;
    let mut start = 0;
    let mut previous_match = 0;
    let mut previous_char = None;
    let mut gap = 0i64;
    let mut directory_gaps = 0i64;
    let mut run = 0i64;
    let mut score = 0i64;
    let mut in_filename = true;

    for (index, candidate) in path.char_indices() {
        if !started && index < minimum_start {
            previous_char = Some(candidate);
            continue;
        }
        if !chars_equal_case_insensitive(candidate, wanted) {
            if started {
                gap += 1;
                if matches!(candidate, '/' | '\\') {
                    directory_gaps += 1;
                }
            }
            previous_char = Some(candidate);
            continue;
        }

        if !started {
            started = true;
            start = index;
        }
        in_filename &= index >= filename_start;
        score += 12;
        if is_word_boundary(previous_char, candidate, index) {
            score += 70;
        }
        if index >= filename_start {
            score += 24;
        }
        if run > 0 && index == previous_match + previous_char.map_or(0, char::len_utf8) {
            run += 1;
            score += run * 12;
        } else {
            run = 1;
        }
        score -= gap * 3 + directory_gaps * 40;
        gap = 0;
        directory_gaps = 0;
        previous_match = index;
        previous_char = Some(candidate);

        let Some(next) = query.next() else {
            score -= start as i64;
            return Some(TokenMatch {
                start,
                score,
                in_filename,
            });
        };
        wanted = next;
    }

    None
}

fn is_word_boundary(previous: Option<char>, current: char, index: usize) -> bool {
    if index == 0 {
        return true;
    }
    let Some(previous) = previous else {
        return true;
    };
    if matches!(previous, '/' | '\\' | '_' | '-' | '.') {
        return true;
    }
    previous.is_lowercase() && current.is_uppercase()
}

fn equal_case_insensitive(left: &str, right: &str) -> bool {
    let mut left = left.chars();
    let mut right = right.chars();
    loop {
        match (left.next(), right.next()) {
            (Some(left), Some(right)) if chars_equal_case_insensitive(left, right) => {}
            (None, None) => return true,
            _ => return false,
        }
    }
}

fn starts_with_case_insensitive(value: &str, prefix: &str) -> bool {
    let mut value = value.chars();
    for expected in prefix.chars() {
        let Some(candidate) = value.next() else {
            return false;
        };
        if !chars_equal_case_insensitive(candidate, expected) {
            return false;
        }
    }
    true
}

fn chars_equal_case_insensitive(left: char, right: char) -> bool {
    left.to_lowercase().eq(right.to_lowercase())
}
