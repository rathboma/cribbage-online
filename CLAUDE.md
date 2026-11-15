# CLAUDE.md

## Workflow

Work is planned as GitHub issues. The roadmap and implementation order are in
issue #1; pick up tickets in that order.

### Review after every ticket

Whenever you finish implementing a ticket, start a sub-agent with **no context**
(a fresh agent, not a fork of your session) to review the work before you call
it done. Ask it to look for:

- user-facing bugs
- implementation mistakes
- architectural issues

Point it at the ticket and the changes, not at your own conclusions, so its read
is independent. Fix what it finds, or say why you did not, before finishing.
