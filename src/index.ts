import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  DEFAULT_DAY,
  Entry,
  LOG_DIR,
  SECTIONS,
  SKIP_WEEKENDS,
  Section,
  dayName,
  defaultDate,
  listDates,
  normalizeDate,
  normalizeSection,
  pathFor,
  read,
  render,
  write,
} from "./store.js";

const DAY_WORD = SKIP_WEEKENDS ? "working day" : "calendar day";

const DEFAULT_DAY_TEXT = {
  tomorrow: `the next ${DAY_WORD}`,
  today: "the current day",
  evening: `the next ${DAY_WORD} in the evening, the current one before that`,
}[DEFAULT_DAY];

const dateProp = {
  type: "string" as const,
  description:
    `Day of the standup as YYYY-MM-DD, or one of: yesterday, today, tomorrow. ` +
    `Omit it unless the user names a specific day; the default is ` +
    `${DEFAULT_DAY_TEXT}, in local time.` +
    (SKIP_WEEKENDS
      ? ` Relative words count in working days, so "tomorrow" on a Friday is ` +
        `Monday and "yesterday" on a Monday is Friday. Use an explicit ` +
        `YYYY-MM-DD to reach a Saturday or Sunday.`
      : ""),
};

const SECTION_GUIDE =
  `Sections are read from the standup day's point of view: Yesterday is work ` +
  `already done, Today is what is planned for the standup day itself, ` +
  `Blockers is what is in the way. Undated calls land on ${DEFAULT_DAY_TEXT}, ` +
  `so work the user reports doing on the current day belongs in Yesterday ` +
  `whenever the entry is for a later day.`;

const sectionFilterProp = {
  type: "string" as const,
  enum: [...SECTIONS],
  description:
    "Optional. Only look for the item in this section. Use it when the same " +
    "text appears in more than one section.",
};

const TOOLS = [
  {
    name: "get_dsu",
    description:
      "Read the standup entry for a day and return it as markdown with the Yesterday, Today and Blockers sections.",
    inputSchema: {
      type: "object",
      properties: { date: dateProp },
      additionalProperties: false,
    },
  },
  {
    name: "add_dsu_items",
    description:
      "Append one or more items to a section of a day's standup entry. Creates the file if it does not exist. Duplicate items in the same section are skipped.",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: [...SECTIONS],
          description: `Which section the items belong to. ${SECTION_GUIDE}`,
        },
        items: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Item texts to append, one per bullet.",
        },
        date: dateProp,
      },
      required: ["section", "items"],
      additionalProperties: false,
    },
  },
  {
    name: "update_dsu_item",
    description:
      "Replace an existing item's text with new text. Matches old_text exactly first, then case-insensitively, then as a unique substring. Optionally moves the item to a different section.",
    inputSchema: {
      type: "object",
      properties: {
        old_text: {
          type: "string",
          description: "The existing item text to find.",
        },
        new_text: { type: "string", description: "The replacement text." },
        from_section: sectionFilterProp,
        section: {
          type: "string",
          enum: [...SECTIONS],
          description:
            "Optional. Move the item into this section as part of the " +
            `update. ${SECTION_GUIDE}`,
        },
        date: dateProp,
      },
      required: ["old_text", "new_text"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_dsu_item",
    description:
      "Delete an item from a day's standup entry. Matching works the same way as update_dsu_item.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The item text to delete." },
        section: sectionFilterProp,
        date: dateProp,
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "list_dsu_dates",
    description:
      "List the dates that have a saved standup entry, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          description: "Maximum number of dates to return. Default 30.",
        },
      },
      additionalProperties: false,
    },
  },
];

type Hit = { section: Section; index: number };

function findItem(entry: Entry, needle: string, scope?: Section): Hit[] {
  const target = needle.trim();
  const searched = scope ? [scope] : SECTIONS;
  const passes: ((item: string) => boolean)[] = [
    (item) => item === target,
    (item) => item.toLowerCase() === target.toLowerCase(),
    (item) => item.toLowerCase().includes(target.toLowerCase()),
  ];

  for (const matches of passes) {
    const hits: Hit[] = [];
    for (const section of searched) {
      entry[section].forEach((item, index) => {
        if (matches(item)) hits.push({ section, index });
      });
    }
    if (hits.length) return hits;
  }
  return [];
}

function describeHits(entry: Entry, hits: Hit[]): string {
  return hits
    .map((h) => `  - [${h.section}] ${entry[h.section][h.index]}`)
    .join("\n");
}

function allItems(entry: Entry, scope?: Section): string {
  const lines = (scope ? [scope] : SECTIONS).flatMap((s) =>
    entry[s].map((i) => `  - [${s}] ${i}`)
  );
  if (lines.length) return lines.join("\n");
  return scope ? `  (${scope} is empty)` : "  (the entry is empty)";
}

/** Suggest the narrowing that would have made an ambiguous match unique. */
function narrowingHint(hits: Hit[], param: string): string {
  const sections = [...new Set(hits.map((h) => h.section))];
  return sections.length > 1
    ? ` Pass ${param} (${sections.join(" or ")}) or use more specific text:`
    : " Be more specific:";
}

