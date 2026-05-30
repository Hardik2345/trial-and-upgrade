const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePhone, maskPhone, hashPhone, safeCompare } = require("../src/utils/crypto");

test("normalizes Indian mobile numbers", () => {
  assert.equal(normalizePhone("+91 98765 43210"), "9876543210");
  assert.equal(normalizePhone("98765-43210"), "9876543210");
});

test("masks phone numbers for display", () => {
  assert.equal(maskPhone("9876543210"), "98******10");
});

test("phone hash is scoped by tenant", () => {
  assert.notEqual(hashPhone("9876543210", "store-a"), hashPhone("9876543210", "store-b"));
  assert.equal(hashPhone("+91 9876543210", "store-a"), hashPhone("9876543210", "store-a"));
});

test("safeCompare handles mismatched values", () => {
  assert.equal(safeCompare("abc", "abc"), true);
  assert.equal(safeCompare("abc", "abcd"), false);
});
