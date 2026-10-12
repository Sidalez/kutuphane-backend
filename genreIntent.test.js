const {test}=require('node:test');const assert=require('node:assert/strict');
test('Mini series wording does not accidentally select soap operas',()=>{
 const fs=require('node:fs'),vm=require('node:vm');const source=fs.readFileSync(require.resolve('./server'),'utf8');
 const start=source.indexOf('function resolveGenreIds('),end=source.indexOf('async function getTmdbProviderList',start);
 const context={asStringArray:x=>x||[],normalizeSuggestionText:x=>String(x||'').toLocaleLowerCase('tr-TR')};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 assert.equal(context.resolveGenreIds([],'Mini dizi istiyorum, yerli diziler de olabilir',[{id:10766,name:'Pembe Dizi'}]).length,0);
 assert.equal(context.resolveGenreIds([],'Komedi istiyorum',[{id:35,name:'Komedi'}])[0],35);
});
