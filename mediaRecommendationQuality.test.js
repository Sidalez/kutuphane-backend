const {test}=require('node:test');const assert=require('node:assert/strict');
const {qualityScore,reliableCandidate,balancedSelection}=require('./mediaRecommendationQuality');
test('A few perfect votes cannot outrank an established good film',()=>{
 assert.ok(qualityScore(8.1,5000)>qualityScore(10,3));
 assert.equal(reliableCandidate({vote_average:10,vote_count:3,poster_path:'/x'},'MOVIE'),false);
 assert.equal(reliableCandidate({vote_average:8,vote_count:500,poster_path:'/x'},'MOVIE'),true);
 assert.equal(reliableCandidate({adult:true,vote_average:8,vote_count:500,poster_path:'/x'},'MOVIE'),false);
});
test('All results balance movies and shows while explicit movie choice stays movie-only',()=>{
 const items=[...Array.from({length:12},(_,id)=>({id,type:'TV'})),...Array.from({length:12},(_,id)=>({id,type:'MOVIE'}))];
 const result=balancedSelection(items);assert.equal(result.length,12);assert.equal(result.filter(i=>i.type==='MOVIE').length,6);
 assert.ok(balancedSelection(items,'MOVIE').every(i=>i.type==='MOVIE'));
 assert.equal(balancedSelection(items.slice(0,3),'ALL').length,3);
});
test('Discovery sends real TMDB vote filters and explicit genres override history',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const source=fs.readFileSync(require.resolve('./server'),'utf8');
 const start=source.indexOf('async function discoverSuggestionsByType('),end=source.indexOf('async function getDiscoverySuggestions(',start);
 let parameters,selected;
 const context={TMDB_LANGUAGE:'tr-TR',TMDB_REGION:'TR',getTmdbGenreList:async()=>[],inferPreferredGenresFromHistory:()=>['Korku'],resolveGenreIds:(values)=>{selected=values;return [18,35]},asStringArray:value=>value||[],inferOriginalLanguage:()=>'',tmdbRequest:async(path,params)=>{parameters=params;return {results:[]}},normalizeSuggestionCandidate:()=>{},dedupeAndFilterSuggestions:()=>[],reliableCandidate};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 await context.discoverSuggestionsByType({type:'MOVIE',mode:'HIGH_RATED_UNWATCHED',description:'',selectedGenres:['Komedi'],provider:'',history:{},alreadyAddedSet:new Set()});
 assert.equal(parameters['vote_count.gte'],1000);assert.equal(parameters.vote_count_gte,undefined);assert.equal(parameters['vote_average.gte'],7);assert.equal(parameters.with_genres,'18|35');assert.deepEqual(selected,['Komedi']);
});
