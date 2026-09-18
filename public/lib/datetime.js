// Date, time, duration, and cron utilities.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function parseMoment(input, unit = "auto") {
  const trimmed = String(input).trim();
  if (!trimmed) throw new Error("Enter a date, time, or Unix timestamp");
  if (/^now$/i.test(trimmed)) return new Date();
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    const digits = trimmed.replace(/^[+-]/, "").split(".")[0].length;
    const resolved = unit === "auto" ? (digits >= 16 ? "microseconds" : digits >= 13 ? "milliseconds" : "seconds") : unit;
    const milliseconds = resolved === "seconds" ? numeric * 1000 : resolved === "microseconds" ? numeric / 1000 : resolved === "nanoseconds" ? numeric / 1e6 : numeric;
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) throw new Error("That timestamp is outside the supported range");
    return date;
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(trimmed) ? trimmed.replace(" ", "T") : trimmed;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error(`"${trimmed}" is not a date we can read — try ISO 8601, RFC 2822, or a Unix timestamp`);
  return date;
}

export function describeMoment(input, unit = "auto", timeZone = "UTC") {
  const date = parseMoment(input, unit);
  const milliseconds = date.getTime();
  const rows = [
    ["ISO 8601 (UTC)", date.toISOString()],
    ["RFC 2822", date.toUTCString()],
    ["Unix seconds", String(Math.floor(milliseconds / 1000))],
    ["Unix milliseconds", String(milliseconds)],
    ["Unix microseconds", String(milliseconds * 1000)],
    ["Relative", relativeTime(milliseconds - Date.now())],
    ["", ""],
    ["Day of week", DAYS[date.getUTCDay()]],
    ["Month", MONTHS[date.getUTCMonth()]],
    ["Day of year", String(dayOfYear(date))],
    ["ISO week", isoWeek(date)],
    ["Quarter", `Q${Math.floor(date.getUTCMonth() / 3) + 1}`],
    ["Leap year", isLeapYear(date.getUTCFullYear()) ? "yes" : "no"],
    ["Excel serial", excelSerial(date).toFixed(6)],
    ["Windows FILETIME", String(BigInt(milliseconds) * 10000n + 116444736000000000n)],
    ["Mac HFS+", String(Math.floor(milliseconds / 1000) + 2082844800)],
  ];
  let zoneRow = [];
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "full", timeStyle: "long" });
    zoneRow = [["", ""], [`In ${timeZone}`, formatter.format(date)]];
  } catch {
    zoneRow = [["", ""], [`In ${timeZone}`, "That time zone is not available in this browser"]];
  }
  const all = [...rows, ...zoneRow];
  const width = Math.max(...all.filter(([label]) => label).map(([label]) => label.length));
  return all.map(([label, value]) => (label ? `${label.padEnd(width)}  ${value}` : "")).join("\n");
}

export function formatMoment(input, unit, pattern) {
  const date = parseMoment(input, unit);
  const patterns = {
    "ISO 8601": date.toISOString(),
    "ISO date": date.toISOString().slice(0, 10),
    "ISO time": date.toISOString().slice(11, 19),
    "RFC 2822": date.toUTCString(),
    "Unix seconds": String(Math.floor(date.getTime() / 1000)),
    "Unix milliseconds": String(date.getTime()),
    "SQL datetime": date.toISOString().slice(0, 19).replace("T", " "),
    "HTTP date": date.toUTCString(),
    "Compact": date.toISOString().replace(/[-:]/g, "").slice(0, 15).concat("Z"),
  };
  if (!(pattern in patterns)) throw new Error(`Unknown output format "${pattern}"`);
  return patterns[pattern];
}

function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86400000);
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isoWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function excelSerial(date) {
  return date.getTime() / 86400000 + 25569;
}

export function relativeTime(deltaMilliseconds) {
  const units = [["year", 31556952000], ["month", 2629746000], ["week", 604800000], ["day", 86400000], ["hour", 3600000], ["minute", 60000], ["second", 1000]];
  const magnitude = Math.abs(deltaMilliseconds);
  if (magnitude < 1000) return "just now";
  for (const [name, size] of units) {
    if (magnitude >= size) {
      const value = Math.round(magnitude / size);
      const label = `${value} ${name}${value === 1 ? "" : "s"}`;
      return deltaMilliseconds < 0 ? `${label} ago` : `in ${label}`;
    }
  }
  return "just now";
}

