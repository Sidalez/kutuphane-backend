const {test}=require('node:test');const assert=require('node:assert/strict');
const {shouldResumeSeries}=require('./seriesStatus');
const item={type:'TV',status:'IZLENDI',watchedEpisodes:Array.from({length:10},(_,i)=>({seasonNumber:1,episodeNumber:i+1}))};
const ep={season_number:1,episode_number:11,air_date:'2027-03-12'};
test('Completed TV series resumes after a later unwatched episode airs, even five months later',()=>{
 assert.equal(shouldResumeSeries(item,ep,'2027-03-12'),true);
 assert.equal(shouldResumeSeries(item,{...ep,season_number:2,episode_number:1},'2027-03-12'),true);
 assert.equal(shouldResumeSeries(item,ep,'2027-03-11'),false);
 assert.equal(shouldResumeSeries(item,{...ep,episode_number:10},'2027-03-12'),false);
 for(const status of ['BIRAKILDI','IZLENECEK','IZLENIYOR']) assert.equal(shouldResumeSeries({...item,status},ep,'2027-03-12'),false);
 assert.equal(shouldResumeSeries({...item,type:'MOVIE'},ep,'2027-03-12'),false);
 assert.equal(shouldResumeSeries(item,{...ep,season_number:0},'2027-03-12'),false);
});
test('Legacy completed records need a release after completion, never arbitrary old unwatched episodes',()=>{
 const legacy={type:'TV',status:'IZLENDI',completedAt:'2026-10-12'};
 assert.equal(shouldResumeSeries(legacy,ep,'2027-03-12'),true);
 assert.equal(shouldResumeSeries(legacy,{...ep,air_date:'2026-09-01'},'2027-03-12'),false);
 assert.equal(shouldResumeSeries({...legacy,completedAt:null},ep,'2027-03-12'),false);
});
