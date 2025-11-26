// backend/server.js
// Node 18+ gerektirir
require("dotenv").config();
const http = require("http");
const axios = require("axios");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY bulunamadı. .env dosyasını kontrol et.");
  process.exit(1);
}

const PORT = process.env.PORT || 3001;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ----------------------------------------------------------------
// 🛠️ YARDIMCI FONKSİYONLAR
// ----------------------------------------------------------------

function isImageUrl(url) {
  if (typeof url !== "string") return false;
  const cleanUrl = url.split('?')[0].toLowerCase();
  return /\.(jpg|jpeg|png|webp)$/i.test(cleanUrl);
}

function convertIsbn13to10(isbn13) {
  if (!isbn13 || isbn13.length !== 13 || !isbn13.startsWith("978")) return isbn13;
  let s = isbn13.substring(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(s.charAt(i)) * (10 - i);
  }
  let z = (11 - (sum % 11)) % 11;
  return s + (z === 10 ? "X" : z.toString());
}

// URL Kontrolü (Resim var mı ve boyutu yeterli mi?)
// 2KB altı resimler genellikle "Resim Yok" ikonudur.
async function checkDirectUrl(url) {
  try {
    const response = await axios.head(url, {
      timeout: 2500,
      validateStatus: (s) => s === 200,
    });
    return (
      response.headers["content-length"] &&
      parseInt(response.headers["content-length"]) > 2500
    );
  } catch (e) {
    return false;
  }
}

// ----------------------------------------------------------------
// 🎯 PROFESYONEL KAPAK BULMA STRATEJİSİ
// Yanlış kitap gelmemesi için İSİM yerine ISBN odaklı çalışır.
// ----------------------------------------------------------------

