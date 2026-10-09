const normalize = value => String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').replace(/[^\p{L}\p{N}]/gu, '');
const plain = html => String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&(uuml|Uuml|ouml|Ouml|ccedil|Ccedil|scedil|Scedil|gbreve|Gbreve|imath|Idot);/g, (_, entity) => ({uuml:'ü',Uuml:'Ü',ouml:'ö',Ouml:'Ö',ccedil:'ç',Ccedil:'Ç',scedil:'ş',Scedil:'Ş',gbreve:'ğ',Gbreve:'Ğ',imath:'ı',Idot:'İ'}[entity])).replace(/\s+/g, ' ').trim();
function cleanDescription(value) {
  if (typeof value !== 'string') return null;
  const blocks = value
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/&bull;|&#8226;/gi, '• ')
    .replace(/&#(\d+);/g, (_, number) => Number(number) <= 0x10ffff ? String.fromCodePoint(Number(number)) : '')
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => parseInt(number, 16) <= 0x10ffff ? String.fromCodePoint(parseInt(number, 16)) : '');
  let text = blocks.split(/\n+/).map(plain).filter(Boolean).join('\n\n');
  text = text.replace(/^\s*(?:Kitap Açıklaması|Ürün Açıklaması|Kitap Hakkında|Açıklama)\s*:?\s*/i, '');
  // Some stores place their entire product panel inside schema.org description.
  // Stop at the metadata heading, even if the store concatenates all its cells.
  text = text.split(/(?:Kitap Özellikleri|Ürün Özellikleri|Teknik Özellikler|Kitap Künyesi|Ürün Künyesi|Künye)(?=\s|Barkod|ISBN|Yazar|Yayınevi|Basım|$)/i)[0];
  text = text.replace(/(?:Barkod|ISBN(?:-13)?)\s*:?\s*97[89][\d\s-]{10,}[\s\S]*$/i, '');
  text = text.replace(/([.!?])(?=[A-ZÇĞİÖŞÜ])/g, '$1\n\n').trim();
  return text || null;
}
function validIsbn(value) {
  const isbn = String(value || '').replace(/[^\d]/g, '');
  return /^97[89]\d{10}$/.test(isbn) && [...isbn].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10 === 0 ? isbn : null;
}
// Academic and medical honorifics are not part of the person's identity.
const authorName = value => plain(value).replace(/^(?:(?:Prof(?:esör)?|Doç(?:ent)?|Dr|Doktor|Uzm|Op|Yrd)\.?\s+)+/iu, '').trim();
const name = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(name).join(' ') : value?.name || '';
function parseEdition(html, url, book = {}, expectedIsbn) {
  const text = plain(html);
  const heading = plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const schemas = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const visit = value => { if (!value || typeof value !== 'object') return; if (value.isbn || value.gtin13) schemas.push(value); Object.values(value).forEach(visit); }; visit(JSON.parse(match[1])); } catch {}
  }
  const schema = schemas.find(value => {
    const isbn = validIsbn(value.isbn || value.gtin13);
    if (expectedIsbn) return isbn === expectedIsbn;
    return isbn && normalize(value.name).includes(normalize(book.title)) && (!value.author || normalize(name(value.author)).includes(normalize(book.author)));
  });
  // Avoid accepting an ISBN from a recommendation carousel elsewhere on the page.
  if (!expectedIsbn && (!normalize(heading || schema?.name).includes(normalize(book.title)) || !normalize(text + ' ' + name(schema?.author)).includes(normalize(book.author)))) return null;
  const labelled = [...text.matchAll(/(?:ISBN(?:\s*-?\s*13)?|Barkod|Stok Kodu|Ürün Kodu)\s*:?\s*(97[89](?:[\s-]?\d){10})\b/gi)].map(m => validIsbn(m[1])).filter(Boolean);
  const isbn = validIsbn(schema?.isbn || schema?.gtin13) || labelled[0];
  if (!isbn || (expectedIsbn && isbn !== expectedIsbn)) return null;
  const publisherLabel = text.match(/(?:Yayınevi|Yayın Evi|Yayıncı)\s*:\s*(.{2,100}?)(?=\s+(?:Tür|Yazar|Barkod|ISBN|Sayfa|Boyut|Çevirmen|Kategori|Dil|Yayın|Basım|Cilt|Kağıt|Kâğıt|Kapak|Ürün|Stok|Orijinal)\b|$)/i)?.[1];
  const brandMeta = html.match(/<meta[^>]*property=["']product:brand["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const publisher = plain(name(schema?.publisher) || name(schema?.brand) || brandMeta || publisherLabel) || null;
  const pages = Number(schema?.numberOfPages || text.match(/(?:Sayfa\s*(?:Sayısı|Adedi)|Sayfa)\s*:?\s*(\d{1,4})\b/i)?.[1]);
  const date = String(schema?.datePublished || text.match(/(?:Yayın Tarihi|Yayımlanma Tarihi|Basım Tarihi|Basım Yılı|Yayın Yılı|Çıkış Tarihi)\s*:?\s*((?:(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+)?(?:\d{1,2}[./-]){0,2}(?:19|20)\d{2}(?:-\d{2})?)/i)?.[1] || '');
  const authorLabel = text.match(/(?:Yazar(?:ı)?|Eser Sahibi)\s*:\s*(.{2,100}?)(?=\s+(?:Yayınevi|Yayıncı|Barkod|ISBN|Sayfa|Boyut|Çevirmen|Kategori|Dil|Yayın|Basım|Cilt|Kağıt|Kâğıt|Kapak|Ürün|Stok|Orijinal)\b|$)/i)?.[1];
  const authorLink = [...html.matchAll(/<a\b[^>]*href=["'][^"']*\/yazar\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)].map(match => plain(match[1])).find(Boolean);
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const title = plain(schema?.name || book.searchTitle || ogTitle || html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]).split(/\s+[|–-]\s+/)[0].trim() || null;
  const author = authorName(name(schema?.author) || authorLabel || authorLink) || null;
  return { title, author, description: cleanDescription(schema?.description), isbn, publisher, pageCount: pages > 0 && pages < 10000 ? pages : null, publishYear: date.match(/(?:19|20)\d{2}/)?.[0] || null, editionSource: url };
}
function consensus(sources, field) {
  const groups = new Map();
  for (const source of sources) {
    if (source[field] == null) continue;
    const key = field === 'publisher' ? normalize(source[field]).replace(/(?:yayinlari|yayinevi|yayincilik|yayin)$/, '') : normalize(field === 'author' ? authorName(source[field]) : source[field]);
    if (!groups.has(key)) groups.set(key, { value: field === 'author' ? authorName(source[field]) : source[field], hosts: new Set() });
    groups.get(key).hosts.add(new URL(source.editionSource).hostname.replace(/^www\./, ''));
  }
  const ranked = [...groups.values()].sort((a,b) => b.hosts.size - a.hosts.size);
  return ranked[0]?.hosts.size >= 2 && (!ranked[1] || ranked[0].hosts.size > ranked[1].hosts.size) ? ranked[0].value : null;
}
function createEditionResearch({ search, fetchPage }) {
  const cache = new Map();
  async function collect(query, book, isbn) {
    const result = await search(query);
    const links = [...new Set((result.organic || []).map(item => item.link))].filter(link => /^https:\/\//.test(link)).slice(0, 6);
    return (await Promise.all(links.map(async link => { try { const response = await fetchPage(link, { signal: AbortSignal.timeout(8000) }); if (!response.ok) return null; return parseEdition(await response.text(), link, book, isbn); } catch { return null; } }))).filter(Boolean);
  }
  return async function research(book) {
    if (!book.title || !book.author) return {};
    const key = normalize(book.title) + '|' + normalize(book.author);
    const cached = cache.get(key); if (cached?.expires > Date.now()) return cached.value;
    let editions = await collect(`"${book.title}" "${book.author}" ISBN yayınevi`, book);
    if (!editions.length) editions = await collect(`${book.title} ${book.author} kitap barkod sayfa`, book);
    if (!editions.length) return {};
    // Prefer the edition independently identified on the most websites, then completeness.
    const hosts = isbn => new Set(editions.filter(e => e.isbn === isbn).map(e => new URL(e.editionSource).hostname.replace(/^www\./, ''))).size;
    editions.sort((a,b) => hosts(b.isbn)-hosts(a.isbn) || [b.publisher,b.pageCount,b.publishYear].filter(Boolean).length-[a.publisher,a.pageCount,a.publishYear].filter(Boolean).length);
    const selected = editions[0];
    const extra = await collect(`"${selected.isbn}" yayınevi sayfa yayın tarihi`, book, selected.isbn).catch(() => []);
    const sources = [...new Map([...editions.filter(e => e.isbn === selected.isbn), ...extra].map(e => [e.editionSource,e])).values()];
    const value = { ...selected, publisher: consensus(sources,'publisher') || selected.publisher, pageCount: consensus(sources,'pageCount'), publishYear: selected.publishYear || consensus(sources,'publishYear'), editionSources: sources.map(e => e.editionSource) };
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + 6 * 60 * 60 * 1000 });
    return value;
  };
}
module.exports = { cleanDescription, validIsbn, parseEdition, consensus, createEditionResearch };

function createIsbnResearch({ search, fetchPage }) {
  return async function researchIsbn(value) {
    const isbn = validIsbn(value);
    if (!isbn) return { found: false, message: "Geçerli bir ISBN-13 girilmelidir." };
    const sources = new Map();
    for (const suffix of ["kitap yazar yayınevi sayfa", "ISBN yazar sayfa sayısı"]) {
      const result = await search(`"${isbn}" ${suffix}`);
      const links = [...new Set((result.organic || []).map(item => item.link))].filter(link => /^https:\/\//.test(link) && !sources.has(link)).slice(0, 8);
      await Promise.all(links.map(async link => {
        try {
          const response = await fetchPage(link, { signal: AbortSignal.timeout(8000) });
          if (!response.ok) return;
          const edition = parseEdition(await response.text(), link, { searchTitle: (result.organic || []).find(item => item.link === link)?.title }, isbn);
          if (edition) sources.set(link, edition);
        } catch {}
      }));
      const values = [...sources.values()];
      if (consensus(values, 'author') && consensus(values, 'publisher') && consensus(values, 'pageCount')) break;
    }
    const values = [...sources.values()];
    const title = consensus(values, 'title') || values.find(source => source.title)?.title;
    if (!title) return { found: false, message: "Bu ISBN ile eşleşen kitap bilgisi internet kaynaklarında doğrulanamadı." };
    // Core bibliographic fields require independent websites to agree; never ask an LLM to fill gaps.
    const author = consensus(values, 'author'), publisher = consensus(values, 'publisher'), pageCount = consensus(values, 'pageCount');
    const publisherStem = normalize(publisher).replace(/(?:yayinlari|yayinevi|yayincilik|yayin)$/, '');
    const official = publisherStem && values.find(source => normalize(new URL(source.editionSource).hostname).includes(publisherStem));
    return { found: true, sourceIsbn: isbn, title, author, publisher, pageCount, publishedDate: official?.publishYear || consensus(values, 'publishYear'), description: values.find(source => source.description)?.description || null, categories: [], editionSources: values.map(source => source.editionSource), missingFields: [!author && 'Yazar', !publisher && 'Yayınevi', !pageCount && 'Sayfa sayısı'].filter(Boolean) };
  };
}
module.exports.createIsbnResearch = createIsbnResearch;
