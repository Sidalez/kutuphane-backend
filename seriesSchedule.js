function nextUnwatchedSeason(seasons,watched){
 const keys=new Set(watched.filter(e=>Number.isInteger(e.seasonNumber)&&Number.isInteger(e.episodeNumber)).map(e=>`${e.seasonNumber}:${e.episodeNumber}`));
 return [...seasons].filter(s=>s.season_number>0&&s.episode_count>0).sort((a,b)=>a.season_number-b.season_number).find(s=>{for(let n=1;n<=s.episode_count;n++)if(!keys.has(`${s.season_number}:${n}`))return true;return false;})?.season_number;
}
module.exports={nextUnwatchedSeason};
