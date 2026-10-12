const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recommendationIntent,matchesSeriesIntent,excludedKeys}=require('./mediaRecommendationIntent');
test('Mini series and optional Turkish productions are explicit constraints',()=>{
 const intent=recommendationIntent('Mini dizi, yerel diziler de olabilir. En fazla 8 bölüm');
 assert.equal(intent.mini,true);assert.equal(intent.localOptional,true);assert.equal(intent.maxEpisodes,8);
 assert.equal(recommendationIntent('Yerli dizi istiyorum').localOptional,false);
 assert.equal(recommendationIntent('Gizemli bir film').mini,false);
});
test('Mini series metadata rejects long, multiple-season and unverified shows',()=>{
 const intent=recommendationIntent('Mini dizi');
 const details={number_of_seasons:1,number_of_episodes:8,type:'Miniseries',in_production:false};
 assert.equal(matchesSeriesIntent(details,intent),true);
 for(const change of [{number_of_seasons:2},{number_of_episodes:20},{number_of_episodes:0},{type:'Scripted',in_production:true}]) assert.equal(matchesSeriesIntent({...details,...change},intent),false);
 assert.equal(matchesSeriesIntent({...details,type:'Scripted'},intent),true);
});
test('Seen recommendations are bounded and validated',()=>{
 assert.deepEqual([...excludedKeys(['TV:42','MOVIE:31','invalid','TV:x'])],['TV:42','MOVIE:31']);
 assert.equal(excludedKeys(Array.from({length:150},(_,id)=>`TV:${id}`)).size,120);
});
