# Sidebar projects, the t3code way

Source: `pingdotgg/t3code` (shallow clone, 2026-10-01), `apps/web/src/components`.

## What t3code does

t3code ships two sidebars:

- `Sidebar.tsx` (default): one flat thread list (Pinned, Active, Snoozed shelf, Settled
  shelf) narrowed by a project scope filter.
- `LegacySidebar.tsx` (setting "Restore per-project thread trees"): a "Projects" tree
  with one collapsible row per project and its threads nested below.

The owner's screenshot shows the default header: `Search`, a project scope button,
`Add project` (folder +) and `New thread` (pen).

### Top bar (default sidebar, `sidebar/SidebarThreadHeader.tsx`)

- **Search** is an inline filter, not the command palette. A non-empty query replaces
  the list with a results listbox (title / PR terms first, then message hits). Up/Down
  wrap, Enter opens, Esc clears, X clears.
- **"PR" button**: this is the project scope trigger. With a project scoped it shows that
  project's two-letter monogram (`projectIdentity.ts` derives two glyphs and falls back
  to "PR"); otherwise a folder icon. It opens a "Search projects..." combobox (All
  projects + each project with a gear for project settings). It is the equivalent of
  Codevo's "Show: <project>" filter, not a pull request control. t3code's real Pull
  Requests button lives in the footer and opens `/pull-requests` when an environment
  supports it.
- **Add project** opens the command palette's add-project page.
- **New thread**: one project creates immediately in the current project; several
  projects open the "new thread in" picker; Shift+click creates in the current project.

### Project tree (legacy sidebar)

- Header "Projects" with a sort menu and Add project.
- Project row: chevron (rotates when open; a collapsed project with live work shows a
  status dot that turns into the chevron on hover), favicon or monogram, name,
  "N projects" when grouped. Clicking the row toggles it.
- Expanded state is persisted per project (`projectExpandedById` in
  `t3code:ui-state:v1`), defaulting to expanded. The active thread's project is not
  force-expanded; a collapsed project keeps showing only the active thread row.
- Threads under a project: preview count 6 (setting, 1 to 15) with Show more / Show less.
- Hover action on the project row: "Create new thread in <project>". Context menu:
  Rename, Group into..., Copy Path, Project settings, Remove.
- Projects can be reordered by drag when the sort is manual.

### Threads and keyboard (default sidebar)

- Card rows: favicon + project, pin, status or relative time; title; branch / worktree /
  PR / diff / machine. Statuses: Working (live duration), Approval, Input, Failed, Done
  (unread). Snoozed and Settled shelves are collapsed by default.
- The open thread is always kept visible.
- Cmd+N picker, Shift+Cmd+N current project, Cmd+Shift+[ / ] previous / next,
  Cmd+1..9 jump. Next/previous and jumps follow the rendered order. Holding the
  modifier shows jump badges.
- Rows use `content-visibility: auto`; no virtualization library.

## Mapping to Codevo

| t3code                                           | Codevo                                                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search field (inline filter)                     | Keep `Search` in `AgentRailHeader` (already t3code-like).                                                                                                        |
| Project scope "PR" button                        | Remove, together with the "Show: <project>" filter. Projects are now visible as groups.                                                                          |
| Add project                                      | Keep; opens the existing add-project flow.                                                                                                                       |
| New thread                                       | Keep: click creates in the active project, Shift+click opens "New thread in...". Cmd+N picker, Shift+Cmd+N active project (commit 6f9348e93).                    |
| Pull Requests (footer)                           | No Codevo equivalent; not added.                                                                                                                                 |
| Pinned section                                   | Keep a global Pinned section at the top.                                                                                                                         |
| Project tree rows                                | New: one collapsible group per open project (local and remote runner projects), in project order, monogram + name + state (Opening, Not trusted, Tab closed).    |
| Expanded state persisted, default expanded       | Collapsed project keys are persisted (`editor.agentSidebar.collapsedProjects.v1`); default expanded.                                                             |
| Active thread kept visible                       | Selecting a thread expands its project. A collapsed project, or a project past its preview limit, still shows the selected row.                                  |
| Preview count 6 + Show more / Show less          | Same: 6 rows per project, then "Show N more" / "Show less".                                                                                                      |
| Hover "new thread in project"                    | Per-project pen button calling the existing `newThreadInProject`.                                                                                                |
| Project context menu                             | Existing Codevo project actions: Trust, Release, Close project, Terminal sessions, Reveal in Finder, Copy path. No rename / group / remove (no backend support). |
| Project drag reorder                             | Not added (no project order capability).                                                                                                                         |
| Snoozed / Settled shelves                        | Keep as global shelves.                                                                                                                                          |
| Next / previous / Cmd+1..9 follow rendered order | Order: Pinned, then each project's visible rows in project order. Collapsed projects and rows behind "Show more" are skipped.                                    |

### Removed

- The workspace card at the top of the sidebar (commit d40407cdc). Its location details
  stay in the composer strip and the right panel location line. Reveal stays in the
  thread header Open menu and the project menu.
- The "Show: <project>" filter (`AgentProjectFilterMenu`, `useAgentRailFilter`, the
  filter preference port and adapter, `editor.agentSidebar.projectFilter.v1`). The
  stored value is ignored and removed on first load.

### Saved conversations boundary (backlog P2)

"Saved conversations" becomes a shelf with a chevron after the thread sections. The
project groups sit under a "Projects" heading, so every row belongs to a labelled
section.
