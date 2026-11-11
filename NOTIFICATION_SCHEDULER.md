# Düzenli bildirim kontrolü

GitHub schedule zamanında çalışmayı garanti etmez. Beş dakikalık cron ifadesi, beş dakikalık teslim garantisi değildir. Backend çalışırken dakikalık dahili kontrol vardır; uyuyan ücretsiz Render örneği kendi kendini uyandıramaz.

Kesintisiz kontrol için harici zamanlayıcıdan her 5 dakikada bir POST https://kutuphane-backend.onrender.com/api/notifications/run çağrılmalı. Authorization: Bearer başlığında Render ile aynı NOTIFICATION_CRON_SECRET kullanılmalı. Anahtarı URL'ye, repoya veya sohbet mesajına koyma. Başarı cevabında failed sıfır olmalı; HTTP hata ve failed>0 sonuçları izlenmeli.

Bu harici servis bu kod değişikliğiyle oluşturulmadı. Mevcut GitHub zamanlayıcısı yedek olarak kalır ve ilgili backend kodu yayınlandığında da kontrol başlatır. Cihaz teslimi ayrıca push aboneliğine ve kullanıcı tercihlerine bağlıdır.
