# daily-status

A local MCP server for keeping daily standup (DSU) notes as markdown files. You
talk to Claude in plain language ("add SWP-3671 to today", "move that to
blockers") and it edits the right file for you.

Everything is stored on disk, in `Documents/daily-status/logs` on your own
machine. **The server makes no network calls** and has no database.

## What it does

- Keeps one markdown file per day, with three fixed sections: **Yesterday**, **Today**, **Blockers**.
- Exposes five tools to Claude for reading and editing those files.
- Creates files on demand, so there is nothing to initialise.

## Storage format

One file per day at `logs/YYYY-MM-DD.md`:

```markdown
# Daily Standup - 2026-10-12

## Yesterday
- Scoped the standup tooling

## Today
- Ship the DSU MCP server

## Blockers
- _nothing recorded_
```

Notes on the format:

- `_nothing recorded_` is a placeholder for an empty section. It is never read back as a real item.
- Dates are always `YYYY-MM-DD` and resolved in your **machine's local timezone**, not UTC.
- The files are plain markdown, so you can edit them by hand and the server will still parse them.
- Set `DSU_LOG_DIR` to store the logs somewhere else. The default is `logs/` next to this project.

## Which day an undated entry lands on

**By default, saying "add this to my standup" with no date writes to the next
working day's file.** Standups are written the evening before the meeting, so
that is the day you almost always mean.

On the evening of Mon 12 Oct, "add SWP-3671 to my standup" creates or updates
`logs/2026-10-13.md`. Nothing is written to the 12th.

### Weekends are skipped

Days count in working days, not calendar days. On a **Friday** the next standup
is **Monday**, not Saturday:

| You record on | Entry lands on |
| --- | --- |
| Thu 15 Oct | Fri 16 Oct |
| Fri 16 Oct | **Mon 19 Oct** |
| Sat 17 Oct | Mon 19 Oct |
| Sun 18 Oct | Mon 19 Oct |

This runs backwards too, which matters for the Yesterday section: on a Monday,
"yesterday" resolves to the previous **Friday**.

Set `DSU_SKIP_WEEKENDS=false` to treat Saturday and Sunday as ordinary days.

### Naming a different day

The `date` argument accepts a full date or a relative word:

- "add this to **today's** standup" → the current day
- "what was on **yesterday's** standup" → the previous working day
- "add this to **2026-10-20**" → that exact date

An explicit `YYYY-MM-DD` is never adjusted, so it is also how you reach a
Saturday or Sunday while weekend skipping is on.

Change the default with `DSU_DEFAULT_DAY`:

| Value | Undated calls resolve to |
| --- | --- |
| `tomorrow` | The next working day. **This is the default.** |
| `today` | The current day, the original behaviour. |
| `evening` | The next working day from 6pm onwards, today before that. |

`evening` mode suits you if you both write and read standups from the same
session: you write tomorrow's entry at night, and a morning "show me my
standup" still resolves to the day you are actually standing up in. Move the
cutoff with `DSU_EVENING_HOUR` (0-23, default 18).

An unrecognised `DSU_DEFAULT_DAY` or an out-of-range `DSU_EVENING_HOUR` falls
back to the default rather than erroring.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DSU_LOG_DIR` | `Documents/daily-status/logs` | Where the markdown files are stored. |
| `DSU_DEFAULT_DAY` | `tomorrow` | Which day undated calls resolve to. |
| `DSU_EVENING_HOUR` | `18` | Cutoff hour, only used by `evening` mode. |
| `DSU_SKIP_WEEKENDS` | `true` | Whether Friday rolls to Monday. Set `false` to disable. |

## Install

**Requirements:** Node.js 18 or newer.

### As a Claude Code plugin (recommended)

```
/plugin marketplace add vibhormalik-dh/daily-status
/plugin install daily-status
```

Restart Claude Code. That is the whole install: the bundled server needs no
`npm install`, and the plugin brings two slash commands with it.

| Command | What it does |
| --- | --- |
| `/dsu <text>` | Files what you say into the right section. `/dsu finished SWP-2323` |
| `/dsu-show [day]` | Prints an entry. `/dsu-show today` |

Plain English works too once the plugin is installed, with no slash command:
"add SWP-3456 to tomorrow", "I'm blocked on SWP-3332".

### From source

```bash
git clone https://github.com/vibhormalik-dh/daily-status.git
cd daily-status
npm install
npm run build
claude mcp add daily-status --scope user -- node "$PWD/dist/index.js"
```

Confirm it connected with `claude mcp list`.

### Claude Desktop

Add an entry to the config file and restart the app. On macOS that is
`~/Library/Application Support/Claude/claude_desktop_config.json`; on Windows it
is `%APPDATA%\Claude\claude_desktop_config.json`.

```json
{
  "mcpServers": {
    "daily-status": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/daily-status/dist/index.js"]
    }
  }
}
```

Claude Desktop does not inherit your shell `PATH`, so `command` must be an
absolute path to the Node binary. A bare `node` will fail under nvm. Run
`which node` (or `where node` on Windows) to get the right path.

### Where your files go

| Platform | Path |
| --- | --- |
| macOS | `~/Documents/daily-status/logs` |
| Windows | `%USERPROFILE%\Documents\daily-status\logs`, or the OneDrive-backed Documents folder when the account redirects it |
| Linux | `~/Documents/daily-status/logs` |

Set `DSU_LOG_DIR` to put them anywhere else.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_dsu` | Read a day's entry as markdown. Defaults to today. |
| `add_dsu_items` | Append items to `Yesterday`, `Today` or `Blockers`. Skips duplicates. |
| `update_dsu_item` | Replace an item's text, optionally moving it to another section. |
| `remove_dsu_item` | Delete an item, optionally scoped to one section. |
| `list_dsu_dates` | List saved dates, newest first. Defaults to 30. |

