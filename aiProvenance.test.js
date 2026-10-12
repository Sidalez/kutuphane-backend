const {test}=require('node:test');const assert=require('node:assert/strict');
const {withProcessing,recordModel,processingInfo}=require('./aiProvenance');
test('Concurrent requests keep their actual model information separate',async()=>{
 let resume;const gate=new Promise(resolve=>{resume=resolve});
 const first=withProcessing(async()=>{recordModel('Groq','openai/gpt-oss-20b');await gate;return processingInfo('books')});
 const second=await withProcessing(async()=>{recordModel('OpenRouter','actual/resolved-model',true);resume();return processingInfo('media')});
 assert.deepEqual((await first).models,[{provider:'Groq',model:'openai/gpt-oss-20b',cached:false}]);
 assert.deepEqual(second.models,[{provider:'OpenRouter',model:'actual/resolved-model',cached:true}]);
 assert.equal(processingInfo('web').usedAI,false);
});
test('A request without a successful AI response does not claim a model',()=>{
 withProcessing(()=>{assert.deepEqual(processingInfo('isbn_web_research'),{usedAI:false,models:[],source:'isbn_web_research'});});
});
