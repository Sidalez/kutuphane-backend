const { test } = require("node:test");
const assert = require("node:assert/strict");
const { preferences, localClock, isQuiet, validSubscription, episodeEvents } = require("./notificationLogic");
const { createNotificationService } = require("./notifications");

test("installed Firebase SDK initializes notifications with service account credentials", async () => {
  const names = ["FIREBASE_SERVICE_ACCOUNT_JSON", "NOTIFICATION_POLLING", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const { privateKey } = require("node:crypto").generateKeyPairSync("rsa", { modulusLength: 2048 });
  try {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: "test-project", client_email: "test@test-project.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
    process.env.NOTIFICATION_POLLING = "false";
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const service = createNotificationService({});
    assert.equal(service.ready, true);
  } finally {
    const { getApps, deleteApp } = require("firebase-admin/app");
    const app = getApps().find(app => app.name === "notifications");
    if (app) await deleteApp(app);
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("preferences validate times, booleans and timezones", () => {
  const p = preferences({ enabled: "yes", quietStart: "99:00", timeZone: "invalid", delivery: "spam", reading: true });
  assert.equal(p.enabled, false); assert.equal(p.quietStart, "22:00"); assert.equal(p.timeZone, "Europe/Istanbul"); assert.equal(p.delivery, "instant"); assert.equal(p.reading, true);
});
test("quiet hours include overnight boundaries and local timezone", () => {
  const p = preferences();
  assert.equal(isQuiet("22:00", p), true); assert.equal(isQuiet("08:59", p), true); assert.equal(isQuiet("09:00", p), false); assert.equal(isQuiet("21:59", p), false);
  assert.equal(isQuiet("12:00", { ...p, quietStart: "11:00", quietEnd: "13:00" }), true);
  assert.equal(isQuiet("23:00", { ...p, quietEnabled: false }), false);
  assert.deepEqual(localClock(new Date("2026-10-10T22:00:00Z"), "Europe/Istanbul"), { date: "2026-10-11", time: "01:00" });
});
const subscription = endpoint => ({ endpoint, keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) } });
test("subscriptions reject SSRF, credentials and invalid keys", () => {
  assert.equal(validSubscription(subscription("https://web.push.apple.com/abc")), true);
  assert.equal(validSubscription(subscription("https://updates.push.services.mozilla.com/abc")), true);
  for (const url of ["http://fcm.googleapis.com/abc", "https://127.0.0.1/", "https://fcm.googleapis.com.evil.test/", "https://fcm.googleapis.com:444/", "https://user@fcm.googleapis.com/"]) assert.equal(validSubscription(subscription(url)), false);
  assert.equal(validSubscription({ ...subscription("https://fcm.googleapis.com/abc"), keys: {} }), false);
});
test("episode matching handles a batch release, watched episodes and dates without duplicates", () => {
  const item = { id: "show", tmdbId: 1, title: "Dizi", watchedEpisodes: [{ seasonNumber: 1, episodeNumber: 1 }] };
  const episodes = [1, 2, 3].map(number => ({ season_number: 1, episode_number: number, air_date: "2026-10-10" }));
  const events = episodeEvents(item, [...episodes, episodes[1], { season_number: 2, episode_number: 1, air_date: "2026-10-11" }], "2026-10-09", "2026-10-10");
  assert.deepEqual(events.map(e => e.id), ["episode_1_1_2", "episode_1_1_3"]);
  assert.deepEqual(episodeEvents(item, episodes, "2026-10-11", "2026-10-11"), []);
});

function fakeFirestore() {
  const store = new Map();
  const copy = value => value && structuredClone(value);
  class Ref {
    constructor(path) { this.path = path; this.id = path.split("/").at(-1); }
    collection(name) { return new Query(`${this.path}/${name}`); }
    async get() { const value = copy(store.get(this.path)); return { id: this.id, ref: this, exists: value !== undefined, data: () => value }; }
    async set(value, options) { store.set(this.path, copy(options?.merge ? { ...store.get(this.path), ...value } : value)); }
    async update(value) { assert.ok(store.has(this.path)); await this.set(value, { merge: true }); }
    async delete() { store.delete(this.path); }
    async create(value) { if (store.has(this.path)) throw Object.assign(new Error("exists"), { code: 6 }); await this.set(value); }
  }
  class Query {
    constructor(path, filters = [], limit = Infinity, order = null) { this.path = path; this.filters = filters; this.max = limit; this.order = order; }
    doc(id) { return new Ref(`${this.path}/${id}`); }
    where(key, _op, value) { return new Query(this.path, [...this.filters, [key, value]], this.max, this.order); }
    limit(number) { return new Query(this.path, this.filters, number, this.order); }
    orderBy(key, direction = "asc") { return new Query(this.path, this.filters, this.max, [key, direction]); }
    async get() {
      let docs = await Promise.all([...store.keys()].filter(key => key.startsWith(`${this.path}/`) && key.split("/").length === this.path.split("/").length + 1).map(key => new Ref(key).get()));
      docs = docs.filter(d => this.filters.every(([key, value]) => key.split(".").reduce((o, k) => o?.[k], d.data()) === value));
      if (this.order) docs.sort((a, b) => { const [key, direction] = this.order; const av = key === "__name__" ? a.id : a.data()[key], bv = key === "__name__" ? b.id : b.data()[key]; return (av > bv ? 1 : av < bv ? -1 : 0) * (direction === "asc" ? 1 : -1); });
      docs = docs.slice(0, this.max); return { docs, empty: !docs.length, size: docs.length, forEach: fn => docs.forEach(fn) };
    }
  }
  const batch = () => { const writes = []; return { update: (ref, value) => writes.push(() => ref.update(value)), commit: async () => { for (const write of writes) await write(); } }; };
  return { store, collection: name => new Query(name), batch,
    runTransaction: async fn => { const writes = []; const result = await fn({ get: ref => ref.get(), set: (ref, data, options) => writes.push(() => ref.set(data, options)), delete: ref => writes.push(() => ref.delete()) }); for (const write of writes) await write(); return result; } };
}

test("authenticated flow: baseline, deduplication, retries, account isolation, quiet hours and device ownership", async () => {
  const original = { ...process.env };
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{}";
  process.env.VAPID_PUBLIC_KEY = "test-public"; process.env.VAPID_PRIVATE_KEY = "test-private";
  process.env.NOTIFICATION_POLLING = "false";
  const db = fakeFirestore();
  const sdk = { credential: { cert: () => ({}) }, initializeApp: () => ({ firestore: () => db, auth: () => ({ verifyIdToken: async token => { if (!["alice", "bob"].includes(token)) throw new Error("invalid"); return { uid: token }; } }) }), firestore: { FieldPath: { documentId: () => "__name__" } } };
  const sends = [];
  let failEndpoint = "";
  const webpush = { setVapidDetails() {}, async sendNotification(sub, payload) { sends.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); if (sub.endpoint === failEndpoint) throw { statusCode: 503 }; } };
  const today = localClock(new Date(), "Europe/Istanbul").date;
  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const service = createNotificationService({
    tmdbRequest: async endpoint => endpoint.includes("/season/") ? { episodes: [1, 2].map(n => ({ season_number: 1, episode_number: n, air_date: today, name: `Bölüm ${n}` })) } : { seasons: [{ season_number: 1, air_date: "2025-01-01" }], next_episode_to_air: { episode_number: 1, season_number: 2, air_date: future } },
    readBody: async req => req.body, json: (res, status, body) => Object.assign(res, { status, body }),
  }, { admin: sdk, webpush });
  async function request(uid, path, body) { const res = {}; await service.handle({ method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${uid}` }, body }, res, `/api/notifications${path}`); return res; }
  try {
    assert.equal((await request("invalid", "")).status, 401);
    assert.equal((await request("alice", "/run", {})).status, 401);
    assert.equal((await request("alice", "/preferences", { enabled: true, quietEnabled: false })).status, 200);
    await db.collection("mediaItems").doc("alice_show").set({ userId: "alice", type: "TV", tmdbId: 1, title: "Dizi", status: "IZLENIYOR", watchedEpisodes: [{ seasonNumber: 1, episodeNumber: 1 }] });
    await request("alice", "/check", {});
    assert.deepEqual((await request("alice", "")).body.items.map(x => x.kind), ["season"]);
    assert.equal((await request("bob", "")).body.items.length, 0);
    const first = subscription("https://fcm.googleapis.com/device1"), second = subscription("https://web.push.apple.com/device2");
    await request("alice", "/subscribe", { subscription: first }); await request("alice", "/subscribe", { subscription: second });
    await db.collection("_notificationAccounts").doc("alice").set({ checkedAt: 0 }, { merge: true });
    failEndpoint = second.endpoint;
    assert.equal((await request("alice", "/check", {})).status, 502);
    failEndpoint = "";
    assert.equal((await request("alice", "/check", {})).status, 200);
    await request("alice", "/check", {});
    const items = (await request("alice", "")).body.items;
    assert.equal(items.length, 2); assert.equal(items.filter(i => i.kind === "episode").length, 1);
    assert.equal(sends.filter(s => s.endpoint === first.endpoint && s.payload.tag === "episode_1_1_2").length, 1);
    assert.equal((await request("bob", "/read", { id: items[0].id })).status, 200);
    assert.equal((await request("alice", "")).body.items[0].read, false);
    await request("alice", "/read", { all: true });
    assert.ok((await request("alice", "")).body.items.every(i => i.read));
    await request("bob", "/subscribe", { subscription: first });
    assert.equal((await request("alice", "")).body.deviceCount, 1); assert.equal((await request("bob", "")).body.deviceCount, 1);
    await request("alice", "/unsubscribe", { endpoint: first.endpoint });
    assert.equal((await request("bob", "")).body.deviceCount, 1);
    const clock = localClock(new Date(), "Europe/Istanbul");
    const after = `${String((Number(clock.time.slice(0, 2)) + 1) % 24).padStart(2, "0")}:${clock.time.slice(3)}`;
    await request("alice", "/preferences", { quietEnabled: true, quietStart: clock.time, quietEnd: after });
    await db.collection("_notificationAccounts").doc("alice").collection("inbox").doc("quiet_test").create({ id: "quiet_test", kind: "episode", title: "Sessiz", body: "Bekle", url: "/notifications", read: false, createdAt: Date.now(), pushState: "pending" });
    const before = sends.length; await request("alice", "/check", {}); assert.equal(sends.length, before);
    await request("alice", "/preferences", { quietEnabled: false, delivery: "daily", digestTime: "00:00" });
    await request("alice", "/check", {}); assert.equal(sends.length, before + 1);
    await request("alice", "/check", {}); assert.equal(sends.length, before + 1);
    await request("alice", "/preferences", { enabled: false });
    await request("alice", "/check", {}); assert.equal(sends.length, before + 1);
    process.env.NOTIFICATION_CRON_SECRET = "broadcast-test-secret-".repeat(3);
    assert.equal((await request("alice", "/broadcast-test", { campaignId: "test_campaign" })).status, 401);
    assert.equal((await request(process.env.NOTIFICATION_CRON_SECRET, "/broadcast-test", { campaignId: "bad" })).status, 400);
    await request("bob", "/preferences", { enabled: true, quietEnabled: true, quietStart: clock.time, quietEnd: after });
    const third = subscription("https://fcm.googleapis.com/device3");
    await request("bob", "/subscribe", { subscription: third });
    failEndpoint = third.endpoint;
    const broadcastBefore = sends.length;
    const broadcast = await request(process.env.NOTIFICATION_CRON_SECRET, "/broadcast-test", { campaignId: "test_campaign" });
    assert.equal(broadcast.status, 200);
    assert.deepEqual(broadcast.body, { users: 1, accepted: 1, alreadySent: 0, expired: 0, failed: 1 });
    assert.ok(sends.slice(broadcastBefore).every(s => s.endpoint !== second.endpoint), "disabled account must not receive a broadcast");
    failEndpoint = "";
    const retry = await request(process.env.NOTIFICATION_CRON_SECRET, "/broadcast-test", { campaignId: "test_campaign" });
    assert.deepEqual(retry.body, { users: 1, accepted: 1, alreadySent: 1, expired: 0, failed: 0 });
    const completed = sends.length;
    const replay = await request(process.env.NOTIFICATION_CRON_SECRET, "/broadcast-test", { campaignId: "test_campaign" });
    assert.equal(replay.body.alreadyCompleted, true);
    assert.equal(sends.length, completed);
  } finally { process.env = original; }
});