async function handle(name: string, args: Record<string, any>) {
  switch (name) {
    case "get_dsu": {
      const date = normalizeDate(args.date);
      const entry = await read(date);
      return `${render(date, entry)}\nSaved at: ${pathFor(date)}`;
    }

    case "add_dsu_items": {
      const date = normalizeDate(args.date);
      const section = normalizeSection(String(args.section));
      const incoming: string[] = Array.isArray(args.items) ? args.items : [];
      const cleaned = incoming.map((i) => String(i).trim()).filter(Boolean);
      if (!cleaned.length) throw new Error("No non-empty items were provided.");

      const entry = await read(date);
      const added: string[] = [];
      const skipped: string[] = [];
      for (const item of cleaned) {
        if (entry[section].some((e) => e.toLowerCase() === item.toLowerCase())) {
          skipped.push(item);
        } else {
          entry[section].push(item);
          added.push(item);
        }
      }
      const file = await write(date, entry);

      const parts = [
        `Added ${added.length} item(s) to ${section} for ${date}.`,
        ...added.map((i) => `  + ${i}`),
      ];
      if (skipped.length) {
        parts.push(`Skipped ${skipped.length} duplicate(s):`);
        parts.push(...skipped.map((i) => `  = ${i}`));
      }
      parts.push(`Saved at: ${file}`);
      return parts.join("\n");
    }

    case "update_dsu_item": {
      const date = normalizeDate(args.date);
      const entry = await read(date);
      const oldText = String(args.old_text ?? "").trim();
      const newText = String(args.new_text ?? "").trim();
      if (!oldText) throw new Error("old_text must not be empty.");
      if (!newText) throw new Error("new_text must not be empty.");

      const from = args.from_section
        ? normalizeSection(String(args.from_section))
        : undefined;
      const where = from ? ` ${from} section of the` : "";

      const hits = findItem(entry, oldText, from);
      if (!hits.length) {
        throw new Error(
          `No item matching "${oldText}" in the${where} ${date} entry. Current items:\n${allItems(
            entry,
            from
          )}`
        );
      }
      if (hits.length > 1) {
        throw new Error(
          `"${oldText}" matches ${hits.length} items in the${where} ${date} ` +
            `entry.${narrowingHint(hits, "from_section")}\n${describeHits(
              entry,
              hits
            )}`
        );
      }

      const hit = hits[0];
      const previous = entry[hit.section][hit.index];
      const moveTo = args.section
        ? normalizeSection(String(args.section))
        : hit.section;

      if (moveTo === hit.section) {
        entry[hit.section][hit.index] = newText;
      } else {
        entry[hit.section].splice(hit.index, 1);
        entry[moveTo].push(newText);
      }
      const file = await write(date, entry);

      const moved =
        moveTo === hit.section ? "" : ` (moved ${hit.section} -> ${moveTo})`;
      return [
        `Updated 1 item in ${date}${moved}.`,
        `  - was: ${previous}`,
        `  - now: ${newText}`,
        `Saved at: ${file}`,
      ].join("\n");
    }

    case "remove_dsu_item": {
      const date = normalizeDate(args.date);
      const entry = await read(date);
      const text = String(args.text ?? "").trim();
      if (!text) throw new Error("text must not be empty.");

      const section = args.section
        ? normalizeSection(String(args.section))
        : undefined;
      const where = section ? ` ${section} section of the` : "";

      const hits = findItem(entry, text, section);
      if (!hits.length) {
        throw new Error(
          `No item matching "${text}" in the${where} ${date} entry. Current items:\n${allItems(
            entry,
            section
          )}`
        );
      }
      if (hits.length > 1) {
        throw new Error(
          `"${text}" matches ${hits.length} items in the${where} ${date} ` +
            `entry.${narrowingHint(hits, "section")}\n${describeHits(
              entry,
              hits
            )}`
        );
      }

      const hit = hits[0];
      const [removed] = entry[hit.section].splice(hit.index, 1);
      const file = await write(date, entry);
      return [
        `Removed 1 item from ${hit.section} for ${date}.`,
        `  - ${removed}`,
        `Saved at: ${file}`,
      ].join("\n");
    }

    case "list_dsu_dates": {
      const limit =
        typeof args.limit === "number" && args.limit > 0 ? args.limit : 30;
      const dates = await listDates();
      if (!dates.length) return `No standup entries saved yet in ${LOG_DIR}.`;
      return [
        `${dates.length} entry/entries in ${LOG_DIR} (newest first):`,
        ...dates.slice(0, limit).map((d) => `  - ${d}`),
      ].join("\n");
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: "daily-status-mcp", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, any>;
  try {
    const text = await handle(request.params.name, args);
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return {
      content: [
        { type: "text", text: err instanceof Error ? err.message : String(err) },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `daily-status-mcp ready. Logs: ${LOG_DIR}\n` +
    `Undated calls go to ${defaultDate()} (${dayName(defaultDate())}), ` +
    `DSU_DEFAULT_DAY=${DEFAULT_DAY}, ` +
    `weekends ${SKIP_WEEKENDS ? "skipped" : "included"}.`
);
