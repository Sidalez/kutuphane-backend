const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sessionStart, readingEvent } = require("./readingReminder");
test("session times resolve explicit instants and legacy Turkish midnight correctly", () => {
  assert.equal(sessionStart({ startedAt: "2026-10-10T17:00:00Z" }, "Europe/Istanbul"), Date.parse("2026-10-10T17:00:00Z"));
  assert.equal(sessionStart({ date: "2026-10-11", startTime: "00:30" }, "Europe/Istanbul"), Date.parse("2026-10-10T21:30:00Z"));
  assert.equal(sessionStart({ date: "2026-10-10" }, "Europe/Istanbul"), null);
  assert.equal(sessionStart({ date: "2026-03-29", startTime: "02:30" }, "Europe/Berlin"), null);
});
test("reminders become due after exactly 24 elapsed hours and expire after another day", () => {
  const book = { id: "book1", title: "Bir Kitap", status: "OKUNUYOR", pagesRead: 42 };
  const session = { id: "log1", started: Date.parse("2026-10-10T17:00:00Z"), log: { startTime: "20:00", endTime: "20:25", startPage: 24, endPage: 42 } };
  assert.equal(readingEvent(book, session, new Date("2026-10-11T16:59:59Z"), "Europe/Istanbul"), null);
  const event = readingEvent(book, session, new Date("2026-10-11T17:00:00Z"), "Europe/Istanbul");
  assert.match(event.body, /Dün 20\.00 saatinde 25 dakika okuyarak 18 sayfa ilerledin/);
  assert.match(event.body, /42\. sayfadan/);
  assert.equal(event.url, "/library/book1");
  assert.equal(readingEvent(book, session, new Date("2026-10-12T17:00:00Z"), "Europe/Istanbul"), null);
  assert.equal(readingEvent({ ...book, status: "OKUNDU" }, session, new Date("2026-10-11T17:00:00Z"), "Europe/Istanbul"), null);
});
test("overnight reading duration is calculated without fabricating missing duration", () => {
  const book = { id: "b", title: "Gece", status: "OKUNUYOR", pagesRead: 12 };
  const session = { id: "l", started: Date.parse("2026-10-10T20:50:00Z"), log: { startTime: "23:50", endTime: "00:20", totalRead: 10 } };
  const now = new Date("2026-10-11T20:50:00Z");
  assert.match(readingEvent(book, session, now, "Europe/Istanbul").body, /30 dakika/);
  assert.doesNotMatch(readingEvent(book, { ...session, log: { totalRead: 10 } }, now, "Europe/Istanbul").body, /dakika/);
});
