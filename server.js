// backend/server.js
// Node 18+ gerektirir.
// ISBN seed: Serper Images ilk sonuç title
// Kapak görseli: Serper Images ilk sonuç imageUrl
// Kitap detayları: Gemini
// OpenAI / OpenRouter yoktur.

const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const http = require("http");

function normalizeEnvValue(value) {
  return String(value || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "");
}

const GEMINI_API_KEY = normalizeEnvValue(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const SERPER_API_KEY = normalizeEnvValue(process.env.SERPER_API_KEY);
const PORT = process.env.PORT || 3001;

const NO_PHOTO_URL =
  "https://cdn.vectorstock.com/i/500p/33/47/no-photo-available-icon-vector-40343347.jpg";

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY bulunamadı. .env dosyasını kontrol et.");
  process.exit(1);
}

if (!SERPER_API_KEY) {
  console.error("❌ SERPER_API_KEY bulunamadı. .env dosyasını kontrol et.");
  process.exit(1);
}

console.log("🔑 Gemini key okundu:", GEMINI_API_KEY.slice(0, 8) + "...");
console.log("🤖 Gemini model:", GEMINI_MODEL);
console.log("🖼️ Serper key okundu:", SERPER_API_KEY.slice(0, 8) + "...");

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, data) {
  if (res.writableEnded) return;

  setCorsHeaders(res);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        reject(new Error("İstek gövdesi çok büyük."));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("İstek gövdesi geçerli JSON değil."));
      }
    });

    req.on("error", reject);
  });
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanIsbn(value) {
  return String(value || "").replace(/[^\dXx]/g, "").toUpperCase();
}

function convertIsbn13to10(isbn13) {
  const clean = cleanIsbn(isbn13);

  if (!clean || clean.length !== 13 || !clean.startsWith("978")) {
    return clean;
  }

  const s = clean.substring(3, 12);
  let sum = 0;

  for (let i = 0; i < 9; i++) {
    sum += parseInt(s.charAt(i), 10) * (10 - i);
  }

  const z = (11 - (sum % 11)) % 11;
  return s + (z === 10 ? "X" : z.toString());
}

function cleanJsonText(text) {
  return String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function parseJsonFromText(text, fallbackValue) {
  const cleaned = cleanJsonText(text);

  try {
    return JSON.parse(cleaned);
  } catch {}

  try {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    const candidate = arrayMatch?.[0] || objectMatch?.[0];

    if (candidate) {
      return JSON.parse(candidate);
    }
  } catch {}

  return fallbackValue;
}

function parseNumberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const match = String(value || "").match(/\d{1,5}/);
  if (!match) return null;

  const n = Number(match[0]);
  if (!Number.isFinite(n) || n <= 0 || n > 5000) return null;

  return n;
}

function cleanSeedTitle(title) {
  return cleanText(title)
    .replace(/\s+\|\s+.*$/g, "")
    .replace(
      /\s+-\s+(Kitapyurdu|D&R|İdefix|Amazon|BKM Kitap|NadirKitap|Pandora).*$/gi,
      ""
    )
    .replace(/\s*Kitap\s*$/gi, "")
    .trim();
}

// ----------------------------------------------------------------
// GEMINI
// ----------------------------------------------------------------

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) => {
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .join("")
    .trim();
}

async function callGemini({
  prompt,
  temperature = 0.35,
  googleSearch = true,
}) {
  async function sendRequest(useSearch) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature,
      },
    };

    if (useSearch) {
      body.tools = [
        {
          google_search: {},
        },
      ];
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    });

    const rawText = await response.text();

    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      console.error("❌ Gemini JSON olmayan cevap döndürdü.");
      console.error("HTTP Status:", response.status);
      console.error("Raw cevap:", rawText.slice(0, 2000));
      throw new Error(`Gemini geçerli JSON döndürmedi. HTTP: ${response.status}`);
    }

    if (!response.ok) {
      console.error("❌ Gemini hata:", JSON.stringify(data, null, 2));
      throw new Error(
        data?.error?.message ||
          data?.message ||
          `Gemini hata: ${response.status}`
      );
    }

    const text = extractGeminiText(data);

    if (!text) {
      console.error("❌ Gemini cevabı okunamadı:", JSON.stringify(data, null, 2));
      throw new Error("Gemini cevabı okunamadı.");
    }

    return text;
  }

  try {
    return await sendRequest(googleSearch);
  } catch (error) {
    if (googleSearch) {
      console.warn(
        "⚠️ Gemini google_search ile cevap alınamadı. Aramasız tekrar deneniyor..."
      );
      return await sendRequest(false);
    }

    throw error;
  }
}

