function readableTitle(value) {
  const text=typeof value==='string' ? value.trim() : '';
  return Boolean(text && /\p{Script=Latin}/u.test(text) && !/[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}\p{M}]/u.test(text));
}
function createMediaTitleResolver(tmdbRequest) {
  const cache=new Map();
  return async item => {
    if(readableTitle(item.title))return item.title.trim();
    const type=item.type==='TV'?'tv':'movie';const key=`${type}:${item.tmdbId}`;
    let cached=cache.get(key);
    if(!cached || cached.expires<Date.now()) {
      const pending=tmdbRequest(`/${type}/${item.tmdbId}`,{language:'en-US'})
        .then(data=>{const title=data.title || data.name;return readableTitle(title)?title.trim():null;})
        .catch(()=>null);
      if(cache.size>=500)cache.clear();
      cached={value:pending,expires:Date.now()+60*60000};cache.set(key,cached);
      pending.then(value=>{if(!value && cache.get(key)===cached)cache.delete(key);});
    }
    return cached.value;
  };
}
module.exports={readableTitle,createMediaTitleResolver};
