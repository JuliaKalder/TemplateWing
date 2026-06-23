/**
 * Pure aggregation helpers for the Usage dashboard. No messenger.* — fully
 * testable from Node.
 *
 * Time units are milliseconds throughout; callers pass `now` so tests are
 * deterministic.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * Build a flat row per template suitable for table rendering. Tracks:
 *   - usage count, last used (ISO string from storage),
 *   - days since last use (or null if never),
 *   - average inserts per week since createdAt (or `usageCount/1` if no createdAt).
 *
 * @param {Array<object>} templates
 * @param {Date} [now]
 */
export function buildUsageRows(templates, now = new Date()) {
  const nowMs = now.getTime();
  return (templates || []).map((t) => {
    const usageCount = Number(t.usageCount) || 0;
    const lastUsedMs = t.lastUsedAt ? Date.parse(t.lastUsedAt) : null;
    const daysSinceLast =
      lastUsedMs && Number.isFinite(lastUsedMs)
        ? Math.max(0, Math.floor((nowMs - lastUsedMs) / MS_PER_DAY))
        : null;
    const createdMs = t.createdAt ? Date.parse(t.createdAt) : null;
    let avgPerWeek = 0;
    if (usageCount > 0) {
      const ageMs =
        createdMs && Number.isFinite(createdMs)
          ? Math.max(MS_PER_WEEK, nowMs - createdMs)
          : MS_PER_WEEK;
      avgPerWeek = (usageCount * MS_PER_WEEK) / ageMs;
    }
    return {
      id: t.id,
      name: t.name || "",
      category: t.category || "",
      identities: Array.isArray(t.identities) ? t.identities.slice() : [],
      usageCount,
      lastUsedAt: t.lastUsedAt || null,
      daysSinceLast,
      avgPerWeek,
    };
  });
}

/**
 * Filter rows by "unused since N days" or "never used".
 *
 * @param {Array<object>} rows - From buildUsageRows().
 * @param {"all"|"never"|number} mode - Number is days (30/90/365 typical).
 */
export function filterUnusedSince(rows, mode) {
  if (mode === "all" || mode == null) return rows.slice();
  if (mode === "never") return rows.filter((r) => r.usageCount === 0);
  const days = Number(mode);
  if (!Number.isFinite(days) || days < 0) return rows.slice();
  return rows.filter((r) => r.daysSinceLast == null || r.daysSinceLast >= days);
}

/**
 * Sort a row list. Stable: ties keep input order, so chained sorts compose.
 *
 * @param {Array<object>} rows
 * @param {string} key - One of: name, category, usageCount, lastUsedAt, daysSinceLast, avgPerWeek.
 * @param {"asc"|"desc"} dir
 */
export function sortRows(rows, key, dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const va = a.r[key];
      const vb = b.r[key];
      // Nulls go to the end regardless of direction so "never used" sits at
      // the bottom of "most-used" lists, where it's most useful.
      if (va == null && vb == null) return a.i - b.i;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        if (va === vb) return a.i - b.i;
        return (va - vb) * sign;
      }
      const cmp = String(va).localeCompare(String(vb));
      if (cmp === 0) return a.i - b.i;
      return cmp * sign;
    })
    .map((x) => x.r);
}

/** Return the top N rows by usageCount (descending). */
export function topNByUsage(rows, n) {
  return sortRows(rows, "usageCount", "desc").slice(0, Math.max(0, n));
}

/**
 * RFC-4180 CSV serialization. Always quotes every field for simplicity and
 * uniform parsing. Quote-escapes embedded quotes by doubling them. Uses
 * CRLF line endings as the spec requires.
 *
 * @param {string[]} headers
 * @param {Array<Array<string|number|null>>} rows
 */
export function toCSV(headers, rows) {
  function field(v) {
    const s = v == null ? "" : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }
  const head = headers.map(field).join(",");
  const body = rows.map((r) => r.map(field).join(",")).join("\r\n");
  return body ? head + "\r\n" + body + "\r\n" : head + "\r\n";
}

/** Build the standard CSV filename for today's export: templatewing-usage-YYYY-MM-DD.csv */
export function csvFilename(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `templatewing-usage-${y}-${m}-${d}.csv`;
}
