function recommendationIntent(description='',genres=[]) {
  const text=`${description} ${genres.join(' ')}`.toLocaleLowerCase('tr-TR');
  const mini=/mini[\s-]*dizi|miniseries|limited series|tek sezon|kısa dizi/.test(text);
  const local=/yerli|yerel|türk diz|türk film|türkiye yapımı/.test(text);
  const localOptional=local && /olabilir|dahil|da olsun|de olsun|fark etmez/.test(text);
  const count=text.match(/(?:en fazla|maksimum|max)\s*(\d{1,2})\s*bölüm/);
  return {mini,local,localOptional,maxEpisodes:count?Math.max(1,Math.min(30,+count[1])):12,ended:/tamamlanmış|bitmiş|final yapmış/.test(text)};
}
function matchesSeriesIntent(details,intent) {
  if(!intent.mini && !intent.ended)return true;
  if(intent.ended && details.in_production!==false)return false;
  if(!intent.mini)return true;
  return Number(details.number_of_seasons)===1 && Number(details.number_of_episodes)>0 && Number(details.number_of_episodes)<=intent.maxEpisodes && (details.type==='Miniseries' || details.in_production===false);
}
function excludedKeys(value) {
 return new Set((Array.isArray(value)?value:[]).slice(-120).filter(key=>/^(TV|MOVIE):\d+$/.test(key)));
}
module.exports={recommendationIntent,matchesSeriesIntent,excludedKeys};
