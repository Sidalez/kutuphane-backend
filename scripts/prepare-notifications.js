// Generates persistent keys locally. Never commit or print the private values.
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const webpush = require("web-push");
const target = path.join(__dirname, "..", ".notifications.env");
if (fs.existsSync(target)) {
  console.log(".notifications.env zaten var; mevcut anahtarlar korundu.");
} else {
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(target, [
    "FIREBASE_PROJECT_ID=kisiseltakipapp", "VAPID_SUBJECT=https://kisiseltakip.vercel.app",
    `VAPID_PUBLIC_KEY=${keys.publicKey}`, `VAPID_PRIVATE_KEY=${keys.privateKey}`,
    `NOTIFICATION_CRON_SECRET=${randomBytes(32).toString("hex")}`, "",
  ].join("\n"), { mode: 0o600, flag: "wx" });
  console.log("Bildirim anahtarları .notifications.env dosyasına kaydedildi. Bu dosya Git’e eklenmez.");
}
