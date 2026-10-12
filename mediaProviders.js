function providerAliases(value) {
  const key=String(value||'').trim().toLocaleLowerCase('tr-TR');
  const groups=[['netflix'],['amazon prime video','prime video','prime','amazon prime'],['disney+','disney plus','disney'],['apple tv+','apple tv plus'],['tv+','turkcell tv+'],['hbo max','max','blutv','blu tv'],['mubi'],['gain'],['tabii'],['exxen'],['puhutv']];
  return groups.find(group=>group.includes(key))||[key];
}
function matchProvider(value,providers) {
  const aliases=providerAliases(value);
  return providers.find(provider=>aliases.includes(String(provider.provider_name).trim().toLocaleLowerCase('tr-TR')))?.provider_id||null;
}
function requestedProvider(payload) {
  if(String(payload.provider||'').trim()) return String(payload.provider).trim();
  const text=String(payload.description||'').toLocaleLowerCase('tr-TR');
  for(const name of ['Amazon Prime Video','Prime Video','Disney+','Disney Plus','Apple TV+','Netflix','BluTV','HBO Max','MUBI','Gain','tabii','Exxen','puhutv','TV+']) {
    const escaped=name.toLocaleLowerCase('tr-TR').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if(new RegExp(`(^|[^a-zçğıöşü])${escaped}(?=$|[^a-zçğıöşü])`,'u').test(text)) return name;
  }
  return '';
}
module.exports={matchProvider,requestedProvider};
