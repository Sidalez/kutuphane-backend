const DEFAULT_PREFERENCES = Object.freeze({
  enabled: false, episodes: true, seasons: true, reading: false, watching: false,
  quietEnabled: true, quietStart: "22:00", quietEnd: "09:00",
  delivery: "instant", digestTime: "20:00", reminderTime: "20:30", timeZone: "Europe/Istanbul",
});
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
function preferences(input = {}) {
  const result = { ...DEFAULT_PREFERENCES };
  for (const key of ["enabled", "episodes", "seasons", "reading", "watching", "quietEnabled"]) {
    if (typeof input[key] === "boolean") result[key] = input[key];
  }
  for (const key of ["quietStart", "quietEnd", "digestTime", "reminderTime"]) {
    if (timePattern.test(input[key] || "")) result[key] = input[key];
  }
  if (input.delivery === "daily") result.delivery = "daily";
  try { if (typeof input.timeZone === "string" && input.timeZone.length < 80) { new Intl.DateTimeFormat("en", { timeZone: input.timeZone }); result.timeZone = input.timeZone; } } catch {}
  return result;
}
function localClock(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
function isQuiet(time, p) {
  if (!p.quietEnabled || p.quietStart === p.quietEnd) return false;
  return p.quietStart < p.quietEnd ? time >= p.quietStart && time < p.quietEnd : time >= p.quietStart || time < p.quietEnd;
}
function validSubscription(value) {
  try {
    const url = new URL(value.endpoint);
    const allowed = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com", "wns.windows.com"];
    return url.protocol === "https:" && (!url.port || url.port === "443") && !url.username && !url.password && !url.hash &&
      value.endpoint.length < 2048 && allowed.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) &&
      /^[A-Za-z0-9_-]{87}={0,2}$/.test(value.keys?.p256dh || "") && /^[A-Za-z0-9_-]{22}={0,2}$/.test(value.keys?.auth || "");
  } catch { return false; }
}
function episodeEvents(item, episodes, since, today) {
  const seen = new Set((item.watchedEpisodes || []).map(e => `${e.seasonNumber}:${e.episodeNumber}`));
  const unique = new Map();
  for (const episode of episodes) {
    const season = Number(episode.season_number), number = Number(episode.episode_number);
    const airDate = episode.air_date;
    if (!Number.isInteger(season) || season < 1 || !Number.isInteger(number) || number < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(airDate || "")) continue;
    if (airDate < since || airDate > today || seen.has(`${season}:${number}`)) continue;
    const id = `episode_${item.tmdbId}_${season}_${number}`;
    unique.set(id, { id, kind: "episode", title: `${item.title} · Yeni bölüm`,
      body: `${season}. sezon, ${number}. bölüm yayında${episode.name ? `: ${String(episode.name).slice(0, 120)}` : "."}`,
      url: `/media/${encodeURIComponent(item.id)}`, airDate });
  }
  return [...unique.values()];
}
module.exports = { DEFAULT_PREFERENCES, preferences, localClock, isQuiet, validSubscription, episodeEvents };