async function findCoverStrategically(isbn) {
  console.log(`🔍 Kapak Aranıyor (Sıfır Hata Modu): ${isbn}`);

  // --- 1. ADIM: DirectTextbook (Çok Yüksek Kalite - .webp) ---
  try {
      const dtUrl = `https://www.directtextbook.com/large/${isbn}.webp`;
      if (await checkDirectUrl(dtUrl)) {
          console.log(`✅ Kaynak: DirectTextbook`);
          return dtUrl;
      }
  } catch (e) {}

  // --- 2. ADIM: ISBNSearch.org (HTML Scraping) ---
  try {
    const { data: html } = await axios.get(`https://isbnsearch.org/isbn/${isbn}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 4000
    });
    const match = html.match(/<div class="image">\s*<img src="([^"]+)"/i);
    if (match && match[1] && await checkDirectUrl(match[1])) {
        console.log(`✅ Kaynak: ISBNSearch`);
        return match[1];
    }
  } catch (error) {}

  // --- 3. ADIM: AbeBooks (Direct Link) ---
  try {
      const abebooksUrl = `https://pictures.abebooks.com/isbn/${isbn}-us-300.jpg`;
      if (await checkDirectUrl(abebooksUrl)) {
          console.log(`✅ Kaynak: AbeBooks`);
          return abebooksUrl;
      }
  } catch (e) {}

  // --- 4. ADIM: Amazon (Direct Link) ---
  try {
      const isbn10 = convertIsbn13to10(isbn);
      const amazonUrl = `http://images.amazon.com/images/P/${isbn10}.01.LZZZZZZZ.jpg`;
      if (await checkDirectUrl(amazonUrl)) {
          console.log(`✅ Kaynak: Amazon`);
          return amazonUrl;
      }
  } catch (e) {}

  // --- 5. ADIM: GOOGLE GÖRSELLER (STRICT ISBN SEARCH) ---
  // Yanlış kitap gelmemesi için SADECE ISBN ile arama yapıyoruz.
  // Sorgu: "978605..." (Tırnak içinde tam eşleşme)
  try {
      console.log(`🔍 CDN'lerde yok, Google'da ISBN ile aranıyor...`);
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent('"' + isbn + '"')}&tbm=isch`;
      
      const { data: html } = await axios.get(searchUrl, {
          headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
          }
      });

      // Google JSON regex
      const regex = /\["(https?:\/\/[^"]+)",(\d+),(\d+)\]/g;
      let match;

      while ((match = regex.exec(html)) !== null) {
          let rawUrl = match[1];
          try { rawUrl = JSON.parse(`"${rawUrl}"`); } catch (e) {}

          // Filtreleme: Google ikonlarını ve logolarını atla
          if (rawUrl.includes('gstatic.com') || rawUrl.includes('google.com') || !rawUrl.startsWith('http')) continue;
          if (rawUrl.includes('icon') || rawUrl.includes('logo') || rawUrl.includes('avatar')) continue;
          
          if (isImageUrl(rawUrl)) {
              console.log(`✅ Kaynak: Google (ISBN Eşleşmesi): ${rawUrl}`);
              return rawUrl;
          }
      }
  } catch (error) {}

  // --- 6. SON ÇARE: Google Books Thumbnail (Küçük ama %100 Doğru) ---
  console.log("⚠️ Hiçbir kaynakta HD bulunamadı, Google Books thumbnail dönülüyor.");
  return `https://cdn.vectorstock.com/i/500p/33/47/no-photo-available-icon-vector-40343347.jpg`;
}

// ----------------------------------------------------------------
// 🚀 SERVER REQUEST HANDLER
// ----------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

// ---------------------------------------------
// AI ile ISBN → kitap bilgisi alan endpoint
// ---------------------------------------------
if (req.method === "POST" && req.url === "/api/books/ai") {
  let body = "";

  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", () => {
    (async () => {
      try {
        setCorsHeaders(res);

        // ---- ISBN'i body'den al ----
        let isbn = "";
        try {
          const parsed = JSON.parse(body || "{}");
          isbn = (parsed.isbn || "").toString().trim();
        } catch (e) {}

        if (!isbn) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ found: false, message: "ISBN eksik." })
          );
          return;
        }

        console.log("📚 Gelen ISBN:", isbn);

        // Sadece rakam ve X/x bırak
        const cleanIsbn = isbn.replace(/[^\dXx]/g, "");
        const promptIsbn = cleanIsbn || isbn;

        // -----------------------------
        // 1. ADIM: OpenAI'den kitap meta verisi
        // -----------------------------
        const openaiRes = await fetch(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              tools: [{ type: "web_search" }],
              temperature: 0, // tahmin güdüsünü azalt
              input: [
                {
                  type: "message",
                  role: "system",
                  content: [
                    {
                      type: "input_text",
                      text: `
Sen bir “kitap veri asistanısın”.

Görevin, sana verilen ISBN numarasına göre **sadece kitap meta verilerini** üretmek ve sonucu **yalnızca geçerli JSON** olarak döndürmektir.

Çıktı formatın tam olarak şu yapıda olmalı:

{
  "found": boolean,
  "sourceIsbn": "Bulduğun kaynaktaki gerçek ISBN veya null",
  "title": "Kitap Adı",
  "author": "Yazar Adı",
  "publisher": "Yayınevi Adı",
  "pageCount": number,
  "publishedDate": "Yıl",
  "description": "Kısa özet",
  "categories": ["Kategori 1", "Kategori 2"]
}

ÖNEMLİ ISBN KURALLARI:

- Sana verilecek ISBN şudur: ${promptIsbn}
- Web araması yaparken SADECE bu ISBN ile birebir eşleşen kitapları kullan.
- ISBN alanında ${promptIsbn} NUMARASINI AÇIKÇA GÖSTERMeyen hiçbir sonucu KABUL ETME.
- ISBN tam olarak eşleşmiyorsa "found": false ve "sourceIsbn": null döndür.
- Emin OLAMAZSAN, TAHMİN ETME → "found": false döndür.

Açıklamalar:

- "found":
  - Kitap bulunduysa true, bulunamadıysa false olmalı.

- "sourceIsbn":
  - İnternette gördüğün, "ISBN" alanındaki gerçek değeri yaz.
  - Eğer bulamazsan veya emin değilsen null kullan.

- "title", "author", "publisher":
  - Mümkünse Türkçe karşılıklarıyla doldur. Eğer kitap Türkiye'de yayımlanmışsa, Türkçe adı ve yayınevini bulmaya çalış.
  - Eğer sadece orijinal dilde bulabiliyorsan, orijinal başlığı ve yazarı kullan.

- "pageCount":
  - Sadece sayı olmalı (örnek: 320). Bilinmiyorsa null kullan.

- "publishedDate":
  - Sadece yılı string olarak döndür (örnek: "2014").

- "description":
  - Kitabın kısa bir özetini içermeli (2–4 cümle).
  - Mümkün olduğunca Türkçe yaz.

- "categories":
  - "Kişisel Gelişim", "Bilim Kurgu", "Fantastik", "Psikoloji", "Tarih" vb. kategori isimlerinden oluşan bir dizi.
  - Kategoriler yoksa boş dizi döndür: [].

Kesin Kurallar:

1. Kapak görseli, link, URL veya görsel kaynağı ASLA üretme.
2. JSON dışına ÇIKMA:
   - JSON’dan önce veya sonra hiçbir açıklama, yorum, metin, markdown veya uyarı yazma.
   - Sadece tek bir JSON nesnesi döndür.
3. JSON geçerli olmalı:
   - Tüm alan adları ve string değerler çift tırnak içinde olmalı.
   - Fazladan virgül, yorum, vs. olmamalı.

Özet:
Sana bir ISBN verilecek (ISBN: ${promptIsbn}) ve sen de sadece yukarıdaki şemaya tamamen uyan temiz, doğru ve geçerli tek bir JSON cevabı döndüreceksin. Başka hiçbir şey yazmayacaksın.
                      `.trim(),
                    },
                  ],
                },
                {
                  type: "message",
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: `Lütfen sadece ISBN ${promptIsbn} için meta veriyi döndür.`,
                    },
                  ],
                },
              ],
            }),
          }
        );

        const openaiJson = await openaiRes.json();
        if (!openaiRes.ok) {
          console.error("❌ OpenAI /api/books/ai hata:", openaiJson);
          throw new Error(
            openaiJson?.error?.message ||
              `OpenAI hata: ${openaiRes.status}`
          );
        }

        // responses API'den assistant text'i çek
        let text = "";
        const outputItems = Array.isArray(openaiJson.output)
          ? openaiJson.output
          : [];
        const messageItem =
          outputItems.find(
            (item) =>
              item.type === "message" && item.role === "assistant"
          ) || outputItems[0];

        if (
          messageItem &&
          Array.isArray(messageItem.content) &&
          messageItem.content.length > 0
        ) {
          const textPart = messageItem.content.find(
            (c) => c.type === "output_text"
          );
          if (textPart && typeof textPart.text === "string") {
            text = textPart.text.trim();
          }
        }

        // JSON'a çevir
        let book = {};
        try {
          const cleaned = text
            .replace(/```json/gi, "")
            .replace(/```/g, "")
            .trim();
          book = JSON.parse(cleaned || "{}");
        } catch (e) {
          console.error("JSON Parse Error (ISBN):", e);
        }

        // ---------- EK GÜVENLİK: ISBN EŞLEŞMESİ ----------
        const sourceIsbnRaw =
          typeof book.sourceIsbn === "string" ? book.sourceIsbn : "";
        const sourceIsbnClean = sourceIsbnRaw.replace(/[^\dXx]/g, "");
        const isbnMatches =
          sourceIsbnClean &&
          sourceIsbnClean.length >= 10 &&
          sourceIsbnClean === cleanIsbn;

        if (!book.found || !isbnMatches) {
          console.warn(
            "⚠️ AI kitap bulamadı veya ISBN tam eşleşmedi. Güvenli şekilde boş dönülüyor.",
            { promptIsbn, sourceIsbnRaw }
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              found: false,
              message:
                "Bu ISBN için güvenilir bir kayıt bulunamadı. Bilgileri manuel girebilirsin.",
            })
          );
          return;
        }

        // -------------------------------
        // 2. ADIM: KAPAK BULMA
        // 📌 Senin algoritmana HİÇ dokunmuyoruz
        // -------------------------------
        let finalCoverUrl = null;
        try {
          // BURADA SADECE cleanIsbn kullanıyoruz, senin önceki çağrın nasılsa öyle kalsın
          finalCoverUrl = await findCoverStrategically(cleanIsbn);
        } catch (e) {
          console.error("Kapak bulma hatası:", e);
        }

        // 🔥 KATEGORİLERİ GÜVENLİ ŞEKİLDE AL
        const normalizedCategories = Array.isArray(book.categories)
          ? book.categories
              .filter(
                (c) => typeof c === "string" && c.trim() !== ""
              )
              .map((c) => c.trim())
          : [];

        // 👉 FRONTEND'E GİDEN YAPI (HİÇ DEĞİŞMEDİ)
        const normalized = {
          found: true,
          title: book.title || null,
          author: book.author || null,
          publisher: book.publisher || null,
          pageCount: book.pageCount
            ? Number(book.pageCount)
            : null,
          publishedDate: book.publishedDate || null,
          description: book.description || null,
          coverImageUrl: finalCoverUrl,
          categories: normalizedCategories,
        };

        console.log("✅ ISBN yanıtı:", normalized.title);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(normalized));
      } catch (err) {
        console.error("💥 /api/books/ai hata:", err);
        setCorsHeaders(res);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            found: false,
            message:
              err?.message ||
              "Sunucu tarafında bir hata oluştu (ISBN AI).",
          })
        );
      }
    })();
  });

  return;
}


  // ---------------------------------------------
