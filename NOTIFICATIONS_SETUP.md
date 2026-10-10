# Telefon bildirimlerini etkinleştirme

Kod hazır olsa da Firebase sunucu yetkisi ve kalıcı Web Push anahtarları olmadan telefon gönderimi yapılamaz. `/api/notifications/config` bu durumda `ready: false` döndürür; uygulama kullanıcıdan boş yere izin istemez.

## 1. Firebase sunucu yetkisi

Backend, Firebase Admin SDK için Node.js 22 veya üzerini kullanır. Render’da sabit bir `NODE_VERSION` tanımlıysa 22 veya 24 olarak güncelle; `package.json` da bu minimum sürümü belirtir.

[Firebase projesi → Hizmet hesapları](https://console.firebase.google.com/project/kisiseltakipapp/settings/serviceaccounts/adminsdk) üzerinden bir hizmet hesabı JSON dosyası indir. Render backend servisinin **Environment** bölümüne `FIREBASE_SERVICE_ACCOUNT_JSON` adıyla bu JSON’un tamamını ekle. `FIREBASE_PROJECT_ID` değeri `kisiseltakipapp` olmalı. Özel anahtarı frontend’e, GitHub’a veya sohbet mesajına koyma.

Hizmet hesabı Firebase Auth token doğrulaması ve Firestore okuma/yazma için kullanılır. Mümkünse ayrı bir hizmet hesabına yalnızca gerekli Firebase Authentication görüntüleme ve Cloud Datastore kullanıcı yetkilerini ver. Backend sadece tokenın sahibi olan hesabın bildirimlerini döndürür. İstemciden gelen kullanıcı kimliğine güvenmez.

## 2. Web Push anahtarları

Backend klasöründe `node scripts/prepare-notifications.js` çalıştır. Oluşan **`.notifications.env`** Git tarafından dışlanır; anahtarlar bir kez üretilir ve tekrar çalıştırınca değiştirilmez. Bu dosyadaki beş değişkeni Render Environment bölümüne ekle:

- `FIREBASE_PROJECT_ID`
- `VAPID_SUBJECT`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `NOTIFICATION_CRON_SECRET`

Anahtarları değiştirirsen mevcut telefon abonelikleri yeniden açılmalıdır. Lokal testte bu değişkenleri backend `.env` dosyasına ekleyebilirsin. Hizmet hesabı dosyasını ortam değişkeni yerine `GOOGLE_APPLICATION_CREDENTIALS` ile de gösterebilirsin.

## 3. Firestore kuralları

Sunucu koleksiyonlarına tarayıcıdan erişim verilmemeli. Mevcut kurallarındaki uygulama koleksiyonlarının yetkilerini koruyarak aşağıdaki üç kök koleksiyonu istemcilere kapat:

```text
match /_notificationAccounts/{document=**} { allow read, write: if false; }
match /_notificationEndpoints/{document=**} { allow read, write: if false; }
match /_notificationJobs/{document=**} { allow read, write: if false; }
```

Firestore’da eşleşen herhangi bir `allow true` erişimi açar. Genel `match /{document=**}` altında izin veren bir kural varsa bu üç koleksiyonu o kuraldan da dışlamalısın; yukarıdaki `false` kuralları genel izni geçersiz kılmaz. Firebase Admin bu istemci kurallarından etkilenmez. Mevcut kurallar okunmadan tüm rules dosyasını değiştirme.

## 4. Uygulama kapalıyken düzenli kontrol

Render ücretsiz servisi uyuyabileceği için yalnızca sunucudaki zamanlayıcıya güvenme. Backend GitHub deposunda **Settings → Secrets and variables → Actions → New repository secret** kısmına `.notifications.env` dosyasındaki `NOTIFICATION_CRON_SECRET` değerini aynı adla ekle. `.github/workflows/notifications.yml` iş akışını etkinleştir; **Actions → Check TV episodes and send notifications → Run workflow** ile ilk kontrolü çalıştır.

İş akışı saatte iki kez backend’i uyandırıp kimliği doğrulanmış kontrol yapar. GitHub zamanlayıcısı gecikebilir; kesin dakikada teslim garantisi yoktur. GitHub Actions kota/etkinlik kuralları geçerlidir. Kontroller çalışırken backend ayrıca 15 dakikada bir kontrol eder. Sürekli açık başka bir zamanlayıcı kullanırsan aynı korumalı endpointi çağırıp `NOTIFICATION_POLLING=false` ayarlayabilirsin.

## 5. Telefonda açma ve doğrulama

1. Yeniden dağıtımdan sonra `/api/notifications/config` içindeki `ready` ve `pushReady` değerleri `true` olmalı.
2. Uygulamayı aç, zil → Tercihler → Bildirim takibi seçeneğini açıp kaydet.
3. iPhone’da iOS 16.4+ gerekir: Safari → Paylaş → Ana Ekrana Ekle; uygulamayı o simgeden aç. Android’de destekleyen bir tarayıcı kullan.
4. **Telefon bildirimlerini aç** düğmesine basıp izin ver. **Deneme bildirimi gönder** ile uygulama kapalıyken teslimi kontrol et. Deneme düğmesi bilinçli bir test olduğundan sessiz saatleri atlar.
5. Actions çalıştırmasının başarılı olduğunu kontrol et. Firebase yetki veya indeks hatalarını backend loglarından kontrol et. Yayın tarihleri TMDB’ye dayanır; ülke/platform yayını farklı olabilir.

Takibe ilk açılışta geçmiş bölümler gönderilmez. Sonraki kontrollerde en fazla son yedi gündeki, son üç sezonun izlenmemiş bölümleri kontrol edilir. Aynı bölüm kimliği tekrar inbox kaydı oluşturmaz. Cihaz bazlı teslim makbuzları başarılı telefon gönderimlerinin tekrarlanmasını önler; Web Push teslimi ağ/işletim sistemi koşullarına bağlıdır. Bırakılan diziler takip edilmez. Tercihler hesap bazlı, telefon abonelikleri cihaz bazlıdır. Çıkışta cihazın push aboneliği iptal edilir.

İlk sürüm gelen kutusunda son 100 kaydı gösterir. Üretim saklama politikan için Firestore TTL veya bakım göreviyle eski inbox ve teslim makbuzlarını temizle; mevcut kullanıcı verilerini toplu silme.