export function dateDifference(from, to) {
  const start = parseMoment(from);
  const end = parseMoment(to);
  const delta = end.getTime() - start.getTime();
  const seconds = Math.abs(delta) / 1000;
  let years = end.getUTCFullYear() - start.getUTCFullYear();
  let months = end.getUTCMonth() - start.getUTCMonth();
  let days = end.getUTCDate() - start.getUTCDate();
  if (days < 0) { months--; days += new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate(); }
  if (months < 0) { years--; months += 12; }
  const rows = [
    ["From", start.toISOString()],
    ["To", end.toISOString()],
    ["Direction", delta < 0 ? "backwards" : "forwards"],
    ["", ""],
    ["Calendar", `${years} years, ${months} months, ${days} days`],
    ["Total days", (seconds / 86400).toFixed(4)],
    ["Total hours", (seconds / 3600).toFixed(2)],
    ["Total minutes", (seconds / 60).toFixed(2)],
    ["Total seconds", String(Math.round(seconds))],
    ["Milliseconds", String(Math.abs(delta))],
    ["Business days", String(businessDays(start, end))],
  ];
  const width = Math.max(...rows.filter(([label]) => label).map(([label]) => label.length));
  return rows.map(([label, value]) => (label ? `${label.padEnd(width)}  ${value}` : "")).join("\n");
}

function businessDays(start, end) {
  const [from, to] = start <= end ? [start, end] : [end, start];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  let count = 0;
  let guard = 0;
  while (cursor.getTime() < last && guard++ < 400000) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/* ------------------------------------------------------------ durations -- */

const DURATION_UNITS = { nanoseconds: 1e-6, microseconds: 0.001, milliseconds: 1, seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 };

export function convertDuration(input, from = "seconds") {
  const parsed = parseDuration(input, from);
  const rows = Object.entries(DURATION_UNITS).map(([name, size]) => [name, formatDurationNumber(parsed / size)]);
  rows.push(["", ""]);
  rows.push(["human readable", humanizeDuration(parsed)]);
  rows.push(["ISO 8601", isoDuration(parsed)]);
  rows.push(["clock", clockDuration(parsed)]);
  const width = Math.max(...rows.filter(([label]) => label).map(([label]) => label.length));
  return rows.map(([label, value]) => (label ? `${label.padEnd(width)}  ${value}` : "")).join("\n");
}

export function parseDuration(input, from = "seconds") {
  const trimmed = String(input).trim();
  if (!trimmed) throw new Error("Enter a duration");
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    const size = DURATION_UNITS[from];
    if (!size) throw new Error(`Unknown duration unit "${from}"`);
    return Number(trimmed) * size;
  }
  const iso = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(trimmed);
  if (iso && iso.slice(1).some(Boolean)) {
    return (Number(iso[1] || 0) * 86400 + Number(iso[2] || 0) * 3600 + Number(iso[3] || 0) * 60 + Number(iso[4] || 0)) * 1000;
  }
  const clock = /^(\d+):([0-5]?\d)(?::([0-5]?\d(?:\.\d+)?))?$/.exec(trimmed);
  if (clock) {
    return clock[3] === undefined
      ? (Number(clock[1]) * 60 + Number(clock[2])) * 1000
      : (Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])) * 1000;
  }
  const shorthand = [...trimmed.matchAll(/(\d+(?:\.\d+)?)\s*(ns|us|ms|s|m|h|d|w|sec|secs|min|mins|hr|hrs|day|days|week|weeks)(?![a-z])/gi)];
  if (shorthand.length) {
    const sizes = { ns: 1e-6, us: 0.001, ms: 1, s: 1000, sec: 1000, secs: 1000, m: 60000, min: 60000, mins: 60000, h: 3600000, hr: 3600000, hrs: 3600000, d: 86400000, day: 86400000, days: 86400000, w: 604800000, week: 604800000, weeks: 604800000 };
    return shorthand.reduce((total, match) => total + Number(match[1]) * sizes[match[2].toLowerCase()], 0);
  }
  throw new Error(`"${trimmed}" is not a duration we can read — try 90, 1h30m, 01:30:00, or PT1H30M`);
}

function formatDurationNumber(value) {
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  if (Math.abs(value) < 0.000001) return value.toExponential(4);
  return Number(value.toPrecision(10)).toLocaleString("en-US", { maximumFractionDigits: 10 });
}

export function humanizeDuration(milliseconds) {
  const negative = milliseconds < 0;
  let remaining = Math.abs(milliseconds);
  const units = [["week", 604800000], ["day", 86400000], ["hour", 3600000], ["minute", 60000], ["second", 1000], ["millisecond", 1]];
  const parts = [];
  for (const [name, size] of units) {
    const value = Math.floor(remaining / size);
    if (value > 0) { parts.push(`${value} ${name}${value === 1 ? "" : "s"}`); remaining -= value * size; }
    if (parts.length === 3) break;
  }
  if (!parts.length) return "0 milliseconds";
  return (negative ? "-" : "") + parts.join(", ");
}

function isoDuration(milliseconds) {
  const total = Math.abs(milliseconds) / 1000;
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Number((total % 60).toFixed(3));
  const time = [hours ? `${hours}H` : "", minutes ? `${minutes}M` : "", seconds ? `${seconds}S` : ""].join("");
  const result = `P${days ? `${days}D` : ""}${time ? `T${time}` : ""}`;
  return result === "P" ? "PT0S" : `${milliseconds < 0 ? "-" : ""}${result}`;
}

function clockDuration(milliseconds) {
  const total = Math.floor(Math.abs(milliseconds) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${milliseconds < 0 ? "-" : ""}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/* ----------------------------------------------------------------- cron -- */

const CRON_FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] },
  { name: "day of week", min: 0, max: 7, names: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] },
];

