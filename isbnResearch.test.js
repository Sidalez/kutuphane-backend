const assert=require('node:assert/strict');
const {createIsbnResearch}=require('./bookEditionResearch');
const html=(pages,author='James Oliver Curwood')=>`<h1>Ayı</h1><p>ISBN: 9786259355948 Yazar: ${author} Yayınevi: Budala Kitap Sayfa Sayısı: ${pages} Yayın Tarihi: 2026</p>`;
async function check(secondPages) {
 const research=createIsbnResearch({search:async()=>({organic:[{link:'https://one.test/book'},{link:'https://two.test/book'}]}),fetchPage:async url=>({ok:true,text:async()=>html(url.includes('one.test')?192:secondPages)})});
 return research('9786259355948');
}
(async()=>{
 const verified=await check(192);assert.equal(verified.author,'James Oliver Curwood');assert.equal(verified.publisher,'Budala Kitap');assert.equal(verified.pageCount,192);assert.deepEqual(verified.missingFields,[]);
 const conflict=await check(240);assert.equal(conflict.pageCount,null);assert.ok(conflict.missingFields.includes('Sayfa sayısı'));
 const invalid=createIsbnResearch({search:()=>{throw Error('invalid ISBN must not search')},fetchPage:()=>{}});assert.equal((await invalid('9786259355949')).found,false);
 console.log('ISBN internet-only metadata, disagreement and checksum checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
