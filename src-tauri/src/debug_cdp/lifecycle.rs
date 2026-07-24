pub(crate) type DebugSessionFinish = Box<dyn FnOnce(Option<i32>) + Send>;
