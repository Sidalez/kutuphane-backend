# Güvenli cihaz oturumlarını etkinleştirme

Kod yalnızca istemcide çıkış yaptırmak yerine, sunucunun verdiği `sessionId` Firebase kimlik iddiasını denetler. Cihaz listesi artık bu modda yalnızca Admin SDK tarafından değiştirilebilir. İptal edilen cihazın eski ID token'ı Firestore kuralları ve bildirim API'si tarafından reddedilir.

Bu değişiklik iki aşamalıdır; yalnızca GitHub'a göndermek Firestore kurallarını yayınlamaz.

1. Backend ve frontend sürümlerini yayınla. Firebase hizmet hesabı ve proje kimliği mevcut doğru projeyi göstermeli.
2. Render'a `SECURE_SESSIONS_REQUIRED=true` ekle. Kullanıcılar tekrar giriş yaparak sunucudan cihaz kimliği alır. Yeni oturum açılışı için son 5 dakika içinde kimlik doğrulama gerekir.
3. Firebase Console → **kisiseltakipapp** → Firestore Database → Rules bölümünde mevcut kuralları yedekle. Bu depodaki `firestore.rules` dosyasını inceleyip yayımla. Alternatif: yetkili Firebase CLI ile `firebase deploy --only firestore:rules --project kisiseltakipapp`.
4. İki farklı tarayıcıda giriş yap. Birinden diğerini kapat. Kapatılan cihazın Firestore yazması ve `/api/notifications` çağrısı reddedilmeli. Diğer hesabın verilerine erişim de reddedilmeli.

Kurallar yayınlanmadan eski token'ların doğrudan Firestore erişiminin kesildiği iddia edilemez. Çevrimdışındaki önceden indirilmiş veriler uzaktan silinemez; sunucu erişimi yeniden bağlanınca reddedilir.

Geçiş tamamlanana kadar flag varsayılan olarak kapalıdır. Yeni kuralları flag kapalıyken yayımlama: eski oturumlar veri erişimini kaybeder. Geri alma gerekiyorsa önce eski kuralları, sonra flag'i geri al.