// ----------------------------------------------------------------
// SERPER
// ----------------------------------------------------------------

async function serperRequest(endpoint, payload) {
  const response = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();

  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    console.error("❌ Serper JSON olmayan cevap:", rawText.slice(0, 1000));
    throw new Error(`Serper geçerli JSON döndürmedi. HTTP: ${response.status}`);
  }

  if (!response.ok) {
    console.error("❌ Serper hata:", JSON.stringify(data, null, 2));
    throw new Error(data?.message || `Serper hata: ${response.status}`);
  }

  return data;
}

async function serperImages(query, options = {}) {
  return serperRequest("images", {
    q: query,
    gl: options.gl || "tr",
    hl: options.hl || "tr",
    num: options.num || 10,
  });
}

async function getFirstSerperImageUrl(query) {
  console.log("🖼️ Serper Images araması:", query);

  const data = await serperImages(query, {
    gl: "tr",
    hl: "tr",
    num: 10,
  });

  const images = Array.isArray(data?.images) ? data.images : [];
  const first = images[0];

  if (!first?.imageUrl) {
    console.warn("⚠️ Serper ilk sonuçta imageUrl dönmedi.");
    return {
      imageUrl: NO_PHOTO_URL,
      firstResult: null,
      raw: data,
    };
  }

  console.log("✅ Serper ilk imageUrl:", first.imageUrl);

  return {
    imageUrl: first.imageUrl,
    firstResult: first,
    raw: data,
  };
}

async function findBookSeedFromSerperImage(isbn) {
  const clean = cleanIsbn(isbn);
  const query = `ISBN:${clean}`;

  const { imageUrl, firstResult } = await getFirstSerperImageUrl(query);

  if (!firstResult) {
    return {
      found: false,
      message: "Serper Images ilk sonucunda uygun imageUrl bulunamadı.",
    };
  }

  const title = cleanSeedTitle(firstResult.title || "");

  if (!title) {
    return {
      found: false,
      message: "Serper Images ilk sonucunda kitap başlığı okunamadı.",
      imageUrl,
      rawFirstResult: firstResult,
    };
  }

  return {
    found: true,
    isbn: clean,
    title,
    imageUrl,
    source: cleanText(firstResult.source || ""),
    domain: cleanText(firstResult.domain || ""),
    link: firstResult.link || "",
    position: firstResult.position || 1,
    rawFirstResult: firstResult,
  };
}

async function findCoverWithSerperImage({ isbn, title, author, publisher }) {
  const clean = cleanIsbn(isbn);

  const query = clean
    ? `ISBN:${clean}`
    : `${title || ""} ${author || ""} ${publisher || ""} kitap kapağı`.trim();

  const { imageUrl } = await getFirstSerperImageUrl(query);

  return imageUrl || NO_PHOTO_URL;
}

async function findYandexImage(title, author) {
  return findCoverWithSerperImage({
    isbn: "",
    title,
    author,
    publisher: "",
  });
}

// ----------------------------------------------------------------
// ISBN → SERPER IMAGE TITLE → GEMINI DETAILS
// ----------------------------------------------------------------

