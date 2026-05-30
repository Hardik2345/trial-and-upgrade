const test = require("node:test");
const assert = require("node:assert/strict");
const { toCSV } = require("../src/utils/csv");

test("toCSV escapes quotes", () => {
  const csv = toCSV([{ Name: 'A "Quoted" Name', Mobile: "9876543210" }]);
  assert.equal(csv, 'Name,Mobile\r\n"A ""Quoted"" Name","9876543210"');
});
