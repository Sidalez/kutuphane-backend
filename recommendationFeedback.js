function cleanFeedback(value) {
 return (Array.isArray(value)?value:[]).slice(-200).filter(item=>item&&['BOOK','TV','MOVIE'].includes(item.kind)&&['liked','dismissed','consumed'].includes(item.action)&&typeof item.title==='string').map(item=>({kind:item.kind,action:item.action,title:item.title.slice(0,300),author:String(item.author||'').slice(0,200),isbn:String(item.isbn||'').replace(/[^0-9X]/g,'').slice(0,13),tmdbId:Number(item.tmdbId)||undefined}));
}
const text=value=>String(value||'').trim().toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
function excludesBook(book,feedback) {
 return feedback.some(item=>item.kind==='BOOK'&&item.action!=='liked'&&((item.isbn&&item.isbn===book.isbn)||(text(item.title)===text(book.title)&&text(item.author)===text(book.author))));
}
module.exports={cleanFeedback,excludesBook};
