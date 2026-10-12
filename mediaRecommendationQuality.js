function qualityScore(rating,votes) {
  const v=Math.max(0,Number(votes)||0),r=Math.min(10,Math.max(0,Number(rating)||0));
  return (v*r+500*6.5)/(v+500);
}
function reliableCandidate(item,type) {
  return item.adult!==true && Number(item.vote_count)>=(type==='TV'?100:300) && Number(item.vote_average)>=6 && Boolean(item.poster_path);
}
function balancedSelection(items,type='ALL',limit=12) {
  if(type!=='ALL')return items.filter(i=>i.type===type).slice(0,limit);
  const movies=items.filter(i=>i.type==='MOVIE'),tv=items.filter(i=>i.type==='TV');
  const selected=[];
  while(selected.length<limit && (movies.length || tv.length)) {
    if(movies.length)selected.push(movies.shift());
    if(selected.length<limit && tv.length)selected.push(tv.shift());
  }
  return selected;
}
module.exports={qualityScore,reliableCandidate,balancedSelection};