// 2) OKUMA ÖNERİSİ ENDPOINTİ  /api/ai/recommend
// ---------------------------------------------
if (req.method === "POST" && req.url === "/api/ai/recommend") {
  let body = "";

  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", () => {
    (async () => {
      try {
        setCorsHeaders(res);

        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch (e) {
          console.error("JSON parse hatası /ai/recommend:", e);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              text: "İstek gövdesi (body) geçerli JSON formatında değil.",
            })
          );
          return;
        }

        const {
          goal,              // "choose_library_book" | "choose_new_book"
          mood,
          availableMinutes,
          preferenceText,
          tone,              // "motive" | "calm" | "direct"
          summary,           // kütüphane özeti string
          sampleBooks,       // kısa liste
          readerProfile,     // { avgPagesPerDay, favCategories, ... }
          candidateBooks,    // kütüphaneden okunacak/okunuyor kitaplar
        } = payload || {};

        const safeCandidateBooks = Array.isArray(candidateBooks)
          ? candidateBooks
          : [];

        // -------- SYSTEM PROMPT (Zekânın Beyni) --------
        const systemPrompt = `
Sen kişisel bir okuma asistanısın.

Görevin:
- Kullanıcının kendi KÜTÜPHANESİNDEKİ kitapları ve okuma geçmişini analiz et.
- Gerekirse tools.web_search ile internette araştırma yap:
  * Daha önce okuduğu kitapların konularını, türlerini, temasını öğren.
  * "candidateBooks" listesindeki (OKUNACAK / OKUNUYOR) kitapları da araştır.
- Sonra bu bilgileri birleştirerek,
  1) Kütüphanesinden "kesinlikle başlaması gereken" kitapları seç
  2) İsterse yeni alacağı kitaplar için de öneriler üret.

goal alanı:
- "choose_library_book":
    * Kütüphanedeki candidateBooks listesinden 1–3 adet kitabı
      "Kesinlikle başlamalısın" seviyesinde önceliklendir.
    * Neden bu kitapları önerdiğini ayrıntılı anlat:
      - Daha önce severek okuduğu kitaplarla tematik benzerlik
      - Okuma hızı ve toplam sayfa uyumu
      - Kategoriler, puanlar (expected / final / overall rating)
      - Ruh hali (mood) ve bugün ayırabileceği süre (availableMinutes)
    * Ayrıca "kendimi şanslı hissediyorum" tarzında TEK bir kitap seç:
      - Bu kitabı özel olarak "Bugün şansını bu kitapla dene" gibi vurgula.

- "choose_new_book":
    * Kullanıcının KÜTÜPHANE PROFİLİNİ (summary, sampleBooks, readerProfile)
      temel alarak, dışarıdan satın alabileceği 3–5 kitap öner:
      - Kitap adını ve yazarı net yaz
      - Tür / tema / his
      - Neden bu kullanıcıya uyuyor (önceki okuduğu kitaplar ve favori kategorilere göre)
    * Çok popüler, klişe önerilere boğma; ama tamamen bilinmeyen kitaplardan da kaçın.
    * İstersen, bir tanesini "Şanslı öneri" gibi özellikle öne çıkar.

Stil:
- Çıktıyı SADECE normal Türkçe metin olarak ver (JSON verme, kod bloğu kullanma).
- Aşağıdaki gibi bölümlere ayrıştır:
  1) Kısa profil özeti (okuma hızı, sevilen kategoriler)
  2) Öneri stratejin (neden böyle seçtin)
  3) "Kesinlikle başlaman gerekenler" veya "Satın alman için öneriler" listesi
  4) "Kendimi şanslı hissediyorum" için TEK bir kitap öner (kitap adını net yaz).

tone:
- "motive": motive edici, sıcak, hafif koçluk yapar gibi
- "calm": sakin, açıklayıcı, yumuşak
- "direct": kısa, net, lafı dolandırmadan
- Kullanıcıya "sen" diye hitap et.
`.trim();

        const userContent = {
          goal,
          mood,
          availableMinutes,
          preferenceText,
          summary,
          sampleBooks,
          readerProfile,
          candidateBooks: safeCandidateBooks,
        };

        const openaiRes = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            tools: [{ type: "web_search" }],
            input: [
              {
                type: "message",
                role: "system",
                content: [
                  {
                    type: "input_text",
                    text: systemPrompt,
                  },
                ],
              },
              {
                type: "message",
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: JSON.stringify(userContent, null, 2),
                  },
                ],
              },
            ],
          }),
        });

        const openaiJson = await openaiRes.json();
        if (!openaiRes.ok) {
          console.error("❌ OpenAI /ai/recommend hata:", openaiJson);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              text:
                openaiJson?.error?.message ||
                `OpenAI hata: ${openaiRes.status}`,
            })
          );
          return;
        }

        // output_text'ten metni çek
        let aiText = "";
        const outputItems = Array.isArray(openaiJson.output)
          ? openaiJson.output
          : [];
        const messageItem =
          outputItems.find(
            (item) =>
              item.type === "message" && item.role === "assistant"
          ) || outputItems[0];

        if (
          messageItem &&
          Array.isArray(messageItem.content) &&
          messageItem.content.length > 0
        ) {
          const textPart = messageItem.content.find(
            (c) => c.type === "output_text"
          );
          if (textPart && typeof textPart.text === "string") {
            aiText = textPart.text.trim();
          }
        }

        if (!aiText) {
          aiText =
            "Şu anda yeterli veri bulamadım, ama kütüphanendeki kitapları biraz daha doldurduğunda çok daha net öneriler yapabilirim.";
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: aiText }));
      } catch (err) {
        console.error("💥 /api/ai/recommend sunucu hatası:", err);
        setCorsHeaders(res);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            text: "Sunucu tarafında bir hata oluştu (ai recommend).",
          })
        );
      }
    })();
  });

  return;
}



  setCorsHeaders(res);
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// ----------------------------------------------------------------
// 🌟 [YENİ] AI KİTAP ÖNERİ ENDPOINT'İ
// Kullanıcının sevdiği tür ve yazarlara göre öneri üretir.
// ----------------------------------------------------------------
server.on('request', async (req, res) => {
  const baseURL = 'http://' + req.headers.host + '/';
  const myUrl = new URL(req.url, baseURL);

  if (req.method === "POST" && myUrl.pathname === "/api/recommendations") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });

    req.on("end", () => {
      (async () => {
        try {
          setCorsHeaders(res);
          const { favoriteAuthors, favoriteGenres, recentBooks } = JSON.parse(body || "{}");

          console.log("🤖 AI Öneri İsteği:", { favoriteGenres, favoriteAuthors });

          const prompt = `
            Kullanıcı Profili:
            - Sevdiği Yazarlar: ${favoriteAuthors?.join(", ") || "Belirtilmemiş"}
            - Sevdiği Türler: ${favoriteGenres?.join(", ") || "Genel Edebiyat"}
            - Son Okudukları: ${recentBooks?.join(", ") || "Yok"}

            GÖREV:
            Bu kullanıcı için zevkine uygun, Türkçeye çevrilmiş veya Türkçe yazılmış 3 adet kitap öner.
            
            KURALLAR:
            1. "Son Okudukları" listesindeki kitapları ASLA önerme.
            2. Her öneri için kısa ve cezbedici bir "Neden?" açıklaması yaz.
            3. Çıktıyı sadece aşağıdaki JSON formatında ver (Markdown yok):
            
            [
              {
                "title": "Kitap Adı",
                "author": "Yazar Adı",
                "reason": "Çünkü X yazarını seviyorsun ve Y türündeki bu kitap..."
              }
            ]
          `;

          const openaiRes = await axios.post("https://api.openai.com/v1/chat/completions", {
             model: "gpt-4o-mini",
             messages: [
                 { role: "system", content: "Sen uzman bir edebiyat eleştirmeni ve kitap küratörüsün. Sadece JSON döndür." },
                 { role: "user", content: prompt }
             ],
             temperature: 0.7
          }, {
             headers: { 
                 "Content-Type": "application/json",
                 "Authorization": `Bearer ${OPENAI_API_KEY}` 
             }
          });

          const content = openaiRes.data.choices[0].message.content;
          const cleanJson = content.replace(/```json|```/g, "").trim();
          const suggestions = JSON.parse(cleanJson);

          // Her öneri için kapak resmi bul (Senin Yandex algoritmanı kullanıyoruz)
          const suggestionsWithCovers = await Promise.all(suggestions.map(async (book) => {
              const coverUrl = await findYandexImage(book.title, book.author);
              return { ...book, coverUrl };
          }));

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, data: suggestionsWithCovers }));

        } catch (err) {
          console.error("Öneri Hatası:", err.message);
          setCorsHeaders(res);
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      })();
    });
    return;
  }
});

server.listen(PORT, () => {
  console.log(`📡 Backend http://localhost:${PORT} üzerinde çalışıyor`);
});