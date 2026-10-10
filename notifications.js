const { createHash, timingSafeEqual } = require("node:crypto");
const firebaseApp = require("firebase-admin/app");
const { getFirestore, FieldPath } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const firebaseAdmin = {
  credential: { cert: firebaseApp.cert, applicationDefault: firebaseApp.applicationDefault },
  initializeApp: (options, name) => {
    const app = firebaseApp.initializeApp(options, name);
    return { firestore: () => getFirestore(app), auth: () => getAuth(app) };
  },
  firestore: { FieldPath },
};
const webPush = require("web-push");
const { preferences, localClock, isQuiet, validSubscription, episodeEvents } = require("./notificationLogic");
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = (status, message) => Object.assign(new Error(message), { status });

function createNotificationService({ tmdbRequest, readBody, json }, dependencies = {}) {
  const admin = dependencies.admin || firebaseAdmin;
  const webpush = dependencies.webpush || webPush;
  let db, auth;
  const publicKey = (process.env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || "").trim();
  let pushReady = false;
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const credential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        ? admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) : admin.credential.applicationDefault();
      const app = admin.initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID || "kisiseltakipapp" }, "notifications");
      db = app.firestore(); auth = app.auth();
    }
  } catch { console.error("Bildirim kurulumu: Firebase hizmet hesabı başlatılamadı. FIREBASE_SERVICE_ACCOUNT_JSON ve FIREBASE_PROJECT_ID alanlarını kontrol et."); }
  try {
    const missing = [!publicKey && "VAPID_PUBLIC_KEY", !privateKey && "VAPID_PRIVATE_KEY"].filter(Boolean);
    if (missing.length) {
      console.error(`Bildirim kurulumu: eksik alan: ${missing.join(", ")}.`);
    } else {
      webpush.setVapidDetails((process.env.VAPID_SUBJECT || "https://kisiseltakip.vercel.app").trim(), publicKey, privateKey);
      pushReady = true;
    }
  } catch {
    const validKey = (value, bytes) => /^[A-Za-z0-9_-]+={0,2}$/.test(value) && Buffer.from(value, "base64url").length === bytes;
    if (!validKey(publicKey, 65)) console.error("Bildirim kurulumu: VAPID_PUBLIC_KEY biçimi geçersiz; yalnızca anahtar değerini kopyala.");
    else if (!validKey(privateKey, 32)) console.error("Bildirim kurulumu: VAPID_PRIVATE_KEY biçimi geçersiz; yalnızca anahtar değerini kopyala.");
    else console.error("Bildirim kurulumu: VAPID_SUBJECT veya VAPID anahtarları geçersiz. SUBJECT için https://kisiseltakip.vercel.app kullan.");
  }
  const ready = Boolean(db && auth);
  const accounts = () => db.collection("_notificationAccounts");
  const inbox = uid => accounts().doc(uid).collection("inbox");
  const subscriptions = uid => accounts().doc(uid).collection("devices");
  const rates = new Map();
  async function userId(req) {
    if (!ready) throw fail(503, "Bildirim sunucusu henüz etkinleştirilmedi. Kurulum tamamlandığında buradan açabilirsin.");
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1];
    if (!token) throw fail(401, "Bildirimlerini görmek için giriş yapmalısın.");
    let uid;
    try { uid = (await auth.verifyIdToken(token)).uid; } catch { throw fail(401, "Oturumun doğrulanamadı. Tekrar giriş yap."); }
    const now = Date.now();
    if (rates.size > 5000) for (const [key, value] of rates) if (value.until < now) rates.delete(key);
    const rate = rates.get(uid);
    if (rate && rate.until > now) { if (++rate.count > 120) throw fail(429, "Çok sık işlem yapıldı. Biraz sonra tekrar dene."); }
    else rates.set(uid, { count: 1, until: now + 60000 });
    return uid;
  }
  async function account(uid) {
    const snap = await accounts().doc(uid).get();
    return { ...snap.data(), preferences: preferences(snap.data()?.preferences) };
  }
  async function createEvent(uid, event) {
    try { await inbox(uid).doc(event.id).create({ ...event, createdAt: Date.now(), read: false, pushState: "pending" }); }
    catch (error) { if (error.code !== 6 && error.code !== "already-exists") throw error; }
  }
  async function claim(ref, duration) {
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if ((snap.data()?.leaseUntil || 0) > Date.now()) return false;
      tx.set(ref, { leaseUntil: Date.now() + duration }, { merge: true }); return true;
    });
  }
  const tvCache = new Map();
  async function tvDetails(id) {
    const cached = tvCache.get(id);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = await tmdbRequest(`/tv/${id}`, { language: "tr-TR" });
    if (tvCache.size > 500) tvCache.clear();
    tvCache.set(id, { value, expires: Date.now() + 15 * 60000 });
    return value;
  }
  async function checkSeries(uid, p, now) {
    const media = await db.collection("mediaItems").where("userId", "==", uid).get();
    const today = localClock(now, p.timeZone).date;
    for (const doc of media.docs) {
      const item = { ...doc.data(), id: doc.id };
      if (item.type !== "TV" || item.status === "BIRAKILDI" || !Number.isSafeInteger(Number(item.tmdbId)) || Number(item.tmdbId) <= 0) continue;
      const stateRef = accounts().doc(uid).collection("series").doc(doc.id);
      const state = (await stateRef.get()).data();
      try {
        const details = await tvDetails(Number(item.tmdbId));
        // Establish a baseline on first follow; never notify years of historical episodes.
        const since = state?.since || today;
        const events = [];
        if (p.episodes && state) {
          const lookback = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
          const cutoff = since > lookback ? since : lookback;
          const seasons = (details.seasons || []).filter(s => s.season_number > 0 && s.air_date && s.air_date <= today)
            .sort((a, b) => b.season_number - a.season_number).slice(0, 3);
          for (const season of seasons) {
            const data = await tmdbRequest(`/tv/${item.tmdbId}/season/${season.season_number}`, { language: "tr-TR" });
            events.push(...episodeEvents(item, data.episodes || [], cutoff, today));
          }
        }
        const next = details.next_episode_to_air;
        if (p.seasons && next?.episode_number === 1 && next.season_number > 1 && next.air_date > today) {
          events.push({ id: `season_${item.tmdbId}_${next.season_number}`, kind: "season", title: `${item.title}: yeni sezon tarihi`,
            body: `${next.season_number}. sezon için açıklanan tarih: ${next.air_date.split("-").reverse().join(".")}.`,
            url: `/media/${encodeURIComponent(item.id)}`, airDate: next.air_date });
        }
        for (const event of events) await createEvent(uid, event);
        await stateRef.set({ since: today, tmdbId: item.tmdbId, checkedAt: now.getTime() }, { merge: true });
      } catch { console.warn("Bir dizinin yayın takvimi alınamadı; sonraki kontrolde yeniden denenecek."); }
    }
    // Removing a series also removes its cursor, so re-adding starts with a fresh baseline.
    const states = await accounts().doc(uid).collection("series").get();
    const ids = new Set(media.docs.filter(d => d.data().type === "TV" && d.data().status !== "BIRAKILDI").map(d => d.id));
    for (const state of states.docs) if (!ids.has(state.id)) await state.ref.delete();
    if ((p.reading || p.watching) && localClock(now, p.timeZone).time >= p.reminderTime) {
      if (p.reading) await createEvent(uid, { id: `reading_${today}`, kind: "reading", title: "Kendine bir okuma molası ayır", body: "Bugünkü okuma hedefin için birkaç sayfa ile başlayabilirsin.", url: "/library" });
      if (p.watching && new Date(`${today}T12:00:00Z`).getUTCDay() === 0) {
        const unfinished = media.docs.find(d => d.data().status === "IZLENIYOR");
        if (unfinished) await createEvent(uid, { id: `watching_${today}`, kind: "watching", title: "Kaldığın yerden devam et", body: `${unfinished.data().title} seni bekliyor.`, url: `/media/${encodeURIComponent(unfinished.id)}` });
      }
    }
  }
  async function deliver(uid, p, now) {
    p = (await account(uid)).preferences;
    if (!p.enabled) return;
    if (!pushReady || isQuiet(localClock(now, p.timeZone).time, p)) return;
    const clock = localClock(now, p.timeZone);
    if (p.delivery === "daily" && clock.time < p.digestTime) return;
    const pending = await inbox(uid).where("pushState", "==", "pending").limit(100).get();
    const allowed = pending.docs.filter(d => !d.data().read && (d.data().kind === "test" || p[{ episode: "episodes", season: "seasons", reading: "reading", watching: "watching" }[d.data().kind]]) && now.getTime() - d.data().createdAt < 7 * 86400000);
    for (const d of pending.docs) if (!allowed.includes(d)) await d.ref.update({ pushState: "skipped" });
    if (!allowed.length) return;
    const devices = await subscriptions(uid).get();
    if (devices.empty) return;
    if (p.delivery === "daily") {
      const digestRef = accounts().doc(uid).collection("deliveries").doc(`digest_${clock.date}`);
      if ((await digestRef.get()).data()?.done) return;
      if (!await claim(digestRef, 2 * 60000)) return;
      const payload = { id: `digest_${clock.date}`, title: "Günlük özetin hazır", body: `${allowed.length} yeni gelişme seni bekliyor. ${allowed[0].data().title}`, url: "/notifications" };
      await sendDevices(uid, devices, payload);
      await digestRef.set({ done: true, leaseUntil: 0 });
      for (const d of allowed) await d.ref.update({ pushState: "sent" });
    } else {
      for (const d of allowed) {
        const lock = accounts().doc(uid).collection("deliveries").doc(d.id);
        if (!await claim(lock, 2 * 60000)) continue;
        try { await sendDevices(uid, devices, { ...d.data(), id: d.id }); await d.ref.update({ pushState: "sent" }); }
        finally { await lock.set({ leaseUntil: 0 }, { merge: true }); }
      }
    }
  }
  async function sendDevices(uid, devices, payload) {
    let failed = false;
    for (const device of devices.docs) {
      const delivery = accounts().doc(uid).collection("receipts").doc(hash(`${payload.id}:${device.id}`));
      if ((await delivery.get()).exists) continue;
      try {
        await webpush.sendNotification(device.data().subscription, JSON.stringify({ title: payload.title, body: payload.body, url: payload.url, tag: payload.id }), { TTL: 86400, timeout: 10000 });
        await delivery.set({ createdAt: Date.now() });
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) await device.ref.delete();
        else failed = true;
      }
    }
    if (failed) throw fail(502, "Bildirim gönderilemedi. Biraz sonra yeniden denenecek.");
  }
  async function checkUser(uid) {
    const ref = accounts().doc(uid);
    const a = await account(uid);
    if (!a.preferences.enabled) return;
    const lock = ref.collection("locks").doc("check");
    if (!await claim(lock, 5 * 60000)) return;
    try {
      const now = new Date();
      if (!a.checkedAt || now.getTime() - a.checkedAt >= 30 * 60000) {
        await checkSeries(uid, a.preferences, now);
        await ref.set({ checkedAt: now.getTime() }, { merge: true });
      }
      await deliver(uid, a.preferences, now);
    } finally { await lock.set({ leaseUntil: 0 }, { merge: true }); }
  }
  let running = false;
  async function run() {
    if (!ready || running) return { skipped: true };
    running = true;
    const lock = db.collection("_notificationJobs").doc("poll");
    let claimed = false, checked = 0, failed = 0;
    try {
      claimed = await claim(lock, 10 * 60000);
      if (!claimed) return { skipped: true };
      let cursor;
      do {
        let query = accounts().where("preferences.enabled", "==", true).orderBy(admin.firestore.FieldPath.documentId()).limit(100);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        for (const doc of page.docs) { try { await checkUser(doc.id); checked++; } catch { failed++; } }
        cursor = page.size === 100 ? page.docs.at(-1) : null;
      } while (cursor);
      return { checked, failed };
    } finally { if (claimed) await lock.set({ leaseUntil: 0 }); running = false; }
  }
  async function handle(req, res, pathname) {
    if (!pathname.startsWith("/api/notifications")) return false;
    try {
      if (req.method === "GET" && pathname === "/api/notifications/config") {
        json(res, 200, { ready, pushReady: ready && pushReady, publicKey: pushReady ? publicKey : null }); return true;
      }
      if (req.method === "POST" && pathname === "/api/notifications/run") {
        const expected = process.env.NOTIFICATION_CRON_SECRET || "";
        const supplied = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (expected.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw fail(401, "Yetkisiz zamanlayıcı isteği.");
        if (!ready) throw fail(503, "Bildirim sunucusu henüz etkinleştirilmedi.");
        json(res, 200, await run()); return true;
      }
      const uid = await userId(req);
      if (req.method === "GET" && pathname === "/api/notifications") {
        const a = await account(uid);
        const list = await inbox(uid).orderBy("createdAt", "desc").limit(100).get();
        const devices = await subscriptions(uid).get();
        json(res, 200, { preferences: a.preferences, checkedAt: a.checkedAt || null, deviceCount: devices.size, items: list.docs.map(d => ({ id: d.id, ...d.data() })) }); return true;
      }
      const body = req.method === "POST" ? await readBody(req) : {};
      if (req.method === "POST" && pathname === "/api/notifications/preferences") {
        const current = await account(uid);
        const next = preferences({ ...current.preferences, ...body });
        await accounts().doc(uid).set({ preferences: next, ...(!current.preferences.enabled && next.enabled ? { checkedAt: 0 } : {}) }, { merge: true });
        // Disabling a type discards its queued pushes; re-enabling must not replay old reminders.
        const pending = await inbox(uid).where("pushState", "==", "pending").get();
        for (const d of pending.docs) {
          const type = { episode: "episodes", season: "seasons", reading: "reading", watching: "watching" }[d.data().kind];
          if (!next.enabled || (type && !next[type])) await d.ref.update({ pushState: "skipped" });
        }
        json(res, 200, { preferences: next }); return true;
      }
      if (req.method === "POST" && pathname === "/api/notifications/subscribe") {
        if (!pushReady) throw fail(503, "Telefon bildirimleri için sunucu kurulumu tamamlanmalı.");
        if (!validSubscription(body.subscription)) throw fail(400, "Geçerli bir telefon bildirim kaydı gönderilmelidir.");
        const id = hash(body.subscription.endpoint);
        const devices = await subscriptions(uid).get();
        if (devices.size >= 10 && !devices.docs.some(d => d.id === id)) throw fail(400, "En fazla 10 cihaz ekleyebilirsin.");
        // An endpoint can belong to only one account, including account switches on one phone.
        const ownership = db.collection("_notificationEndpoints").doc(id);
        await db.runTransaction(async tx => {
          const owner = (await tx.get(ownership)).data()?.uid;
          if (owner && owner !== uid) tx.delete(subscriptions(owner).doc(id));
          tx.set(ownership, { uid });
          tx.set(subscriptions(uid).doc(id), { subscription: body.subscription, updatedAt: Date.now() });
        });
        json(res, 200, { success: true }); return true;
      }
      if (req.method === "POST" && pathname === "/api/notifications/unsubscribe") {
        if (typeof body.endpoint === "string") {
          const id = hash(body.endpoint);
          await db.runTransaction(async tx => {
            const ref = db.collection("_notificationEndpoints").doc(id);
            const owner = (await tx.get(ref)).data()?.uid;
            if (owner === uid) { tx.delete(subscriptions(uid).doc(id)); tx.delete(ref); }
          });
        }
        json(res, 200, { success: true }); return true;
      }
      if (req.method === "POST" && pathname === "/api/notifications/read") {
        if (body.all === true) {
          const docs = await inbox(uid).where("read", "==", false).limit(500).get();
          const batch = db.batch(); docs.forEach(d => batch.update(d.ref, { read: true })); await batch.commit();
        } else if (typeof body.id === "string" && /^[\w-]{1,150}$/.test(body.id)) {
          const ref = inbox(uid).doc(body.id); if ((await ref.get()).exists) await ref.update({ read: true });
        } else throw fail(400, "Geçersiz bildirim.");
        json(res, 200, { success: true }); return true;
      }
      if (req.method === "POST" && pathname === "/api/notifications/check") {
        await checkUser(uid); json(res, 200, { success: true }); return true;
      }
      if (req.method === "POST" && pathname === "/api/notifications/test") {
        if (!pushReady) throw fail(503, "Telefon bildirimleri henüz etkin değil.");
        const a = await account(uid);
        if (a.testAt && Date.now() - a.testAt < 60000) throw fail(429, "Yeni bir deneme için bir dakika bekle.");
        const devices = await subscriptions(uid).get();
        if (devices.empty) throw fail(400, "Önce bu cihazda telefon bildirimlerini aç.");
        await accounts().doc(uid).set({ testAt: Date.now() }, { merge: true });
        await sendDevices(uid, devices, { id: `test_${Date.now()}`, title: "Bildirimler etkinleştirildi", body: "Takip ettiğin dizilerin yeni bölümlerini ve seçtiğin hatırlatmaları burada göreceksin.", url: "/notifications" });
        json(res, 200, { success: true }); return true;
      }
      json(res, 404, { message: "Bildirim işlemi bulunamadı." }); return true;
    } catch (error) {
      if (!error.status) console.error("Bildirim işlemi başarısız:", error.code || "internal");
      json(res, error.status || 500, { message: error.status ? error.message : "Bildirim işlemi tamamlanamadı. Lütfen tekrar dene." }); return true;
    }
  }
  if (ready && process.env.NOTIFICATION_POLLING !== "false") {
    const timer = setInterval(() => run().catch(() => console.error("Bildirim kontrolü tamamlanamadı.")), 15 * 60000);
    timer.unref();
  }
  return { handle, run, ready };
}
module.exports = { createNotificationService };
