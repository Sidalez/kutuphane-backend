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

İş akışı beş dakikada bir backend’i uyandırıp kimliği doğrulanmış kontrol yapar. GitHub zamanlayıcısı gecikebilir; kesin dakikada teslim garantisi yoktur. GitHub Actions kota/etkinlik kuralları geçerlidir. Sunucu açıkken ayrıca dakikada bir kontrol edilir; TMDB sorguları kullanıcı başına 30 dakikada bir yapılır. Sürekli açık başka bir zamanlayıcı kullanırsan aynı korumalı endpointi çağırıp `NOTIFICATION_POLLING=false` ayarlayabilirsin.

### Okuma ritmi

`readingFollowUp` tercihi varsayılan olarak açıktır; ana bildirim takibi kapalıysa gönderim yapılmaz. Okunuyor durumundaki kitapların en yeni 20 kaydı değerlendirilir ve kullanıcı için en son başlayan oturum seçilir. Başlangıç zamanı bilinen kayıttan 24 saat sonra tek hatırlatma oluşturulur. Yeni kayıt daha eski hatırlatmayı geçersiz kılar; bitirilen veya silinen kitap için gönderim yapılmaz. Kitap adı, kayıtlı süre/sayfa ilerlemesi ve güncel sayfa kullanılır; eksik süre uydurulmaz. Sessiz saatler ve günlük özet tercihleri korunur. 24 saatten fazla gecikmiş hatırlatma atlanır. Yeni kayıtlar saat dilimini içeren başlangıç anını kaydeder; eski tarih/saat alanları kullanıcının bildirim saat diliminde yorumlanır.

## 5. Telefonda açma ve doğrulama

1. Yeniden dağıtımdan sonra `/api/notifications/config` içindeki `ready` ve `pushReady` değerleri `true` olmalı.
2. Uygulamayı aç, zil → Tercihler → Bildirim takibi seçeneğini açıp kaydet.
3. iPhone’da iOS 16.4+ gerekir: Safari → Paylaş → Ana Ekrana Ekle; uygulamayı o simgeden aç. Android’de destekleyen bir tarayıcı kullan.
4. **Telefon bildirimlerini aç** düğmesine basıp izin ver. **Deneme bildirimi gönder** ile uygulama kapalıyken teslimi kontrol et. Deneme düğmesi bilinçli bir test olduğundan sessiz saatleri atlar.
5. Actions çalıştırmasının başarılı olduğunu kontrol et. Firebase yetki veya indeks hatalarını backend loglarından kontrol et. Yayın tarihleri TMDB’ye dayanır; ülke/platform yayını farklı olabilir.

Takibe ilk açılışta geçmiş bölümler gönderilmez. Sonraki kontrollerde en fazla son yedi gündeki, son üç sezonun izlenmemiş bölümleri kontrol edilir. Aynı bölüm kimliği tekrar inbox kaydı oluşturmaz. Cihaz bazlı teslim makbuzları başarılı telefon gönderimlerinin tekrarlanmasını önler; Web Push teslimi ağ/işletim sistemi koşullarına bağlıdır. Bırakılan diziler takip edilmez. Tercihler hesap bazlı, telefon abonelikleri cihaz bazlıdır. Çıkışta cihazın push aboneliği iptal edilir.

İlk sürüm gelen kutusunda son 100 kaydı gösterir. Üretim saklama politikan için Firestore TTL veya bakım göreviyle eski inbox ve teslim makbuzlarını temizle; mevcut kullanıcı verilerini toplu silme.


## Film ve dizi keşif bildirimleri

`trailers` ve `upcoming` tercihleri film ve dizi için ortaktır. Yaklaşan yayınlar kullanıcının saat diliminde `upcomingTime` (varsayılan 10:00) sonrasında iki gün önce oluşturulur; kaçırılan kontrol ertesi gün telafi edilir. Sessiz saatler ve günlük özet tercihi geçerlidir. Tarih değişirse eski bekleyen hatırlatma gönderilmez. Yayın günü geçmiş hatırlatmalar gönderilmez.

Dizi fragmanları yalnızca TMDB'nin sıradaki bölüm videosu uç noktasından alınır. Film fragmanları film uç noktasından alınır. YouTube'da yayımlanan, TMDB'de resmî işaretlenmiş Trailer/Teaser videolarından son yedi gündeki en yenisi bildirilir; video kimliği tekrar gönderimi engeller. Bildirim merkezindeki oynat düğmesi fragmanı açar. Show TV için ayrıca resmî kanal sitesi Serper ile aranır. İlk sezon bölüm numarası ve h1 başlığı birebir eşleşmelidir; başka sezonlarda toplam bölüm numarası belirsizliğini önlemek için yalnızca TMDB kullanılır. Resmî kanal araştırması üç saat önbelleklenir.

Film hatırlatmaları yalnızca TMDB Türkiye sinema (3) veya dijital (4) yayın kaydını kullanır. Türkiye kaydı yoksa tarih tahmin edilmez. TMDB tarih alanı yayın saati içermez; UTC gece yarısı gerçek yayın saati olarak gösterilmez. Show TV sayfasında yalnızca aynı dizinin haftalık yayın planı ve yayın gününün eşleşmesi halinde saat ayrıca, Türkiye saati olduğu belirtilerek gösterilir. Bu, kesin bölüm saati garantisi değildir. Diğer kanallar için şu anda TMDB kullanılır. Veriler 30 dakika önbelleklenir; kontrol işi aynı aralıkta keşif yapar. Dış hizmette eksik veri bildirimin oluşmamasına neden olabilir.

## Tamamlanmış dizinin yeniden açılması

Bildirim takibi açık hesaplarda yayın takvimi kontrolü, `IZLENDI` durumundaki dizinin TMDB `last_episode_to_air` kaydını da inceler. Kullanıcının son izlediği bölümden sonra gelen ve yayın tarihi ulaşmış, izlenmemiş normal bir bölüm varsa durum işlem içinde tekrar okunarak `IZLENIYOR` yapılır. `BIRAKILDI`, filmler, özel bölümler ve ileri tarihli bölümler bu değişikliği tetiklemez. İzlenen bölümler, izleme geçmişi ve puan korunur; eski tamamlanma tarihi `previousCompletedAt` alanına taşınır. Bölüm kaydı olmayan eski verilerde yalnızca tamamlanma tarihinden sonra yayımlanmış bölüm için değişiklik yapılır. Yeni bölüm bildirimi `episodes` tercihine bağlıdır; bu tercihin kapalı olması durum eşitlemesini engellemez. Genel bildirim takibi kapalıysa arka plan kontrolü yapılmaz.
