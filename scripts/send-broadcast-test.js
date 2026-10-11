// Operator-only helper. Never prints the server secret or push subscription data.
const fs = require("node:fs");
const path = require("node:path");
const campaignId = process.argv[2];
const kind = process.argv[3] || "test";
if (!/^[a-zA-Z0-9_-]{8,80}$/.test(campaignId || "")) {
  console.error("Usage: node scripts/send-broadcast-test.js UNIQUE_CAMPAIGN_ID");
  process.exit(1);
}
async function main() {
  if (kind === "reading") {
    const config = await fetch("https://kutuphane-backend.onrender.com/api/notifications/config", { signal: AbortSignal.timeout(60000) }).then(response => response.json());
    if (!config.personalizedReading) throw new Error("Personalized reading deployment is not ready.");
  }
  const contents = fs.readFileSync(path.join(__dirname, "..", ".notifications.env"), "utf8");
  const secret = process.env.NOTIFICATION_CRON_SECRET || /^NOTIFICATION_CRON_SECRET=(.+)$/m.exec(contents)?.[1]?.trim();
  if (!secret || secret.length < 32) throw new Error("Operator secret is missing.");
  const response = await fetch("https://kutuphane-backend.onrender.com/api/notifications/broadcast-test", {
    method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ campaignId, kind }), signal: AbortSignal.timeout(240000),
  });
  if (!response.ok) {
    console.error(JSON.stringify({ status: response.status, sent: "unconfirmed", campaignId }));
    process.exitCode = 1;
    return;
  }
  const data = await response.json();
  console.log(JSON.stringify({ campaignId, users: data.users, accepted: data.accepted, alreadySent: data.alreadySent, expired: data.expired, failed: data.failed, noReadingBook: data.noReadingBook, alreadyCompleted: Boolean(data.alreadyCompleted) }));
}
main().catch(() => { console.error("Broadcast result could not be confirmed. Retry with the SAME campaign ID to prevent duplicates."); process.exitCode = 1; });
