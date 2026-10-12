const {AsyncLocalStorage}=require('node:async_hooks');
const context=new AsyncLocalStorage();
function withProcessing(action){return context.run({models:[]},action);}
function recordModel(provider,model,cached=false){
 const state=context.getStore();
 if(!state)return;
 if(!state.models.some(item=>item.provider===provider&&item.model===model))state.models.push({provider,model,cached});
}
function processingInfo(source){
 const models=context.getStore()?.models||[];
 return {usedAI:models.length>0,models,source};
}
module.exports={withProcessing,recordModel,processingInfo};
