const {test}=require('node:test');const assert=require('node:assert/strict');
const {readableTitle,createMediaTitleResolver}=require('./mediaTitles');
test('Turkish and international Latin titles remain unchanged',async()=>{
 const resolve=createMediaTitleResolver(()=>{throw Error('Must not fetch');});
 assert.equal(await resolve({title:'Şeytanın Avukatı'}),'Şeytanın Avukatı');
 assert.equal(await resolve({title:'The Testaments'}),'The Testaments');
 assert.equal(readableTitle('唐朝诡事录'),false);assert.equal(readableTitle('Игант'),false);
});
test('Non-Latin titles use verified English metadata by the same ID and cache results',async()=>{
 let calls=0;const resolve=createMediaTitleResolver(async(path,params)=>{calls++;assert.equal(path,'/tv/123');assert.equal(params.language,'en-US');return {name:'Strange Tales of Tang Dynasty'};});
 const item={tmdbId:123,type:'TV',title:'唐朝诡事录',originalTitle:'唐朝诡事录'};
 assert.equal(await resolve(item),'Strange Tales of Tang Dynasty');await resolve(item);assert.equal(calls,1);
 assert.equal(item.originalTitle,'唐朝诡事录');
});
test('Missing international titles never invent a translation and transient failures can retry',async()=>{
 let calls=0;const resolve=createMediaTitleResolver(async()=>{if(++calls===1)throw Error('timeout');return {title:'International Film'};});
 assert.equal(await resolve({type:'MOVIE',tmdbId:5,title:'作品'}),null);
 assert.equal(await resolve({type:'MOVIE',tmdbId:5,title:'作品'}),'International Film');
 assert.equal(await createMediaTitleResolver(async()=>({name:'作品'}))({tmdbId:6,type:'TV',title:'作品'}),null);
});
