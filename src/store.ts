import { promises as fs, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SECTIONS = ["Yesterday", "Today", "Blockers"] as const;
export type Section = (typeof SECTIONS)[number];
export type Entry = Record<Section, string[]>;

/**
 * Where the user's Documents folder lives. macOS and Linux keep it at
 * ~/Documents. Windows usually does too, but a OneDrive-backed account
 * redirects it under the OneDrive folder, so look there first when the
 * plain path is missing.
 */
function documentsDir(): string {
  const home = os.homedir();
  const candidates = [path.join(home, "Documents")];

  if (process.platform === "win32") {
    const oneDrive = process.env.OneDrive ?? process.env.OneDriveConsumer;
    if (oneDrive) candidates.unshift(path.join(oneDrive, "Documents"));
    if (process.env.USERPROFILE) {
      candidates.push(path.join(process.env.USERPROFILE, "Documents"));
    }
  }

  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

/**
 * Logs live in the user's Documents folder so they survive the plugin being
 * reinstalled or moved. Set DSU_LOG_DIR to put them somewhere else.
 */
export const LOG_DIR = process.env.DSU_LOG_DIR
  ? path.resolve(process.env.DSU_LOG_DIR)
  : path.join(documentsDir(), "daily-status", "logs");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Placeholder bullet written for an empty section; never treated as an item. */
export const EMPTY_PLACEHOLDER = "_nothing recorded_";

/**
 * Which day a call means when it gives no date. Standups are usually written
 * the evening before the meeting, so this defaults to tomorrow.
 *
 * DSU_DEFAULT_DAY accepts:
 *   tomorrow (default) - always the next calendar day
 *   today              - always the current calendar day
 *   evening            - tomorrow from DSU_EVENING_HOUR onwards, today before it
 */
const MODES = ["tomorrow", "today", "evening"] as const;
type Mode = (typeof MODES)[number];

export const DEFAULT_DAY: Mode =
  MODES.find((m) => m === process.env.DSU_DEFAULT_DAY?.trim().toLowerCase()) ??
  "tomorrow";

/** Hour (0-23) at which "evening" mode starts pointing at tomorrow. */
export const EVENING_HOUR = (() => {
  const raw = Number(process.env.DSU_EVENING_HOUR);
  return Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : 18;
})();

/**
 * Standups run on working days, so the day after Friday is Monday. Set
 * DSU_SKIP_WEEKENDS=false to treat Saturday and Sunday as ordinary days.
 */
export const SKIP_WEEKENDS =
  process.env.DSU_SKIP_WEEKENDS?.trim().toLowerCase() !== "false";

function stamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today in the machine's local timezone, not UTC. */
export function today(): string {
  return stamp(new Date());
}

/** Shift a YYYY-MM-DD date by whole days, rolling months and years over. */
export function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return stamp(new Date(y, m - 1, d + days));
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function dayName(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DAY_NAMES[new Date(y, m - 1, d).getDay()];
}

export function isWeekend(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

/**
 * Move one working day in `dir`. Friday + 1 is Monday, Monday - 1 is Friday.
 */
export function step(date: string, dir: 1 | -1): string {
  let out = shift(date, dir);
  while (SKIP_WEEKENDS && isWeekend(out)) out = shift(out, dir);
  return out;
}

/** The given date, or the next working day if it falls on a weekend. */
export function toWorkday(date: string): string {
  let out = date;
  while (SKIP_WEEKENDS && isWeekend(out)) out = shift(out, 1);
  return out;
}

/** The day a call lands on when it passes no date. */
export function defaultDate(): string {
  if (DEFAULT_DAY === "today") return today();
  if (DEFAULT_DAY === "evening" && new Date().getHours() < EVENING_HOUR) {
    return toWorkday(today());
  }
  return step(today(), 1);
}

/**
 * Relative words count in working days, so "yesterday" on a Monday is Friday.
 * Pass an explicit YYYY-MM-DD to reach a weekend.
 */
const RELATIVE: Record<string, (from: string) => string> = {
  yesterday: (from) => step(from, -1),
  today: (from) => from,
  tomorrow: (from) => step(from, 1),
};

export function normalizeDate(date?: string): string {
  if (!date) return defaultDate();
  const key = date.trim().toLowerCase();
  if (key in RELATIVE) return RELATIVE[key](today());
  if (!DATE_RE.test(date)) {
    throw new Error(
      `Invalid date "${date}". Use YYYY-MM-DD, or one of: yesterday, today, tomorrow.`
    );
  }
  return date;
}

export function normalizeSection(input: string): Section {
  const match = SECTIONS.find(
    (s) => s.toLowerCase() === input.trim().toLowerCase()
  );
  if (!match) {
    throw new Error(
      `Invalid section "${input}". Must be one of: ${SECTIONS.join(", ")}.`
    );
  }
  return match;
}

function emptyEntry(): Entry {
  return { Yesterday: [], Today: [], Blockers: [] };
}

function filePath(date: string): string {
  return path.join(LOG_DIR, `${date}.md`);
}

export function parse(markdown: string): Entry {
  const entry = emptyEntry();
  let current: Section | null = null;

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      const name = SECTIONS.find(
        (s) => s.toLowerCase() === heading[1].trim().toLowerCase()
      );
      current = name ?? null;
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item && current) {
      const text = item[1].trim();
      if (text && text !== EMPTY_PLACEHOLDER) entry[current].push(text);
    }
  }
  return entry;
}

export function render(date: string, entry: Entry): string {
  const body = SECTIONS.map((section) => {
    const items = entry[section];
    const lines = items.length
      ? items.map((i) => `- ${i}`).join("\n")
      : `- ${EMPTY_PLACEHOLDER}`;
    return `## ${section}\n${lines}`;
  }).join("\n\n");

  return `# Daily Standup - ${date}\n\n${body}\n`;
}

export async function read(date: string): Promise<Entry> {
  try {
    return parse(await fs.readFile(filePath(date), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyEntry();
    throw err;
  }
}

export async function write(date: string, entry: Entry): Promise<string> {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const target = filePath(date);
  await fs.writeFile(target, render(date, entry), "utf8");
  return target;
}

export async function exists(date: string): Promise<boolean> {
  try {
    await fs.access(filePath(date));
    return true;
  } catch {
    return false;
  }
}

export async function listDates(): Promise<string[]> {
  try {
    const files = await fs.readdir(LOG_DIR);
    return files
      .filter((f) => f.endsWith(".md") && DATE_RE.test(f.slice(0, -3)))
      .map((f) => f.slice(0, -3))
      .sort()
      .reverse();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export function pathFor(date: string): string {
  return filePath(date);
}
