const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePhoneDigits,
  customerContactPhoneMatches,
  pickContactPhoneCustomer
} = require("../src/services/shopifyService");

test("normalizePhoneDigits compares Indian phone formats by last 10 digits", () => {
  assert.equal(normalizePhoneDigits("9967833007"), "9967833007");
  assert.equal(normalizePhoneDigits("+91 99678 33007"), "9967833007");
  assert.equal(normalizePhoneDigits("919967833007"), "9967833007");
});

test("customerContactPhoneMatches only checks customer contact phone", () => {
  assert.equal(customerContactPhoneMatches({ phone: "+919967833007" }, "9967833007"), true);
  assert.equal(customerContactPhoneMatches({ phone: "+919625330692" }, "9967833007"), false);
  assert.equal(customerContactPhoneMatches({ defaultAddress: { phone: "9967833007" } }, "9967833007"), false);
});

test("pickContactPhoneCustomer prefers exact contact phone match over earlier broad Shopify result", () => {
  const selected = pickContactPhoneCustomer(
    [
      { numericId: "address-match", phone: "+919625330692" },
      { numericId: "contact-match", phone: "+919967833007" }
    ],
    "9967833007"
  );

  assert.equal(selected.numericId, "contact-match");
});