async function getBookDetailsFromGeminiBySerperTitle({ isbn, seed }) {
  const clean = cleanIsbn(isbn);
  const isbn10 = convertIsbn13to10(clean);

  const prompt = `
Sen bir kitap veri çıkarma asistanısın.

Aşağıdaki ISBN, Serper Images üzerinde "ISBN:${clean}" sorgusuyla arandı.
Serper'ın ilk görsel sonucundan bir kitap başlığı ve kapak görseli elde edildi.
Görevin bu başlığı ve ISBN bilgisini kullanarak kitabın alanlarını doğru şekilde doldurmaktır.

ISBN-13: ${clean}
ISBN-10: ${isbn10 || "Yok"}

Serper Images ilk sonucu:
${JSON.stringify(
  {
    titleFromImageResult: seed.title,
    imageSource: seed.source,
    imageDomain: seed.domain,
    imageLink: seed.link,
    imageUrl: seed.imageUrl,
  },
  null,
  2
)}

Google Search kullanarak bu kitabı araştır ve SADECE şu JSON formatında cevap ver:

{
  "found": boolean,
  "sourceIsbn": "${clean}",
  "title": "Kitap Adı",
  "author": "Yazar Adı",
  "publisher": "Yayınevi",
  "pageCount": number,
  "publishedDate": "Yıl veya tarih",
  "description": "2-4 cümlelik Türkçe kısa özet",
  "categories": ["Kategori 1", "Kategori 2"]
}

Kurallar:
- Serper Images sonucundaki başlığı ana ipucu olarak kullan: "${seed.title}".
- Başlığı tamamen farklı bir kitaba çevirme.
- ISBN ile çelişen bir kitap bulursan found false döndür.
- Yayınevi, sayfa sayısı ve yayın tarihi bulunamazsa null kullan.
- Kapak görseli üretme; coverImageUrl alanı döndürme.
- Link veya URL döndürme.
- Markdown kullanma.
- JSON dışında hiçbir şey yazma.
`.trim();

  const text = await callGemini({
    prompt,
    temperature: 0,
    googleSearch: true,
  });

  const parsed = parseJsonFromText(text, { found: false });

  const title =
    typeof parsed.title === "string" && parsed.title.trim()
      ? parsed.title.trim()
      : seed.title;

  const hasBasicBookData =
    parsed?.found === true &&
    typeof title === "string" &&
    title.trim().length > 1;

  if (!hasBasicBookData) {
    return {
      found: false,
      message: "Gemini, Serper başlığından güvenilir kitap bilgisi çıkaramadı.",
    };
  }

  return {
    found: true,
    sourceIsbn: clean,
    title,
    author:
      typeof parsed.author === "string" && parsed.author.trim()
        ? parsed.author.trim()
        : null,
    publisher:
      typeof parsed.publisher === "string" && parsed.publisher.trim()
        ? parsed.publisher.trim()
        : null,
    pageCount: parseNumberOrNull(parsed.pageCount),
    publishedDate:
      typeof parsed.publishedDate === "string" && parsed.publishedDate.trim()
        ? parsed.publishedDate.trim()
        : null,
    description:
      typeof parsed.description === "string" && parsed.description.trim()
        ? parsed.description.trim()
        : null,
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
  };
}

// ----------------------------------------------------------------
// GEMINI ÖNERİ FONKSİYONLARI
// ----------------------------------------------------------------

async function getReadingAdviceWithGemini(payload) {
  const {
    goal,
    mood,
    availableMinutes,
    preferenceText,
    tone,
    summary,
    sampleBooks,
    readerProfile,
    candidateBooks,
  } = payload || {};

  const sectionTitle =
    goal === "choose_new_book"
      ? "Satın Alabileceğin Öneriler"
      : "Kesinlikle Başlaman Gerekenler";

  const prompt = `
Sen kişisel bir okuma asistanısın.

Kullanıcının kütüphanesindeki kitapları, okuma hızını, ruh halini, favori kategorilerini ve aday kitaplarını analiz et.
Gerekirse Google Search kullanarak kitapların yazar, yayınevi, sayfa sayısı, türü ve kısa konusu hakkında bilgi edin.

Kullanıcı verisi:
${JSON.stringify(
  {
    goal,
    mood,
    availableMinutes,
    preferenceText,
    tone,
    summary,
    sampleBooks,
    readerProfile,
    candidateBooks: Array.isArray(candidateBooks) ? candidateBooks : [],
  },
  null,
  2
)}

Çıktıyı SADECE şu başlıklarla ver:

1) Kısa Profil Özeti
- Kısa ve net maddeler yaz.

2) Öneri Stratejisi
- Kısa ve net maddeler yaz.

3) ${sectionTitle}
Her öneriyi kesinlikle şu tek satır formatında yaz:

- Kitap: Kitap adı | Yazar: Yazar adı | Yayinevi: Yayınevi adı veya Bilinmiyor | Sayfa: sayı veya Bilinmiyor | Tur: tür/kategori | Ozet: 1 kısa cümle | Neden: Bu kullanıcıya neden uygun olduğunu kısa açıkla.

4) Kendimi Şanslı Hissediyorum
- Kitap: Tek kitap adı | Yazar: Yazar adı | Yayinevi: Yayınevi adı veya Bilinmiyor | Sayfa: sayı veya Bilinmiyor | Tur: tür/kategori | Ozet: 1 kısa cümle | Neden: Bugün neden bu kitap seçilmeli.

Kurallar:
- Genel liste başlıklarını kitap sanma.
- Gerçek kitap adı ve gerçek yazar adı ver.
- Yayınevi biliniyorsa mutlaka Yayinevi alanına yaz.
- Sayfa sayısı biliniyorsa mutlaka Sayfa alanına yaz.
- Her kitap tek madde olsun.
- Alan adlarını aynen şu şekilde yaz: Kitap, Yazar, Yayinevi, Sayfa, Tur, Ozet, Neden.
- JSON verme.
- Markdown tablo verme.
- Uzun paragraf yazma.
- Kullanıcıya "sen" diye hitap et.
- Ton: ${tone || "motive"}.
`.trim();

  return callGemini({
    prompt,
    temperature: 0.35,
    googleSearch: true,
  });
}

