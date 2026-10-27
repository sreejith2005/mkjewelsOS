import Anthropic from '@anthropic-ai/sdk';
import {FORM_IMPORT_OUTPUT_SCHEMA} from '../../../packages/core/src/forms/importContract.ts';
import {FORMS_IMPORT_SYSTEM,type FormsImportModel} from './handler.ts';
export function buildFormsImportModelParams(model:string,input:string):Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {model,max_tokens:16000,betas:['server-side-fallback-2026-07-01'],fallbacks:'default',thinking:{type:'adaptive'},output_config:{effort:'medium',format:{type:'json_schema',schema:FORM_IMPORT_OUTPUT_SCHEMA}},system:[{type:'text',text:FORMS_IMPORT_SYSTEM,cache_control:{type:'ephemeral'}}],messages:[{role:'user',content:input}],stream:false};
}
export function formsImportModel(apiKey:string,model:string):FormsImportModel {
  // No automatic request retry: a browser request consumes one quota slot.
  const client=new Anthropic({apiKey,maxRetries:0});
  return {async complete(input){
    try{const result=await client.beta.messages.create(buildFormsImportModelParams(model,input),{timeout:100_000});return {text:result.content.flatMap((block)=>block.type==='text'?[block.text]:[]).join(''),stopReason:result.stop_reason??''};}
    catch(error){if(error instanceof Anthropic.APIConnectionTimeoutError)throw new Error('timeout');throw new Error('provider');}
  }};
}
