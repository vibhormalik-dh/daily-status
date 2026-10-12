---
description: Log standup work from plain English, or show the entry when given no text
argument-hint: "[what you did, are doing, or are blocked on]"
allowed-tools: mcp__daily-status__get_dsu, mcp__daily-status__add_dsu_items, mcp__daily-status__update_dsu_item, mcp__daily-status__remove_dsu_item, mcp__daily-status__list_dsu_dates
---

The user said: $ARGUMENTS

If that is empty, call `get_dsu` with no date and show the entry.

Otherwise file it into the standup log:

- Work already finished, including anything the user reports doing today, goes in **Yesterday**. The undated entry is the next working day, so today's work is that day's "yesterday".
- Work the user says they will pick up next goes in **Today**.
- Anything in the way goes in **Blockers**.
- A ticket id plus a short outcome is enough for a bullet. Keep the user's own wording; do not pad it.
- Several pieces of work in one sentence become several bullets.
- If the user names a day, pass it as `date`. Otherwise omit `date`.
- To change or drop something already logged, use `update_dsu_item` or `remove_dsu_item` rather than adding a near-duplicate.

Reply with the sections you touched and their bullets, nothing more.
