use std::{
    collections::{BTreeMap, BTreeSet},
    ops::Deref,
};

use super::{ValidatedProcessTask, VscodeTaskDiagnostic, VscodeTaskDiagnosticCode};

type IndexedTask = (usize, ValidatedProcessTask);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedTaskGraph {
    tasks: Vec<ValidatedProcessTask>,
    indexes: BTreeMap<String, usize>,
}

impl ValidatedTaskGraph {
    fn new(tasks: Vec<ValidatedProcessTask>) -> Self {
        let indexes = tasks
            .iter()
            .enumerate()
            .map(|(index, task)| (task.label.clone(), index))
            .collect();
        Self { tasks, indexes }
    }

    /// Returns every dependency once, in stable declaration order, before the target.
    pub fn sequential_plan(&self, label: &str) -> Option<Vec<&ValidatedProcessTask>> {
        let target = *self.indexes.get(label)?;
        let mut visited = BTreeSet::new();
        let mut plan = Vec::new();
        self.append_postorder(target, &mut visited, &mut plan);
        Some(plan)
    }

    fn append_postorder<'a>(
        &'a self,
        position: usize,
        visited: &mut BTreeSet<usize>,
        plan: &mut Vec<&'a ValidatedProcessTask>,
    ) {
        if !visited.insert(position) {
            return;
        }
        let task = &self.tasks[position];
        for dependency in &task.depends_on {
            if let Some(dependency) = self.indexes.get(dependency) {
                self.append_postorder(*dependency, visited, plan);
            }
        }
        plan.push(task);
    }
}

impl Deref for ValidatedTaskGraph {
    type Target = [ValidatedProcessTask];

    fn deref(&self) -> &Self::Target {
        &self.tasks
    }
}

impl IntoIterator for ValidatedTaskGraph {
    type Item = ValidatedProcessTask;
    type IntoIter = std::vec::IntoIter<ValidatedProcessTask>;

    fn into_iter(self) -> Self::IntoIter {
        self.tasks.into_iter()
    }
}

pub(super) fn retain_executable_tasks(
    tasks: Vec<IndexedTask>,
    diagnostics: &mut Vec<VscodeTaskDiagnostic>,
) -> ValidatedTaskGraph {
    let indexes = tasks
        .iter()
        .enumerate()
        .map(|(position, (_, task))| (task.label.clone(), position))
        .collect::<BTreeMap<_, _>>();
    let mut invalid = direct_graph_errors(&tasks, &indexes, diagnostics);
    mark_cycles(&tasks, &indexes, &mut invalid, diagnostics);
    propagate_invalid_dependencies(&tasks, &indexes, &mut invalid, diagnostics);

    ValidatedTaskGraph::new(
        tasks
            .into_iter()
            .enumerate()
            .filter_map(|(position, (_, task))| (!invalid.contains(&position)).then_some(task))
            .collect(),
    )
}

fn direct_graph_errors(
    tasks: &[IndexedTask],
    indexes: &BTreeMap<String, usize>,
    diagnostics: &mut Vec<VscodeTaskDiagnostic>,
) -> BTreeSet<usize> {
    let mut invalid = BTreeSet::new();
    for (position, (task_index, task)) in tasks.iter().enumerate() {
        let mut seen = BTreeSet::new();
        let reason = task.depends_on.iter().find_map(|dependency| {
            if dependency == &task.label {
                Some("a task cannot depend on itself")
            } else if !seen.insert(dependency) {
                Some("dependsOn contains a duplicate label")
            } else if !indexes.contains_key(dependency) {
                Some("dependsOn references a missing or non-executable task")
            } else {
                None
            }
        });
        if let Some(reason) = reason {
            invalid.insert(position);
            diagnostics.push(graph_diagnostic(*task_index, &task.label, reason));
        }
    }
    invalid
}

fn mark_cycles(
    tasks: &[IndexedTask],
    indexes: &BTreeMap<String, usize>,
    invalid: &mut BTreeSet<usize>,
    diagnostics: &mut Vec<VscodeTaskDiagnostic>,
) {
    let mut state = vec![VisitState::Unvisited; tasks.len()];
    let mut stack = Vec::new();
    let mut cycle_members = BTreeSet::new();
    for position in 0..tasks.len() {
        visit(
            position,
            tasks,
            indexes,
            invalid,
            &mut state,
            &mut stack,
            &mut cycle_members,
        );
    }
    for position in cycle_members {
        if invalid.insert(position) {
            let (task_index, task) = &tasks[position];
            diagnostics.push(graph_diagnostic(
                *task_index,
                &task.label,
                "task dependency graph contains a cycle",
            ));
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn visit(
    position: usize,
    tasks: &[IndexedTask],
    indexes: &BTreeMap<String, usize>,
    invalid: &BTreeSet<usize>,
    state: &mut [VisitState],
    stack: &mut Vec<usize>,
    cycle_members: &mut BTreeSet<usize>,
) {
    if invalid.contains(&position) || state[position] == VisitState::Visited {
        return;
    }
    if state[position] == VisitState::Visiting {
        if let Some(cycle_start) = stack.iter().position(|entry| *entry == position) {
            cycle_members.extend(stack[cycle_start..].iter().copied());
        }
        return;
    }
    state[position] = VisitState::Visiting;
    stack.push(position);
    for dependency in &tasks[position].1.depends_on {
        if let Some(dependency_position) = indexes.get(dependency) {
            visit(
                *dependency_position,
                tasks,
                indexes,
                invalid,
                state,
                stack,
                cycle_members,
            );
        }
    }
    stack.pop();
    state[position] = VisitState::Visited;
}

fn propagate_invalid_dependencies(
    tasks: &[IndexedTask],
    indexes: &BTreeMap<String, usize>,
    invalid: &mut BTreeSet<usize>,
    diagnostics: &mut Vec<VscodeTaskDiagnostic>,
) {
    loop {
        let newly_invalid = tasks
            .iter()
            .enumerate()
            .filter(|(position, _)| !invalid.contains(position))
            .filter_map(|(position, (_, task))| {
                task.depends_on
                    .iter()
                    .any(|dependency| {
                        indexes
                            .get(dependency)
                            .is_some_and(|dependency| invalid.contains(dependency))
                    })
                    .then_some(position)
            })
            .collect::<Vec<_>>();
        if newly_invalid.is_empty() {
            return;
        }
        for position in newly_invalid {
            invalid.insert(position);
            let (task_index, task) = &tasks[position];
            diagnostics.push(graph_diagnostic(
                *task_index,
                &task.label,
                "dependsOn references a non-executable dependency graph",
            ));
        }
    }
}

fn graph_diagnostic(task_index: usize, label: &str, message: &str) -> VscodeTaskDiagnostic {
    VscodeTaskDiagnostic {
        task_index,
        label: Some(label.to_string()),
        code: VscodeTaskDiagnosticCode::DependencyGraph,
        message: message.to_string(),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum VisitState {
    Unvisited,
    Visiting,
    Visited,
}
