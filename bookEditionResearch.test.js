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