Every tool takes an optional `date` argument, accepting either `YYYY-MM-DD` or
one of `yesterday`, `today`, `tomorrow`. Leave it out and it uses the next
working day, as described above.

### Which section work goes in

The sections are read from the standup day's point of view, not from the day you
are writing on. Since an undated entry is for the **next working day**, work you
are doing right now belongs in **Yesterday**, and **Today** is for what you plan
to do at the standup. Saying "I'm working on SWP-3671 today" files it under
Yesterday on tomorrow's entry.

### How item matching works

`update_dsu_item` and `remove_dsu_item` find an item by trying three passes in
order: exact text, case-insensitive, then substring. The first pass that finds
anything wins.

Both tools accept an optional section filter to narrow the search:
`section` on `remove_dsu_item`, and `from_section` on `update_dsu_item` (whose
`section` argument stays the move target). This matters when the same text sits
in two sections, which happens often with an item that carries over from
Yesterday into Today.

If a match is **ambiguous or missing**, the tool returns an error listing the
current items rather than guessing at which one you meant. So "remove the Apple
Pay one" works when only one item mentions Apple Pay, and when two match it
names the sections they are in so the next call can pass the filter.

## Using it

Once registered, just talk to Claude normally. Anything without an explicit day
goes to the next working day's entry:

- "Add SWP-3671, need to check why 3DS is not working" → next working day
- "What's on my standup?" → next working day
- "Move the 3DS item to blockers"
- "Change the Apple Pay item to say it's verified on sandbox now"
- "What's on today's standup?" → the current day
- "Show me my standup for 2026-10-09"
- "What days do I have standups saved for?"

## Project layout

```
.claude-plugin/plugin.json       Plugin manifest, declares the MCP server
.claude-plugin/marketplace.json  Makes this repo installable as a marketplace
commands/                        /dsu and /dsu-show slash commands
src/index.ts                     Tool definitions and request handlers
src/store.ts                     Markdown parse/render, file I/O, date handling
scripts/build.mjs                esbuild bundle step
dist/index.js                    Committed bundle, no runtime dependencies
```

`dist/index.js` is committed on purpose so an installed plugin runs without
`npm install`. Your standup files live outside the repo, in Documents.

## Development

```bash
npm run build    # typecheck, then bundle src/ into dist/index.js
npm start        # run the server directly
```

Commit the rebuilt `dist/index.js` alongside the source change, otherwise
plugin users keep running the old build.

The server speaks MCP over stdio, so running `npm start` on its own just waits
for a client. On startup it prints two lines to stderr:

```
daily-status-mcp ready. Logs: /path/to/logs
Undated calls go to 2026-10-19 (Monday), DSU_DEFAULT_DAY=tomorrow, weekends skipped.
```

That is the fastest way to confirm the log directory, which day your undated
entries land on, and whether the weekend roll is active.

After changing anything in `src/`, run `npm run build` and restart your Claude
session so it picks up the new build.

## Troubleshooting

**Tools do not show up in Claude.** Check `claude mcp list`, or `/plugin` if
you installed the plugin. Restarting Claude Code after installing is required.

**Entries land in the wrong folder.** `DSU_LOG_DIR` overrides the default. Start
the server manually and read the stderr line to see which path is in use.

**Claude Desktop shows the server as failed.** Almost always the `node` path.
Use the absolute path from `which node`, not a bare `node`.

**An entry landed on the wrong day.** Undated calls go to the next working day
by default. Check the second stderr line on startup for the exact date and
weekday in use, and name the day explicitly ("add this to today's standup")
when you want a different one.

**An entry needs to go on a Saturday or Sunday.** Relative words never land on
a weekend while skipping is on. Pass the date itself, "add this to 2026-10-17",
or set `DSU_SKIP_WEEKENDS=false`.

**You write standups past midnight.** At 1am the "next day" is the one you are
already in, so `tomorrow` overshoots by a day. Name the day explicitly in that
window, or switch to `DSU_DEFAULT_DAY=today`.

**Holidays are not handled.** Only Saturday and Sunday are skipped. On the eve
of a public holiday, name the returning day explicitly.
