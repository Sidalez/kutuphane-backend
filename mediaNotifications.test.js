const test=require('node:test');const assert=require('node:assert/strict');
const {upcomingEvent,filmRelease,trailerEvents}=require('./mediaNotifications');
const p={timeZone:'Europe/Istanbul',upcomingTime:'10:00'};
const item={id:'one',type:'TV',title:'Dizi',watchedEpisodes:[]};
test('Two-day reminder uses local date and chosen hour, skips watched and late episodes',()=>{
 const release={date:'2026-10-15',season:1,episode:18};
 assert.ok(upcomingEvent(item,release,new Date('2026-10-13T07:00:00Z'),p));
 assert.equal(upcomingEvent(item,release,new Date('2026-10-13T06:59:00Z'),p),null);
 assert.equal(upcomingEvent(item,release,new Date('2026-10-12T10:00:00Z'),p),null);
 assert.equal(upcomingEvent(item,release,new Date('2026-10-15T10:00:00Z'),p),null);
 assert.equal(upcomingEvent({...item,watchedEpisodes:[{seasonNumber:1,episodeNumber:18}]},release,new Date('2026-10-13T10:00:00Z'),p),null);
 assert.notEqual(upcomingEvent(item,release,new Date('2026-10-13T10:00:00Z'),p).id,upcomingEvent(item,{...release,date:'2026-10-16'},new Date('2026-10-14T10:00:00Z'),p).id);
});
test('Film release requires Turkey cinema/digital dates, never turns UTC midnight into broadcast time',()=>{
 assert.equal(filmRelease({results:[{iso_3166_1:'US',release_dates:[{type:3,release_date:'2026-10-15'}]}]},'2026-10-12'),null);
 assert.equal(filmRelease({results:[{iso_3166_1:'TR',release_dates:[{type:1,release_date:'2026-10-14'},{type:4,release_date:'2026-10-15T00:00:00Z'}]}]},'2026-10-12').date,'2026-10-15');
});
test('Only recent official trailers with valid YouTube keys are accepted',()=>{
 const now=new Date('2026-10-12T10:00:00Z');const video={official:true,site:'YouTube',type:'Trailer',key:'abcdefghijk',published_at:'2026-10-11T10:00:00Z'};
 const result=trailerEvents(item,[video,{...video,official:false},{...video,published_at:'2020-01-01'},{...video,key:'javascript:bad'}],now,{season:1,episode:18});
 assert.equal(result.length,1);assert.match(result[0].body,/18/);assert.equal(result[0].sourceUrl,'https://www.youtube.com/watch?v=abcdefghijk');
});
const {parseOfficialTrailer}=require('./officialTrailers');
test('Official broadcaster parser rejects other episodes and unrelated navigation times',()=>{
 const url='https://www.showtv.com.tr/dizi/fragman/muhtemel-ask-18-bolum-fragmani/135332';
 const html='<h1>Muhtemel Aşk 18. Bölüm Fragmanı</h1><a>Başka Dizi YENİ BÖLÜM PERŞEMBE 21.00</a><a>Muhtemel Aşk YENİ BÖLÜM PERŞEMBE 20.00</a>';
 assert.match(parseOfficialTrailer(html,url,'Muhtemel Aşk',{season:1,episode:18,date:'2026-10-15'}).schedule,/20:00/);
 assert.equal(parseOfficialTrailer(html,url,'Muhtemel Aşk',{season:1,episode:17,date:'2026-10-15'}),null);
 assert.equal(parseOfficialTrailer(html,url.replace('www.showtv.com.tr','evil.example'),'Muhtemel Aşk',{season:1,episode:18,date:'2026-10-15'}),null);
 assert.equal(parseOfficialTrailer(html,url,'Muhtemel Aşk',{season:1,episode:18,date:'2026-10-16'}).schedule,null);
});