async function getRecommendationsWithGemini({
  favoriteAuthors,
  favoriteGenres,
  recentBooks,
}) {
  const prompt = `
Sen uzman bir kitap küratörüsün.

Kullanıcının sevdiği yazarlar, türler ve son okuduğu kitaplara göre Google Search kullanarak 3 gerçek kitap öner.

Kullanıcı profili:
${JSON.stringify(
  {
    favoriteAuthors: Array.isArray(favoriteAuthors) ? favoriteAuthors : [],
    favoriteGenres: Array.isArray(favoriteGenres) ? favoriteGenres : [],
    recentBooks: Array.isArray(recentBooks) ? recentBooks : [],
  },
  null,
  2
)}

Sadece JSON array döndür:

[
  {
    "title": "Kitap Adı",
    "author": "Yazar Adı",
    "publisher": "Yayınevi veya Bilinmiyor",
    "pageCount": 0,
    "genre": "Tür/Kategori",
    "summary": "Kısa özet",
    "reason": "Bu kullanıcıya neden uygun olduğunu kısa açıkla."
  }
]

Kurallar:
- Genel liste başlıklarını kitap sanma.
- Gerçek kitap adı ve gerçek yazar adı ver.
- Son okudukları listesindeki kitapları önerme.
- Türkçeye çevrilmiş veya Türkçe yazılmış kitapları tercih et.
- Yayınevi ve sayfa sayısını bulabilirsen doldur.
- Bulamadığın yayınevi için "Bilinmiyor" yaz.
- Bulamadığın sayfa sayısı için 0 yaz.
- Markdown kullanma.
- JSON dışında hiçbir şey yazma.
`.trim();

  const text = await callGemini({
    prompt,
    temperature: 0.45,
    googleSearch: true,
  });

  const parsed = parseJsonFromText(text, []);
  return Array.isArray(parsed) ? parsed : [];
}

