const normalize = value => String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
const plain = html => String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
function validIsbn(value) {
  const isbn = String(value || '').replace(/[^\d]/g, '');
  return /^97[89]\d{10}$/.test(isbn) && [...isbn].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10 === 0 ? isbn : null;
}
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
  const publisherLabel = text.match(/(?:Yayınevi|Yayın Evi|Yayıncı)\s*:?\s*(.{2,100}?)(?=\s+(?:Yazar|Barkod|ISBN|Sayfa|Boyut|Çevirmen|Kategori|Dil|Yayın|Basım|Cilt|Kağıt|Kâğıt|Kapak|Ürün|Stok|Orijinal)\b|$)/i)?.[1];
  const publisher = plain(name(schema?.publisher) || name(schema?.brand) || publisherLabel) || null;
  const pages = Number(schema?.numberOfPages || text.match(/(?:Sayfa\s*(?:Sayısı|Adedi)|Sayfa)\s*:?\s*(\d{1,4})\b/i)?.[1]);
  const date = String(schema?.datePublished || text.match(/(?:Yayın Tarihi|Yayımlanma Tarihi|Basım Tarihi|Basım Yılı|Yayın Yılı|Çıkış Tarihi)\s*:?\s*((?:\d{1,2}[./-]){0,2}(?:19|20)\d{2}(?:-\d{2})?)/i)?.[1] || '');
  return { isbn, publisher, pageCount: pages > 0 && pages < 10000 ? pages : null, publishYear: date.match(/(?:19|20)\d{2}/)?.[0] || null, editionSource: url };
}
function consensus(sources, field) {
  const groups = new Map();
  for (const source of sources) {
    if (source[field] == null) continue;
    const key = normalize(source[field]);
    if (!groups.has(key)) groups.set(key, { value: source[field], hosts: new Set() });
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
module.exports = { validIsbn, parseEdition, consensus, createEditionResearch };
