const { localClock } = require('./notificationLogic');
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0,10) === value;
function upcomingEvent(item, release, now, p) {
  if (!validDate(release?.date)) return null;
  const today = localClock(now, p.timeZone).date;
  const days = (Date.parse(release.date) - Date.parse(today)) / 86400000;
  if (days < 1 || days > 2 || localClock(now,p.timeZone).time < p.upcomingTime) return null;
  if (item.type === 'TV' && (item.watchedEpisodes || []).some(e => e.seasonNumber === release.season && e.episodeNumber === release.episode)) return null;
  const label = item.type === 'TV' ? `${release.season}. sezon, ${release.episode}. bölüm` : release.label;
  return { id: `upcoming_${item.id}_${release.season || 0}_${release.episode || 0}_${release.date}`, kind:'upcoming', itemId:item.id,
    title:`${item.title} · Yayın yaklaşıyor`, body:`${label}: ${release.date.split('-').reverse().join('.')}. ${release.region || 'TMDB takvimi'}; yayın saati açıklanmadı.`,
    url:`/media/${encodeURIComponent(item.id)}`, airDate:release.date, expiresAt:Date.parse(release.date+'T00:00:00Z') };
}
function filmRelease(data, today) {
  const releases = (data?.results || []).filter(r => r.iso_3166_1 === 'TR').flatMap(r => r.release_dates || [])
    .filter(r => [3,4].includes(r.type)).map(r=>({date:String(r.release_date).slice(0,10),label:r.type===3?'Türkiye sinema gösterimi':'Türkiye dijital yayını',region:'TMDB Türkiye takvimi'}))
    .filter(r=>validDate(r.date) && r.date > today).sort((a,b)=>a.date.localeCompare(b.date));
  return releases[0] || null;
}
function trailerEvents(item, videos, now, release) {
  return (videos || []).filter(v => v.official === true && v.site === 'YouTube' && ['Trailer','Teaser'].includes(v.type) && /^[\w-]{11}$/.test(v.key || '') && Number.isFinite(Date.parse(v.published_at)) && now-Date.parse(v.published_at)>=0 && now-Date.parse(v.published_at)<7*86400000)
    .sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)).slice(0,1).map(v=>({
      id:release ? `trailer_tv_${item.id}_${release.season}_${release.episode}` : `trailer_${item.id}_${v.key}`,kind:'trailer',itemId:item.id,title:`${item.title} · Yeni fragman`,
      body:release ? `${release.season}. sezon, ${release.episode}. bölüm için resmî fragman yayımlandı.` : 'Yeni resmî film fragmanı yayımlandı.',
      url:`/media/${encodeURIComponent(item.id)}`,sourceUrl:`https://www.youtube.com/watch?v=${v.key}`,
    }));
}
module.exports={upcomingEvent,filmRelease,trailerEvents};
