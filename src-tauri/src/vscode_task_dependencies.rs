use std::{
    collections::{BTreeMap, BTreeSet},
    ops::Deref,
};

use super::{ValidatedProcessTask, VscodeTaskDiagnostic, VscodeTaskDiagnosticCode};

type IndexedTask = (usize, ValidatedProcessTask);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedTaskExecutionPlan {
    steps: Vec<ValidatedTaskExecutionStep>,
}

impl ValidatedTaskExecutionPlan {
    pub fn steps(&self) -> &[ValidatedTaskExecutionStep] {
        &self.steps
    }

    pub fn ready_steps(
        &self,
        completed: &BTreeSet<usize>,
        running: &BTreeSet<usize>,
    ) -> Vec<usize> {
        if !running.is_empty() {
            return Vec::new();
        }
        self.steps
            .iter()
            .enumerate()
            .filter(|(index, step)| {
                !completed.contains(index)
                    && !running.contains(index)
                    && step
                        .prerequisites
                        .iter()
                        .all(|prerequisite| completed.contains(prerequisite))
            })
            .map(|(index, _)| index)
            .take(1)
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedTaskExecutionStep {
    label: String,
    prerequisites: Vec<usize>,
}

impl ValidatedTaskExecutionStep {
    #[cfg_attr(test, allow(dead_code))]
    pub fn label(&self) -> &str {
        &self.label
    }

    #[cfg(test)]
    pub fn prerequisites(&self) -> &[usize] {
        &self.prerequisites
    }
}

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

    pub fn execution_plan(&self, label: &str) -> Option<ValidatedTaskExecutionPlan> {
        let target = *self.indexes.get(label)?;
        let mut visited = BTreeSet::new();
        let mut positions = Vec::new();
        self.append_position_postorder(target, &mut visited, &mut positions)?;
        let plan_indexes = positions
            .iter()
            .enumerate()
            .map(|(plan_index, position)| (*position, plan_index))
            .collect::<BTreeMap<_, _>>();
        let mut prerequisites = vec![BTreeSet::new(); positions.len()];
        for position in &positions {
            let plan_index = *plan_indexes.get(position)?;
            let task = self.tasks.get(*position)?;
            for dependency in &task.depends_on {
                let dependency_position = self.indexes.get(dependency)?;
                prerequisites
                    .get_mut(plan_index)?
                    .insert(*plan_indexes.get(dependency_position)?);
            }
            if task.dependency_order == super::TaskDependencyOrder::Sequence {
                self.append_sequence_barriers(task, &plan_indexes, &mut prerequisites)?;
            }
        }
        Some(ValidatedTaskExecutionPlan {
            steps: positions
                .into_iter()
                .enumerate()
                .map(|(plan_index, position)| {
                    Some(ValidatedTaskExecutionStep {
                        label: self.tasks.get(position)?.label.clone(),
                        prerequisites: prerequisites.get(plan_index)?.iter().copied().collect(),
                    })
                })
                .collect::<Option<Vec<_>>>()?,
        })
    }

    fn append_sequence_barriers(
        &self,
        task: &ValidatedProcessTask,
        plan_indexes: &BTreeMap<usize, usize>,
        prerequisites: &mut [BTreeSet<usize>],
    ) -> Option<()> {
        let mut earlier_branch_members = BTreeSet::new();
        let mut previous_root = None;
        for dependency in &task.depends_on {
            let dependency_position = *self.indexes.get(dependency)?;
            let mut branch_members = BTreeSet::new();
            self.collect_positions(dependency_position, &mut branch_members)?;
            if let Some(previous_root) = previous_root {
                let previous_plan_index = *plan_indexes.get(&previous_root)?;
                for member in branch_members.difference(&earlier_branch_members) {
                    let member_plan_index = *plan_indexes.get(member)?;
                    prerequisites
                        .get_mut(member_plan_index)?
                        .insert(previous_plan_index);
                }
            }
            earlier_branch_members.extend(branch_members);
            previous_root = Some(dependency_position);
        }
        Some(())
    }

    fn collect_positions(&self, position: usize, collected: &mut BTreeSet<usize>) -> Option<()> {
        if !collected.insert(position) {
            return Some(());
        }
        for dependency in &self.tasks.get(position)?.depends_on {
            self.collect_positions(*self.indexes.get(dependency)?, collected)?;
        }
        Some(())
    }

    fn append_position_postorder(
        &self,
        position: usize,
        visited: &mut BTreeSet<usize>,
        plan: &mut Vec<usize>,
    ) -> Option<()> {
        if !visited.insert(position) {
            return Some(());
        }
        for dependency in &self.tasks.get(position)?.depends_on {
            self.append_position_postorder(*self.indexes.get(dependency)?, visited, plan)?;
        }
        plan.push(position);
        Some(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vscode_process_tasks::VscodeTasksParser;

    #[test]
    fn parallel_dependency_plan_runs_one_ready_step_at_a_time_in_topological_order() {
        let parsed = VscodeTasksParser::parse(
            br#"{
                "version":"2.0.0",
                "tasks":[
                    {"label":"one","type":"process","command":"node"},
                    {"label":"two","type":"process","command":"node"},
                    {"label":"three","type":"process","command":"node"},
                    {"label":"four","type":"process","command":"node"},
                    {"label":"five","type":"process","command":"node"},
                    {"label":"six","type":"process","command":"node"},
                    {
                        "label":"target",
                        "type":"process",
                        "command":"node",
                        "dependsOn":["one","two","three","four","five","six"],
                        "dependsOrder":"parallel"
                    }
                ]
            }"#,
        )
        .expect("valid task graph");
        let plan = parsed
            .tasks
            .execution_plan("target")
            .expect("target execution plan");

        let mut completed = BTreeSet::new();
        let running = BTreeSet::from([0]);
        assert!(plan.ready_steps(&completed, &running).is_empty());
        let running = BTreeSet::new();
        for index in 0..plan.steps().len() {
            assert_eq!(plan.ready_steps(&completed, &running), vec![index]);
            completed.insert(index);
        }
        assert!(plan.ready_steps(&completed, &running).is_empty());
    }

    #[test]
    fn sequential_dependency_plan_blocks_every_node_in_the_later_branch() {
        let parsed = VscodeTasksParser::parse(
            br#"{
                "version":"2.0.0",
                "tasks":[
                    {"label":"first-leaf","type":"process","command":"node"},
                    {
                        "label":"first",
                        "type":"process",
                        "command":"node",
                        "dependsOn":"first-leaf",
                        "dependsOrder":"sequence"
                    },
                    {"label":"second-leaf","type":"process","command":"node"},
                    {
                        "label":"second",
                        "type":"process",
                        "command":"node",
                        "dependsOn":"second-leaf",
                        "dependsOrder":"sequence"
                    },
                    {
                        "label":"target",
                        "type":"process",
                        "command":"node",
                        "dependsOn":["first","second"],
                        "dependsOrder":"sequence"
                    }
                ]
            }"#,
        )
        .expect("valid task graph");
        let plan = parsed
            .tasks
            .execution_plan("target")
            .expect("target execution plan");

        let mut completed = BTreeSet::new();
        let running = BTreeSet::new();
        assert_eq!(plan.ready_steps(&completed, &running), vec![0]);
        completed.insert(0);
        assert_eq!(plan.ready_steps(&completed, &running), vec![1]);
        completed.insert(1);
        assert_eq!(plan.ready_steps(&completed, &running), vec![2]);
        completed.insert(2);
        assert_eq!(plan.ready_steps(&completed, &running), vec![3]);
        completed.insert(3);
        assert_eq!(plan.ready_steps(&completed, &running), vec![4]);
    }

    #[test]
    fn sequential_dependency_plan_does_not_cycle_shared_descendants() {
        let parsed = VscodeTasksParser::parse(
            br#"{
                "version":"2.0.0",
                "tasks":[
                    {"label":"shared","type":"process","command":"node"},
                    {
                        "label":"first",
                        "type":"process",
                        "command":"node",
                        "dependsOn":"shared",
                        "dependsOrder":"sequence"
                    },
                    {
                        "label":"second",
                        "type":"process",
                        "command":"node",
                        "dependsOn":"shared",
                        "dependsOrder":"sequence"
                    },
                    {
                        "label":"target",
                        "type":"process",
                        "command":"node",
                        "dependsOn":["first","second"],
                        "dependsOrder":"sequence"
                    }
                ]
            }"#,
        )
        .expect("valid task graph");
        let plan = parsed
            .tasks
            .execution_plan("target")
            .expect("target execution plan");

        let prerequisites = plan
            .steps()
            .iter()
            .map(|step| step.prerequisites().to_vec())
            .collect::<Vec<_>>();
        assert_eq!(prerequisites, vec![vec![], vec![0], vec![0, 1], vec![1, 2]]);
    }
}
