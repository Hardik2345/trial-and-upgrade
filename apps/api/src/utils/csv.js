function escapeCSV(value) {
  const normalized = value == null ? "" : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => escapeCSV(row[header])).join(","));
  return [headers.join(","), ...body].join("\r\n");
}

module.exports = { toCSV };
