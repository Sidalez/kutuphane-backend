const { localClock } = require("./notificationLogic");
function activityPayload(latest, now, timeZone) {
  if (!latest) return { title: "Okuma yolculuğunu kaydet", body: "Henüz kayıtlı bir okuma oturumun yok. Bugün birkaç sayfa okuyup ilk kaydını eklemeye ne dersin?", url: "/library" };
  const clock = localClock(new Date(latest.started), timeZone);
  const today = localClock(now, timeZone).date;
  const days = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${clock.date}T00:00:00Z`)) / 86400000));
  const date = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone }).format(new Date(latest.started));
  const when = days === 0 ? "Bugün" : days === 1 ? "Dün" : date;
  const time = latest.hasTime ? ` ${clock.time.replace(":", ".")} saatinde` : "";
  const title = String(latest.book.title || "Kitabın").trim().replace(/\s+/g, " ").slice(0, 85);
  const gap = days === 0 ? "Bugünkü ritmini koru." : `Son okuma kaydının üzerinden ${days} gün geçti.`;
  return { title: "Okuma ritmine küçük bir hatırlatma", body: `${when}${time} “${title}” için okuma kaydı ekledin. ${gap} Birkaç sayfayla devam etmeye ne dersin?`, url: latest.book.status === "OKUNUYOR" ? `/library/${encodeURIComponent(latest.book.id)}` : "/library" };
}
module.exports = { activityPayload };
