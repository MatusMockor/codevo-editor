use std::sync::OnceLock;

pub(crate) fn cached_monospace_font_families<F>(
    cache: &OnceLock<Vec<String>>,
    scan: F,
) -> &Vec<String>
where
    F: FnOnce() -> Vec<String>,
{
    cache.get_or_init(scan)
}
