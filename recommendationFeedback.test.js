const {test}=require('node:test');const assert=require('node:assert/strict');
const {cleanFeedback,excludesBook}=require('./recommendationFeedback');
test('Dismissed and consumed books are excluded by edition or title and author, likes remain eligible',()=>{
 const feedback=cleanFeedback([{kind:'BOOK',title:'Ayı',author:'James Oliver Curwood',action:'dismissed'},{kind:'BOOK',title:'Diğer',author:'Yazar',isbn:'9786259355948',action:'consumed'},{kind:'BOOK',title:'Sevilen',author:'Yazar',action:'liked'}]);
 assert.equal(excludesBook({title:' AYI ',author:'JAMES OLIVER CURWOOD'},feedback),true);
 assert.equal(excludesBook({title:'Başka baskı',author:'Yazar',isbn:'9786259355948'},feedback),true);
 assert.equal(excludesBook({title:'Ayı',author:'Başka yazar'},feedback),false);
 assert.equal(excludesBook({title:'Sevilen',author:'Yazar'},feedback),false);
});
test('Feedback input is validated and bounded',()=>{
 assert.equal(cleanFeedback([null,{kind:'BOOK',title:'Test',action:'invalid'}]).length,0);
 assert.equal(cleanFeedback(Array.from({length:250},()=>({kind:'TV',title:'Test',action:'consumed',tmdbId:1}))).length,200);
});
test('Media exclusions preserve the film and show ID namespaces',()=>{
 const fs=require('node:fs'),vm=require('node:vm');const source=fs.readFileSync(require.resolve('./server'),'utf8');
 const start=source.indexOf('function getHistoryAlreadyAddedSet('),end=source.indexOf('\nfunction ',start+20);
 const context={cleanFeedback};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 const result=context.getHistoryAlreadyAddedSet({recommendationFeedback:[{kind:'TV',title:'Show',tmdbId:42,action:'dismissed'},{kind:'MOVIE',title:'Film',tmdbId:31,action:'liked'}]});
 assert.equal(result.has('TV:42'),true);assert.equal(result.has('MOVIE:42'),false);assert.equal(result.has('MOVIE:31'),false);
});
