// backend/server.js
// Node 18+ gerektirir.
// ISBN veri kaynağı: Google Books + Open Library
// Eksik özet/kategori zenginleştirme: Gemini
// Kapak görseli: Serper Images API

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

function normalizeIsbnForCompare(value) {
  return cleanIsbn(value);
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

function isbnMatches(a, b) {
  const x = cleanIsbn(a);
  const y = cleanIsbn(b);

  if (!x || !y) return false;
  if (x === y) return true;

  const x10 = convertIsbn13to10(x);
  const y10 = convertIsbn13to10(y);

  return x10 === y || y10 === x || x10 === y10;
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

function isImageUrl(url) {
  if (typeof url !== "string") return false;

  const cleanUrl = url.split("?")[0].toLowerCase();
  return /\.(jpg|jpeg|png|webp)$/i.test(cleanUrl);
}

function isBadCoverUrl(url) {
  if (!url) return true;

  const lower = String(url).toLowerCase();

  return (
    lower.includes("gstatic.com") ||
    lower.includes("google.com") ||
    lower.includes("icon") ||
    lower.includes("logo") ||
    lower.includes("avatar") ||
    lower.includes("placeholder") ||
    lower.includes("no-image") ||
    lower.includes("no_image") ||
    lower.includes("no-photo") ||
    lower.includes("no_photo") ||
    lower.includes("sprite")
  );
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();

  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(`JSON okunamadı. HTTP: ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`İstek başarısız. HTTP: ${response.status}`);
  }

  return data;
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
// SERPER IMAGES
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

function scoreCoverCandidate(item, { isbn, title, author }) {
  const imageUrl =
    item.imageUrl || item.thumbnailUrl || item.image || item.url || "";

  const meta = cleanText(
    [
      item.title,
      item.source,
      item.link,
      item.domain,
      imageUrl,
      item.imageUrl,
      item.thumbnailUrl,
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();

  let score = 0;

  const clean = cleanIsbn(isbn);
  const isbn10 = convertIsbn13to10(clean);

  if (clean && meta.includes(clean.toLowerCase())) score += 80;
  if (isbn10 && isbn10 !== clean && meta.includes(isbn10.toLowerCase())) {
    score += 50;
  }

  const titleWords = cleanText(title)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const authorWords = cleanText(author)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  for (const word of titleWords.slice(0, 5)) {
    if (meta.includes(word)) score += 8;
  }

  for (const word of authorWords.slice(0, 4)) {
    if (meta.includes(word)) score += 5;
  }

  if (isImageUrl(imageUrl)) score += 15;

  if (meta.includes("kitap")) score += 5;
  if (meta.includes("book")) score += 5;
  if (meta.includes("cover")) score += 5;
  if (meta.includes("kapak")) score += 5;

  if (isBadCoverUrl(imageUrl)) score -= 100;

  return score;
}

async function findCoverWithSerperImage({ isbn, title, author, publisher }) {
  const clean = cleanIsbn(isbn);

  const queries = [
    clean ? `"${clean}" kitap kapağı` : "",
    clean ? `"${clean}" book cover` : "",
    `${title || ""} ${author || ""} kitap kapağı ${clean}`,
    `${title || ""} ${author || ""} ${publisher || ""} kitap kapağı`,
    `${title || ""} ${author || ""} book cover`,
  ]
    .map((q) => q.trim())
    .filter(Boolean);

  const seen = new Set();
  const candidates = [];

  for (const query of queries) {
    try {
      console.log("🖼️ Serper kapak araması:", query);

      const data = await serperImages(query, {
        gl: "tr",
        hl: "tr",
        num: 10,
      });

      const images = Array.isArray(data?.images) ? data.images : [];

      for (const item of images) {
        const imageUrl =
          item.imageUrl ||
          item.thumbnailUrl ||
          item.image ||
          item.url ||
          "";

        if (!imageUrl) continue;
        if (seen.has(imageUrl)) continue;
        if (isBadCoverUrl(imageUrl)) continue;

        seen.add(imageUrl);

        candidates.push({
          url: imageUrl,
          score: scoreCoverCandidate(item, {
            isbn: clean,
            title,
            author,
          }),
        });
      }
    } catch (error) {
      console.warn("Serper kapak araması başarısız:", error.message);
    }
  }

  const sorted = candidates.sort((a, b) => b.score - a.score);

  const bestDirectImage = sorted.find((x) => isImageUrl(x.url));

  if (bestDirectImage) {
    console.log("✅ Kapak kaynağı: Serper Images", bestDirectImage.url);
    return bestDirectImage.url;
  }

  const bestAnyImage = sorted[0];

  if (bestAnyImage?.url) {
    console.log("✅ Kapak kaynağı: Serper Images fallback", bestAnyImage.url);
    return bestAnyImage.url;
  }

  console.log("⚠️ Serper kapak bulamadı, varsayılan görsel dönülüyor.");
  return NO_PHOTO_URL;
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
// GÜVENİLİR ISBN VERİ KAYNAKLARI
// ----------------------------------------------------------------

function getGoogleIsbnIdentifiers(volumeInfo) {
  const identifiers = Array.isArray(volumeInfo?.industryIdentifiers)
    ? volumeInfo.industryIdentifiers
    : [];

  return identifiers
    .map((x) => normalizeIsbnForCompare(x.identifier))
    .filter(Boolean);
}

function googleVolumeMatchesIsbn(volumeInfo, isbn) {
  const clean = normalizeIsbnForCompare(isbn);
  const isbn10 = convertIsbn13to10(clean);
  const ids = getGoogleIsbnIdentifiers(volumeInfo);

  return ids.some((id) => isbnMatches(clean, id) || isbnMatches(isbn10, id));
}

async function lookupGoogleBooksByIsbn(isbn) {
  const clean = normalizeIsbnForCompare(isbn);

  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(
      clean
    )}&maxResults=5&printType=books`;

    const data = await fetchJson(url);
    const items = Array.isArray(data?.items) ? data.items : [];

    const exact = items.find((item) =>
      googleVolumeMatchesIsbn(item.volumeInfo, clean)
    );

    if (!exact) return null;

    const info = exact.volumeInfo || {};

    return {
      source: "google_books",
      sourceIsbn:
        getGoogleIsbnIdentifiers(info).find((id) => isbnMatches(clean, id)) ||
        clean,
      title: info.title || null,
      author: Array.isArray(info.authors) ? info.authors.join(", ") : null,
      publisher: info.publisher || null,
      pageCount:
        typeof info.pageCount === "number" && Number.isFinite(info.pageCount)
          ? info.pageCount
          : null,
      publishedDate: info.publishedDate || null,
      description: cleanText(info.description || ""),
      categories: Array.isArray(info.categories) ? info.categories : [],
    };
  } catch (error) {
    console.warn("Google Books ISBN araması başarısız:", error.message);
    return null;
  }
}

async function lookupOpenLibraryByIsbn(isbn) {
  const clean = normalizeIsbnForCompare(isbn);

  try {
    const editionUrl = `https://openlibrary.org/isbn/${encodeURIComponent(
      clean
    )}.json`;

    const data = await fetchJson(editionUrl);

    let authorNames = [];

    if (Array.isArray(data?.authors)) {
      const limitedAuthors = data.authors.slice(0, 3);

      for (const authorRef of limitedAuthors) {
        if (!authorRef?.key) continue;

        try {
          const authorData = await fetchJson(
            `https://openlibrary.org${authorRef.key}.json`
          );

          if (authorData?.name) {
            authorNames.push(authorData.name);
          }
        } catch {}
      }
    }

    return {
      source: "open_library",
      sourceIsbn: clean,
      title: data.title || null,
      author: authorNames.length > 0 ? authorNames.join(", ") : null,
      publisher:
        Array.isArray(data.publishers) && data.publishers.length > 0
          ? data.publishers[0]
          : null,
      pageCount:
        typeof data.number_of_pages === "number" &&
        Number.isFinite(data.number_of_pages)
          ? data.number_of_pages
          : null,
      publishedDate: data.publish_date || null,
      description:
        typeof data.description === "string"
          ? cleanText(data.description)
          : typeof data.description?.value === "string"
          ? cleanText(data.description.value)
          : "",
      categories:
        Array.isArray(data.subjects) && data.subjects.length > 0
          ? data.subjects.slice(0, 5)
          : [],
    };
  } catch (error) {
    console.warn("Open Library ISBN araması başarısız:", error.message);
    return null;
  }
}

function mergeBookData(primary, secondary) {
  if (!primary && !secondary) return null;

  const base = primary || secondary;
  const other = primary ? secondary : null;

  return {
    source: base.source,
    sourceIsbn: base.sourceIsbn,
    title: base.title || other?.title || null,
    author: base.author || other?.author || null,
    publisher: base.publisher || other?.publisher || null,
    pageCount: base.pageCount || other?.pageCount || null,
    publishedDate: base.publishedDate || other?.publishedDate || null,
    description: base.description || other?.description || "",
    categories:
      Array.isArray(base.categories) && base.categories.length > 0
        ? base.categories
        : Array.isArray(other?.categories)
        ? other.categories
        : [],
  };
}

async function enrichBookWithGeminiIfNeeded(book, isbn) {
  if (!book?.title || !book?.author) return book;

  const needsDescription = !book.description || book.description.length < 40;
  const needsCategories =
    !Array.isArray(book.categories) || book.categories.length === 0;

  if (!needsDescription && !needsCategories) return book;

  const prompt = `
Aşağıdaki kitap için eksik açıklama ve kategori bilgilerini tamamla.
Kitap zaten ISBN veri kaynaklarından doğrulanmıştır; kitap adını, yazarı, yayınevini ve sayfa sayısını değiştirme.

ISBN: ${isbn}
Kitap adı: ${book.title}
Yazar: ${book.author}
Yayınevi: ${book.publisher || "Bilinmiyor"}
Sayfa: ${book.pageCount || "Bilinmiyor"}
Yayın tarihi: ${book.publishedDate || "Bilinmiyor"}

Sadece JSON döndür:

{
  "description": "2-4 cümlelik Türkçe kısa özet",
  "categories": ["Kategori 1", "Kategori 2"]
}

Kurallar:
- Kitap adını tahmin etme.
- Yazar/yayınevi/sayfa bilgisi değiştirme.
- JSON dışında hiçbir şey yazma.
`.trim();

  try {
    const text = await callGemini({
      prompt,
      temperature: 0.2,
      googleSearch: true,
    });

    const extra = parseJsonFromText(text, {});

    return {
      ...book,
      description:
        book.description ||
        (typeof extra.description === "string" ? extra.description : ""),
      categories:
        Array.isArray(book.categories) && book.categories.length > 0
          ? book.categories
          : Array.isArray(extra.categories)
          ? extra.categories
          : [],
    };
  } catch (error) {
    console.warn("Gemini zenginleştirme başarısız:", error.message);
    return book;
  }
}

async function getBookByIsbnReliable(isbn) {
  const clean = normalizeIsbnForCompare(isbn);

  const googleBook = await lookupGoogleBooksByIsbn(clean);
  const openLibraryBook = await lookupOpenLibraryByIsbn(clean);

  console.log("📘 Google Books sonucu:", JSON.stringify(googleBook, null, 2));
  console.log("📗 Open Library sonucu:", JSON.stringify(openLibraryBook, null, 2));

  const merged = mergeBookData(googleBook, openLibraryBook);

  if (!merged?.title || !merged?.author) {
    return {
      found: false,
      message:
        "Bu ISBN için güvenilir kitap verisi bulunamadı. Bilgileri manuel girebilirsin.",
    };
  }

  const enriched = await enrichBookWithGeminiIfNeeded(merged, clean);

  return {
    found: true,
    sourceIsbn: clean,
    title: enriched.title,
    author: enriched.author,
    publisher: enriched.publisher,
    pageCount: enriched.pageCount,
    publishedDate: enriched.publishedDate,
    description: enriched.description,
    categories: Array.isArray(enriched.categories)
      ? enriched.categories.slice(0, 5)
      : [],
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
      isbnData: "Google Books + Open Library",
      enrichment: "Gemini",
      cover: "Serper Images",
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

        const book = await getBookByIsbnReliable(clean);

        console.log("📚 ISBN güvenilir veri cevabı:", JSON.stringify(book, null, 2));

        if (!book?.found) {
          return json(res, 200, {
            found: false,
            message:
              book?.message ||
              "Bu ISBN için güvenilir bir kayıt bulunamadı. Bilgileri manuel girebilirsin.",
          });
        }

        let finalCoverUrl = NO_PHOTO_URL;

        try {
          finalCoverUrl = await findCoverWithSerperImage({
            isbn: clean,
            title: book.title,
            author: book.author,
            publisher: book.publisher,
          });
        } catch (error) {
          console.warn("Serper kapak arama hatası:", error.message);
          finalCoverUrl = NO_PHOTO_URL;
        }

        const normalizedCategories = Array.isArray(book.categories)
          ? book.categories
              .filter((c) => typeof c === "string" && c.trim() !== "")
              .map((c) => c.trim())
          : [];

        const normalized = {
          found: true,
          title: book.title || null,
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
          coverImageUrl: finalCoverUrl || NO_PHOTO_URL,
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
            "Sunucu tarafında bir hata oluştu (ISBN güvenilir kaynak + Serper).",
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
  console.log("🔎 Mod: Google Books + Open Library + Gemini + Serper Images");
});