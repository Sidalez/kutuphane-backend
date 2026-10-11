const { localClock } = require("./notificationLogic");
const day = 86400000;
function sessionStart(log, timeZone) {
  if (typeof log.startedAt === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(log.startedAt)) {
    const value = Date.parse(log.startedAt);
    if (Number.isFinite(value)) return value;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(log.date || "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(log.startTime || "")) return null;
  // Older logs stored local date/time only. Resolve them in the user's saved time zone.
  const target = Date.parse(`${log.date}T${log.startTime}:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== log.date) return null;
  let value = target;
  for (let i = 0; i < 4; i++) {
    const clock = localClock(new Date(value), timeZone);
    const delta = target - Date.parse(`${clock.date}T${clock.time}:00Z`);
    if (!delta) return value;
    value += delta;
  }
  return null; // Do not invent a time for a nonexistent daylight-saving local hour.
}
function readingEvent(book, session, now, timeZone) {
  const started = session.started;
  const dueAt = started + day;
  if (now.getTime() < dueAt || now.getTime() >= dueAt + day || book.status !== "OKUNUYOR") return null;
  const log = session.log;
  const pages = Number(log.totalRead ?? Number(log.endPage) - Number(log.startPage));
  let minutes = Number(log.durationMinutes);
  if (!(minutes > 0) && /^([01]\d|2[0-3]):[0-5]\d$/.test(log.endTime || "") && /^([01]\d|2[0-3]):[0-5]\d$/.test(log.startTime || "")) {
    const clockMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    minutes = (clockMinutes(log.endTime) - clockMinutes(log.startTime) + 1440) % 1440;
  }
  const page = Number(book.pagesRead);
  const time = localClock(new Date(started), timeZone).time.replace(":", ".");
  const yesterday = new Date(`${localClock(now, timeZone).date}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const when = localClock(new Date(started), timeZone).date === yesterday.toISOString().slice(0, 10) ? `Dün ${time} saatinde` : "Son oturumunda";
  const duration = Number.isFinite(minutes) && minutes > 0 && minutes <= 1440 ? `${Math.round(minutes)} dakika okuyarak ` : "";
  const hasPages = Number.isSafeInteger(pages) && pages > 0;
  const progress = hasPages ? `${duration}${pages} sayfa ilerledin.` : duration ? `${Math.round(minutes)} dakika okudun.` : "okumaya zaman ayırdın.";
  const position = Number.isSafeInteger(page) && page > 0 ? ` ${page}. sayfadan devam etmeye ne dersin?` : " Kaldığın yerden devam etmeye ne dersin?";
  return { kind: "readingFollowUp", title: "Okuma ritmini sürdür", body: `“${String(book.title).trim().replace(/\s+/g, " ").slice(0, 100)}”: ${when} ${progress}${position}`, url: `/library/${encodeURIComponent(book.id)}`, bookId: book.id, logId: session.id, dueAt, expiresAt: dueAt + day };
}
module.exports = { sessionStart, readingEvent };
