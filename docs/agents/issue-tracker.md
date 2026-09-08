# Issue tracker: Linear

Issues and specs for this repository live in the `@pdx-ts/sdk` team in the
`Showtime!` Linear workspace. Use the Linear MCP connector for all operations.

## Scope

- Workspace ID: `56e48100-aa8d-497b-ba80-c79554b96bd9`
- Team ID: `bf805c5b-764b-4cb7-ae2e-f5d78ce23984`
- Completed status: `Done`
- Completed status ID: `ba8b9248-ee1d-4851-870f-ddec1bff4b4b`

## Conventions

- Create or update an issue with `linear_save_issue`.
- Read an issue with `linear_get_issue`. Request relations when blocking or
  related issues matter.
- Read discussion with `linear_list_comments`.
- List issues with `linear_list_issues`, scoped to the team ID above.
- Add a resolution or other discussion with `linear_save_comment`.
- Close an issue by updating it to the completed status ID above.
- Fetch current team labels with `linear_list_issue_labels` before filing an
  issue.
- Every new issue must include labels, a priority, and a T-shirt estimate.

When a skill says “publish to the issue tracker,” create a Linear issue in this
team.

When a skill says “fetch the relevant ticket,” read the Linear issue and its
comments.

## Wayfinder labels

Wayfinder uses members of Linear's `Wayfinder` label group. Apply labels by
their IDs:

| Role | Linear label | Label ID |
| --- | --- | --- |
| Map | `Wayfinder / Map` | `e3b5c98a-6aeb-4066-b767-216879db50ee` |
| Research | `Wayfinder / Research` | `42854fde-519a-4740-9c08-6d76b8cbe260` |
| Prototype | `Wayfinder / Prototype` | `b9e73b79-43fb-45da-b1b6-83440433c5f0` |
| Grilling | `Wayfinder / Grilling` | `86676c1f-59ce-49e9-bec2-5f9f6adfa8cf` |
| Task | `Wayfinder / Task` | `22267d88-e1f7-40f8-9039-d89c4d56da6c` |

Do not use the obsolete colon-named labels such as `wayfinder:map`.

## Wayfinding operations

- **Map:** Create one issue with the Map label. Its description holds Notes,
  Decisions so far, and Not yet specified.
- **Child ticket:** Create an issue with `parentId` set to the map issue and
  apply the label ID for its ticket type.
- **Blocking:** Use Linear's native dependencies through `blockedBy` or
  `blocks` on `linear_save_issue`.
- **Frontier query:** List the map's child issues with `linear_list_issues`
  using `parentId`. Exclude completed, canceled, assigned, and blocked issues.
  Use `linear_get_issue` with relations to check blockers.
- **Claim:** As the first write, update the selected issue with
  `assignee: "me"`.
- **Resolve:** Add the answer as a comment, move the ticket to `Done`, then
  append a linked one-line context pointer to the map's Decisions so far.
