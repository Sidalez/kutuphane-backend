const {test}=require('node:test');const assert=require('node:assert/strict');
const {matchProvider,requestedProvider}=require('./mediaProviders');
const providers=[{provider_id:2,provider_name:'Apple TV Store'},{provider_id:1904,provider_name:'TV+'},{provider_id:1899,provider_name:'HBO Max'},{provider_id:337,provider_name:'Disney Plus'},{provider_id:119,provider_name:'Amazon Prime Video'},{provider_id:8,provider_name:'Netflix'}];
test('Platform aliases select the actual service without confusing store or TV+',()=>{
 assert.equal(matchProvider('Disney+',providers),337);
 assert.equal(matchProvider('BluTV',providers),1899);
 assert.equal(matchProvider('TV+',providers),1904);
 assert.equal(matchProvider('Apple TV+',providers),null);
 assert.equal(matchProvider('Prime Video',providers),119);
});
test('A named platform in the request is respected and explicit choice wins',()=>{
 assert.equal(requestedProvider({description:'Netflix üzerinden mini dizi istiyorum'}),'Netflix');
 assert.equal(requestedProvider({description:'Disney+ dizileri'}),'Disney+');
 assert.equal(requestedProvider({provider:'MUBI',description:'Netflix filmi'}),'MUBI');
 assert.equal(requestedProvider({description:'Sürükleyici bir film'}),'');
});