const CRON_ALIASES = {
  "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *",
};

export function parseCron(expression) {
  const trimmed = expression.trim().toLowerCase();
  const normalized = CRON_ALIASES[trimmed] ?? trimmed;
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) throw new Error(`A cron expression has five fields — this one has ${parts.length}`);
  return parts.map((part, index) => ({ field: CRON_FIELDS[index], raw: part, values: expandCronField(part, CRON_FIELDS[index]) }));
}

function expandCronField(part, field) {
  const values = new Set();
  for (const chunk of part.split(",")) {
    const [range, stepText] = chunk.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`"${chunk}" has an invalid step in the ${field.name} field`);
    let low;
    let high;
    if (range === "*" || range === "?") { low = field.min; high = field.max; }
    else if (range.includes("-")) {
      const [from, to] = range.split("-").map((value) => cronNumber(value, field));
      low = from;
      high = to;
    } else {
      low = cronNumber(range, field);
      high = stepText === undefined ? low : field.max;
    }
    if (low > high) throw new Error(`"${chunk}" describes a backwards range in the ${field.name} field`);
    for (let value = low; value <= high; value += step) values.add(field.name === "day of week" && value === 7 ? 0 : value);
  }
  if (!values.size) throw new Error(`The ${field.name} field matches nothing`);
  return [...values].sort((a, b) => a - b);
}

function cronNumber(text, field) {
  if (field.names) {
    const index = field.names.indexOf(text.slice(0, 3));
    if (index !== -1) return field.name === "month" ? index + 1 : index;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < field.min || value > field.max) {
    throw new Error(`"${text}" is out of range for the ${field.name} field (${field.min}–${field.max})`);
  }
  return value;
}

export function describeCron(expression, { runs = 5, from = new Date() } = {}) {
  const fields = parseCron(expression);
  const listing = fields.map(({ field, raw, values }) => {
    const summary = values.length > 12 ? `${values.length} values (${values[0]}–${values.at(-1)})` : values.join(", ");
    return `${field.name.padEnd(13)} ${raw.padEnd(12)} ${summary}`;
  });
  const next = nextCronRuns(fields, from, runs);
  return [
    `Expression     ${expression.trim()}`,
    `Summary        ${summarizeCron(fields)}`,
    "",
    "Field         Pattern      Matches",
    ...listing,
    "",
    `Next ${next.length} run${next.length === 1 ? "" : "s"} (UTC)`,
    ...next.map((date) => `  ${date.toISOString().replace(".000Z", "Z")}  ${DAYS[date.getUTCDay()]}`),
  ].join("\n");
}

function summarizeCron(fields) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const every = (entry) => entry.raw === "*" || entry.raw === "?";
  const time = every(hour)
    ? (every(minute) ? "every minute" : `at minute ${minute.values.join(", ")} of every hour`)
    : `at ${hour.values.flatMap((h) => minute.values.map((m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`)).slice(0, 6).join(", ")}`;
  const days = [];
  if (!every(dayOfMonth)) days.push(`on day ${dayOfMonth.values.join(", ")} of the month`);
  if (!every(dayOfWeek)) days.push(`on ${dayOfWeek.values.map((day) => DAYS[day]).join(", ")}`);
  if (!every(month)) days.push(`in ${month.values.map((value) => MONTHS[value - 1]).join(", ")}`);
  return [time, ...days].join(", ");
}

export function nextCronRuns(fields, from, count) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const results = [];
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const restrictDay = dayOfMonth.raw !== "*" && dayOfMonth.raw !== "?";
  const restrictWeekday = dayOfWeek.raw !== "*" && dayOfWeek.raw !== "?";
  // Skip whole months and days that cannot match so that sparse expressions
  // such as "0 0 29 2 *" resolve without walking every minute of four years.
  for (let guard = 0; guard < 200000 && results.length < count; guard++) {
    if (!month.values.includes(cursor.getUTCMonth() + 1)) {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!matchesDay(cursor, dayOfMonth, dayOfWeek, restrictDay, restrictWeekday)) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!hour.values.includes(cursor.getUTCHours())) {
      cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (minute.values.includes(cursor.getUTCMinutes())) results.push(new Date(cursor.getTime()));
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return results;
}

function matchesDay(date, dayOfMonth, dayOfWeek, restrictDay, restrictWeekday) {
  const dayMatch = dayOfMonth.values.includes(date.getUTCDate());
  const weekdayMatch = dayOfWeek.values.includes(date.getUTCDay());
  if (restrictDay && restrictWeekday) return dayMatch || weekdayMatch;
  if (restrictDay) return dayMatch;
  if (restrictWeekday) return weekdayMatch;
  return true;
}

export function buildCron({ minute = "*", hour = "*", dayOfMonth = "*", month = "*", dayOfWeek = "*" } = {}) {
  const expression = [minute, hour, dayOfMonth, month, dayOfWeek].join(" ");
  parseCron(expression);
  return expression;
}
