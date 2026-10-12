---
description: Show a standup entry
argument-hint: "[YYYY-MM-DD | yesterday | today | tomorrow]"
allowed-tools: mcp__daily-status__get_dsu, mcp__daily-status__list_dsu_dates
---

Call `get_dsu` for: $ARGUMENTS

If that is empty, call it with no date to get the next working day's entry. Print the Yesterday, Today and Blockers sections as they come back. If every section is empty, say so and mention `/dsu` for adding items.