// ----------------------------------------------------------------
// SERVER
// ----------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    return json(res, 200, {
      ok: true,
      message: "Backend çalışıyor.",
      isbnSeed: "Serper Images first title",
      details: "Gemini",
      cover: "Serper Images first imageUrl",
      model: GEMINI_MODEL,
    });
  }

  if (req.method === "POST" && req.url === "/api/books/ai") {
    (async () => {
      try {
        const parsed = await readBody(req);
        const isbn = (parsed.isbn || "").toString().trim();

        if (!isbn) {
          return json(res, 400, {
            found: false,
            message: "ISBN eksik.",
          });
        }

        const clean = cleanIsbn(isbn);

        if (!clean) {
          return json(res, 400, {
            found: false,
            message: "Geçerli ISBN girilmedi.",
          });
        }

        console.log("📚 Gelen ISBN:", clean);

        const seed = await findBookSeedFromSerperImage(clean);

        console.log("🖼️ Serper seed:", JSON.stringify(seed, null, 2));

        if (!seed?.found) {
          return json(res, 200, {
            found: false,
            message:
              seed?.message ||
              "Bu ISBN için Serper Images üzerinde güvenilir bir kitap sonucu bulunamadı.",
          });
        }

        const book = await getBookDetailsFromGeminiBySerperTitle({
          isbn: clean,
          seed,
        });

        console.log("🤖 Gemini kitap detay cevabı:", JSON.stringify(book, null, 2));

        if (!book?.found) {
          return json(res, 200, {
            found: false,
            message:
              book?.message ||
              "Bu ISBN için kitap bilgileri güvenilir şekilde doldurulamadı.",
          });
        }

        const normalizedCategories = Array.isArray(book.categories)
          ? book.categories
              .filter((c) => typeof c === "string" && c.trim() !== "")
              .map((c) => c.trim())
          : [];

        const normalized = {
          found: true,
          title: book.title || seed.title || null,
          author: book.author || null,
          publisher: book.publisher || null,
          pageCount:
            book.pageCount !== undefined &&
            book.pageCount !== null &&
            Number.isFinite(Number(book.pageCount))
              ? Number(book.pageCount)
              : null,
          publishedDate: book.publishedDate || null,
          description: book.description || null,
          coverImageUrl: seed.imageUrl || NO_PHOTO_URL,
          categories: normalizedCategories,
        };

        console.log("✅ ISBN yanıtı:", normalized.title);
        console.log("🖼️ Kapak URL:", normalized.coverImageUrl);

        return json(res, 200, normalized);
      } catch (err) {
        console.error("💥 /api/books/ai hata:", err);

        return json(res, 500, {
          found: false,
          message:
            err?.message ||
            "Sunucu tarafında bir hata oluştu (ISBN Serper Images + Gemini).",
        });
      }
    })();

    return;
  }

  if (req.method === "POST" && req.url === "/api/ai/recommend") {
    (async () => {
      try {
        const payload = await readBody(req);

        const text = await getReadingAdviceWithGemini(payload);

        return json(res, 200, {
          text:
            text ||
            "Şu anda yeterli veri bulamadım, ama kütüphanendeki kitapları biraz daha doldurduğunda daha net öneriler yapabilirim.",
        });
      } catch (err) {
        console.error("💥 /api/ai/recommend hata:", err);

        return json(res, 500, {
          text:
            err?.message ||
            "Sunucu tarafında bir hata oluştu (Gemini recommend).",
        });
      }
    })();

    return;
  }

  const baseURL = "http://" + req.headers.host + "/";
  const myUrl = new URL(req.url, baseURL);

  if (req.method === "POST" && myUrl.pathname === "/api/recommendations") {
    (async () => {
      try {
        const payload = await readBody(req);

        const favoriteAuthors = Array.isArray(payload.favoriteAuthors)
          ? payload.favoriteAuthors
          : [];

        const favoriteGenres = Array.isArray(payload.favoriteGenres)
          ? payload.favoriteGenres
          : [];

        const recentBooks = Array.isArray(payload.recentBooks)
          ? payload.recentBooks
          : [];

        const suggestions = await getRecommendationsWithGemini({
          favoriteAuthors,
          favoriteGenres,
          recentBooks,
        });

        const suggestionsWithCovers = await Promise.all(
          suggestions.slice(0, 3).map(async (book) => {
            const coverUrl = await findCoverWithSerperImage({
              isbn: "",
              title: book.title,
              author: book.author,
              publisher: book.publisher,
            });

            return {
              title: book.title || "",
              author: book.author || "Bilinmiyor",
              publisher: book.publisher || "Bilinmiyor",
              pageCount:
                book.pageCount !== undefined &&
                book.pageCount !== null &&
                Number.isFinite(Number(book.pageCount))
                  ? Number(book.pageCount)
                  : 0,
              genre: book.genre || "",
              summary: book.summary || "",
              reason: book.reason || "",
              coverUrl,
            };
          })
        );

        return json(res, 200, {
          success: true,
          data: suggestionsWithCovers,
        });
      } catch (err) {
        console.error("Öneri Hatası:", err.message);

        return json(res, 500, {
          error: err.message,
        });
      }
    })();

    return;
  }

  setCorsHeaders(res);
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`📡 Backend http://localhost:${PORT} üzerinde çalışıyor`);
  console.log("🔎 Mod: Serper first imageUrl + Gemini Details");
});