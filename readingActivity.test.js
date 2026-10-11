const { test } = require("node:test");
const assert = require("node:assert/strict");
const { activityPayload } = require("./readingActivity");
test("activity notices count local calendar days and distinguish reading from a saved record", () => {
  const latest = { started: Date.parse("2026-10-08T17:00:00Z"), hasTime: true, book: { id: "b", title: "Kitabım", status: "OKUNUYOR" } };
  const result = activityPayload(latest, new Date("2026-10-10T22:30:00Z"), "Europe/Istanbul");
  assert.match(result.body, /8 Ekim 2026 20\.00/);
  assert.match(result.body, /üzerinden 3 gün geçti/);
  assert.equal(result.url, "/library/b");
});
test("today does not claim inactivity and missing times are not invented", () => {
  const result = activityPayload({ started: Date.parse("2026-10-10T21:00:00Z"), hasTime: false, book: { id: "b", title: "Kitap", status: "OKUNDU" } }, new Date("2026-10-10T22:30:00Z"), "Europe/Istanbul");
  assert.match(result.body, /^Bugün /);
  assert.doesNotMatch(result.body, /saatinde|gün geçti/);
  assert.equal(result.url, "/library");
});
test("no recorded sessions produces an honest first-session invitation", () => {
  assert.match(activityPayload(null, new Date(), "Europe/Istanbul").body, /Henüz kayıtlı bir okuma oturumun yok/);
});
