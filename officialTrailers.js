const normalize = text => String(text).replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function officialUrl(value) {
  try { const u=new URL(value); return u.protocol==='https:' && u.hostname==='www.showtv.com.tr' && !u.port && !u.username && !u.password && /^\/dizi\/fragman\/[a-z0-9-]+\/\d+$/.test(u.pathname) ? u.href : null; } catch { return null; }
}
function parseOfficialTrailer(html,url,title,release) {
  if (!officialUrl(url)) return null;
  const heading=normalize(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const expected=normalize(`${title} ${release.episode} Bölüm Fragmanı`);
  if (heading!==expected || release.season!==1) return null;
  let schedule=null;
  const weekdays=['pazar','pazartesi','salı','çarşamba','perşembe','cuma','cumartesi'];
  for (const match of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text=normalize(match[1]);
    const prefix=normalize(title)+' yeni bölüm ';
    if (!text.startsWith(prefix)) continue;
    const slot=text.slice(prefix.length).match(/^(pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar) (\d{1,2}) (\d{2})$/);
    if (!slot || +slot[2]>23 || +slot[3]>59 || weekdays[new Date(release.date+'T12:00:00Z').getUTCDay()]!==slot[1]) continue;
    schedule=`${slot[2].padStart(2,'0')}:${slot[3]} (Türkiye saati, Show TV’nin haftalık yayın planı)`;
  }
  return {sourceUrl:url,schedule};
}
async function loadOfficialTrailer(search,title,release) {
  if (!search || release.season!==1) return null;
  const result=await search(`site:showtv.com.tr/dizi/fragman/ "${title}" "${release.episode}. Bölüm Fragmanı"`);
  for (const entry of (result.organic || []).slice(0,3)) {
    const url=officialUrl(entry.link);if(!url)continue;
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!response.ok)continue;
    const reader=response.body.getReader();let size=0;const chunks=[];
    try { while(true) { const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1500000) return null;chunks.push(Buffer.from(value)); } } finally { await reader.cancel(); }
    const parsed=parseOfficialTrailer(Buffer.concat(chunks).toString('utf8'),url,title,release);
    if(parsed)return parsed;
  }
  return null;
}
module.exports={parseOfficialTrailer,loadOfficialTrailer};
