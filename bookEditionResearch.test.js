const assert = require('node:assert/strict');
const { validIsbn, parseEdition, consensus, createEditionResearch } = require('./bookEditionResearch');
const book = { title: 'Ben, Robot', author: 'Isaac Asimov' };
const html = '<h1>Ben, Robot</h1><p>Isaac Asimov ISBN: 9786053756040 Yayınevi: İthaki Yayınları Sayfa Sayısı: 240 Yayın Tarihi: 2023</p>';
assert.equal(validIsbn('978-605-375-604-0'), '9786053756040');
assert.equal(validIsbn('9786053756041'), null);
const parsed = parseEdition(html, 'https://one.test/book', book);
assert.equal(parsed.publisher, 'İthaki Yayınları');
assert.equal(parsed.pageCount, 240);
assert.equal(parseEdition(html.replace('Ben, Robot', 'Başka Kitap') + ' Ben, Robot', 'https://one.test/book', book), null);
assert.equal(parseEdition(html, 'https://one.test/book', {}, '9789750849503'), null);
assert.equal(consensus([parsed, { ...parsed, editionSource: 'https://one.test/other' }], 'pageCount'), null);
assert.equal(consensus([parsed, { ...parsed, editionSource: 'https://two.test/book' }], 'pageCount'), 240);
assert.equal(consensus([parsed, { ...parsed, pageCount: 24, editionSource: 'https://two.test/book' }], 'pageCount'), null);
// Store pricing immediately follows the author label on some product pages.
for (const suffix of ['30% indirim ₺180,00 ₺126,00', '%30 indirim 180,00 TL', '180,00 TL Sepete Ekle', '₺180,00', 'Kargo bedava', '180,00 ₺', '&#8378;180,00']) {
  const page = `<h1>Zaman Makinesi</h1><p>ISBN: 9786053754268 Yazar: H. G. WELLS ${suffix}</p>`;
  assert.equal(parseEdition(page, 'https://store.test/book', {}, '9786053754268').author, 'H. G. WELLS', suffix);
}
const schemaPage = `<h1>Zaman Makinesi</h1><script type="application/ld+json">${JSON.stringify({isbn:'9786053754268',name:'Zaman Makinesi',author:{name:'H. G. Wells 30% indirim ₺180,00'}})}</script>`;
assert.equal(parseEdition(schemaPage, 'https://store.test/book', {}, '9786053754268').author, 'H. G. Wells');
const linkedPage = '<h1>Zaman Makinesi</h1><p>ISBN: 9786053754268 Yazar: ₺180,00</p><a href="/yazar/h-g-wells">H. G. Wells</a>';
assert.equal(parseEdition(linkedPage, 'https://store.test/book', {}, '9786053754268').author, 'H. G. Wells');
(async () => {
  let searches = 0;
  const research = createEditionResearch({
    search: async () => { searches++; return searches === 1 ? { organic: [] } : { organic: [{ link: 'https://one.test/book' }, { link: 'https://two.test/book' }] }; },
    fetchPage: async () => ({ ok: true, text: async () => html }),
  });
  const result = await research(book);
  assert.equal(result.isbn, '9786053756040');
  assert.equal(result.pageCount, 240);
  assert.equal(searches, 3, 'fallback search and ISBN cross-check must run');
  await research(book);
  assert.equal(searches, 3, 'successful research should be cached');
  console.log('Edition research checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
