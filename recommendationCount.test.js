const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('server.js','utf8').split('\nconst server = http.createServer')[0];
function setup() {
  const context={require:id=>id==='./bookEditionResearch'?{createIsbnResearch:()=>async()=>({found:false}),createEditionResearch:()=>async book=>book.title.startsWith('Valid')?{isbn:'9786053756040',editionSource:'https://source.test/'+book.title}:{}}:require(id),__dirname:process.cwd(),process,console:{log(){},warn(){},error(){}},fetch,AbortSignal,Map,URL};
  vm.createContext(context);vm.runInContext(source,context);vm.runInContext('serperRequest=async()=>({organic:[]});getFirstSerperImageUrl=async()=>({});',context);return context;
}
(async()=>{
  const c=setup();vm.runInContext(`let calls=0;callGemini=async()=>JSON.stringify({recommendations:++calls===1?[{title:'Valid One',author:'Author'},{title:'Invalid',author:'Author'}]:[{title:'Valid One',author:'Author'},{title:'Valid Two',author:'Author'}]});`,c);
  const result=await vm.runInContext('recommendBooks({goal:"choose_new_book"})',c);assert.equal(result.books.length,2);assert.equal(vm.runInContext('calls',c),2);assert.ok(!result.text.includes('Invalid'));
  const failure=setup();vm.runInContext('callGemini=async()=>JSON.stringify({recommendations:[{title:"Invalid",author:"Author"}]});',failure);await assert.rejects(vm.runInContext('recommendBooks({goal:"choose_new_book"})',failure),error=>error.status===502);
  const shelf=setup();vm.runInContext('callGemini=async()=>JSON.stringify({recommendations:[{candidateId:0}]});',shelf);const books=[{title:'One',author:'Author',status:'OKUNACAK'},{title:'Two',author:'Author',status:'OKUNACAK'}];shelf.payload={goal:'choose_library_book',candidateBooks:books};assert.equal((await vm.runInContext('recommendBooks(payload)',shelf)).books.length,2);shelf.payload.candidateBooks=books.slice(0,1);assert.equal((await vm.runInContext('recommendBooks(payload)',shelf)).books.length,1);
  console.log('Two-book minimum, retry, deduplication, verification failure and single-book shelf checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
