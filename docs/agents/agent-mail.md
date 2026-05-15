# Agent Mail protocol

Agent Mail is optional. Use it when MCP tools are available.

If Agent Mail is unavailable, continue using Beads, git, plan files, reviewer subagent output, and the final session summary as the coordination record.

Use the repository absolute path as the Agent Mail `project_key`.

For this repository, persist local Agent Mail identity state in:

```text
.agents/am.yml
```

This file is local working-tree state. It may contain Agent Mail registration tokens. Do not commit it.

If `.agents/am.yml` exists, read it before registering with Agent Mail. Reuse the recorded identity for the current role whenever possible.

If `.agents/am.yml` does not exist, or does not contain an identity for the current role, register a new Agent Mail identity and write the resulting name/token/project information to `.agents/am.yml` so future sessions can rejoin with the same identity.

Do not create a new Agent Mail identity if a usable identity for the current role already exists in `.agents/am.yml`.

Use separate identities for implementation and review work. A reviewer should not review its own implementation under the same identity.

Suggested structure:

```yaml
project_key: "/mnt/Data/projects/sheetspace"
identities:
  implementer:
    agent_name: "<agent-mail-name>"
    registration_token: "<agent-mail-registration-token>"
  reviewer:
    agent_name: "<agent-mail-name>"
    registration_token: "<agent-mail-registration-token>"
```

The exact token field name may differ depending on the Agent Mail tool response. Preserve whatever value is needed to authenticate as the same named agent in later sessions.

## Conventions

Use the active bead id as the shared coordination key.

For bead `br-123`:

- Agent Mail thread id: `br-123`
- Mail subject prefix: `[br-123]`
- File reservation reason: `br-123`
- Commit message should include `br-123`

At the start of an Agent Mail-enabled session:

1. Read `.agents/am.yml` if present.
2. Rejoin using the persisted identity for the current role.
3. Check inbox/messages relevant to the selected bead.
4. Announce the bead and role being worked on.
5. Reserve files or globs before editing, if file reservation tools are available.

During work, send short progress or blocker messages when useful. Do not spend excessive time on coordination if no other agents are active.

At completion, report:

- bead id
- summary of changes
- files changed
- tests run
- risks
- follow-up beads
- review status

## File reservations

When Agent Mail file reservations are available, reserve intended edit surfaces before modifying them.

Reserve narrowly:

- specific files when known
- small globs when necessary
- avoid broad repo-wide reservations

If another agent has reserved a file, coordinate through Agent Mail rather than editing over it.

If reservations are unavailable, use git status, bead status, and Agent Mail messages as the fallback coordination mechanism.
