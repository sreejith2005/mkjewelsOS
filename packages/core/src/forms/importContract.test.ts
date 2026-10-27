import {describe,it,expect} from 'vitest';
import {analyzeFormImportSources,detectFormImportPrivacy,readFormImportSources,type FormImportSource} from './importSource';
import {assertFormImportPrivacy,buildFormImportResult,readFormImportProposal,readFormImportRequest,type FormImportProposal} from './importContract';
const source=(content:string):FormImportSource=>({name:'Synthetic.html',language:'html',content});
const definition={name:'Synthetic follow-up',sections:[{key:'main',title:'Main'}],fields:[{key:'purchase',label:'Purchased?',type:'select' as const,sortOrder:0,sectionKey:'main',options:[{value:'yes',label:'Yes'},{value:'no',label:'No'}]},{key:'reason',label:'Reason',type:'text' as const,sortOrder:1,sectionKey:'main',rule:{kind:'predicate' as const,fieldKey:'purchase',operator:'equals' as const,value:'no'}}],permissions:{roles:['staff' as const]}};
const sources=[source('<select name="purchase"><option value="yes">Yes</option><option value="no">No</option></select><input name="reason"><script>if (purchase === "no") showReason()</script>')];
const analysis=analyzeFormImportSources(sources);
const proposal=():FormImportProposal=>({schemaVersion:1,definition,mappings:analysis.fields.map((field,index)=>({sourceId:field.id,fieldKeys:[definition.fields[index]!.key],status:'converted',note:'Converted source control'})),conditionMappings:analysis.conditions.map((condition)=>({sourceId:condition.id,fieldKeys:['reason'],status:'converted',note:'Preserved condition'})),findings:[]});
describe('static form source analysis',()=>{
 it('extracts controls, options, required state, headings and source lines without a DOM',()=>{
  const analyzed=analyzeFormImportSources([source('<h2>Details</h2>\n<label for="client">Client</label><input id="client" required placeholder="Name">\n<select name="choice"><option value="a">Alpha</option></select>')]);
  expect(analyzed.fields).toHaveLength(3);expect(analyzed.fields[1]).toMatchObject({label:'Client',required:true,line:2});expect(analyzed.fields[2]?.options).toEqual([{value:'a',label:'Alpha'}]);
 });
 it('groups radio and checkbox controls by source name',()=>{
  const analyzed=analyzeFormImportSources([source('<label><input type="radio" name="purchase" value="yes">Yes</label><label><input type="radio" name="purchase" value="no">No</label>')]);
  expect(analyzed.fields).toHaveLength(1);expect(analyzed.fields[0]?.options).toEqual([{value:'yes',label:'Yes'},{value:'no',label:'No'}]);
 });
 it('detects nested conditions, hidden containers, section paths and Apps Script dependencies',()=>{
  const analyzed=analyzeFormImportSources([source('<section id="one"><input name="a"></section><section id="two" hidden><input name="b"></section><script>if(a){if(b) nextSection();} google.script.run.withSuccessHandler(done).saveForm(data);</script>')]);
  expect(analyzed.sections).toHaveLength(2);expect(analyzed.conditions.length).toBeGreaterThanOrEqual(3);expect(analyzed.paths).toHaveLength(1);expect(analyzed.fields[1]?.hidden).toBe(true);expect(analyzed.integrations[0]?.description).toContain('saveForm');
 });
 it('keeps scripts, handlers, URLs and prompt injection inert',()=>{
  const analyzed=analyzeFormImportSources([source('<input name="x" onclick="globalThis.IMPORT_EXECUTED=true"><script>globalThis.IMPORT_EXECUTED=true; document.write("<input name=x>")</script><iframe src="https://invalid.example"></iframe>')]);
  expect(analyzed.fields).toHaveLength(1);expect(analyzed.warnings.length).toBeGreaterThan(0);expect('IMPORT_EXECUTED' in globalThis).toBe(false);
 });
 it('does not overlook visibility defined in an accompanying CSS file or class manipulation',()=>{
  const analyzed=analyzeFormImportSources([source('<input name="note"><script>element.classList.toggle("concealed")</script>'),{name:'Style.css',language:'css',content:'.concealed { display:none }'}]);expect(analyzed.conditions).toHaveLength(2);expect(analyzed.conditions[1]?.file).toBe('Style.css');
 });
 it('blocks credentials, personal records and prefilled fields before provider use',()=>{
  for(const content of ['const password="synthetic-only"','const email="synthetic@example.test"','<input value="Synthetic Customer">','<textarea>Synthetic customer record</textarea>','const customerName = "Synthetic Person"']) expect(detectFormImportPrivacy(content).length).toBeGreaterThan(0);
  const request=readFormImportRequest({schemaVersion:1,requestKey:'11111111-1111-4111-8111-111111111111',sources:[source('<input value="Synthetic Person">')],instructions:''});
  expect(()=>assertFormImportPrivacy(request,analyzeFormImportSources(request.sources))).toThrow('No source was sent');
 });
 it('rejects unsupported file contracts and bounds source size',()=>{
  expect(()=>readFormImportSources([{name:'bad.exe',language:'binary',content:'x'}])).toThrow();expect(()=>readFormImportSources([source('x'.repeat(120001))])).toThrow();
 });
});
describe('validated native conversion',()=>{
 it('validates conditional fields and derives counts from verified mappings',()=>{
  const validated=readFormImportProposal(proposal(),analysis);const result=buildFormImportResult(validated,analysis);
  expect(result.report).toMatchObject({detectedFields:2,convertedFields:2,conditionalRulesDetected:1,convertedConditions:1});expect(validated.definition.fields[1]?.rule).toMatchObject({fieldKey:'purchase',value:'no'});
 });
 it('retains nested AND/OR conditions in a multi-section native definition',()=>{
  const p=proposal();const field={...definition.fields[1]!,rule:{kind:'all' as const,rules:[{kind:'predicate' as const,fieldKey:'purchase',operator:'equals' as const,value:'no'},{kind:'any' as const,rules:[{kind:'predicate' as const,fieldKey:'purchase',operator:'equals' as const,value:'no'},{kind:'predicate' as const,fieldKey:'purchase',operator:'not_empty' as const}]}]}};
  const validated=readFormImportProposal({...p,definition:{...definition,sections:[...definition.sections,{key:'later',title:'Later',next:'__submit__'}],fields:[definition.fields[0],{...field,sectionKey:'later'}]}},analysis);
  expect(validated.definition.fields[1]?.rule?.kind).toBe('all');expect(validated.definition.sections).toHaveLength(2);
 });
 it('rejects unknown properties, bad types, dangling rules and fabricated mappings',()=>{
  expect(()=>readFormImportProposal({...proposal(),sql:'drop table'},analysis)).toThrow();
  expect(()=>readFormImportProposal({...proposal(),definition:{...definition,fields:[{...definition.fields[0],type:'javascript'}]}},analysis)).toThrow();
  expect(()=>readFormImportProposal({...proposal(),mappings:[]},analysis)).toThrow();
  expect(()=>readFormImportProposal({...proposal(),definition:{...definition,fields:[definition.fields[0],{...definition.fields[1],rule:{kind:'predicate',fieldKey:'missing',operator:'equals',value:'x'}}]}},analysis)).toThrow();
 });
 it('never silently removes an incomplete or unsupported condition',()=>{
  expect(()=>readFormImportProposal({...proposal(),definition:{...definition,fields:[definition.fields[0],{...definition.fields[1],rule:{kind:'predicate',fieldKey:'purchase',operator:'equals'}}]}},analysis)).toThrow('incomplete');
  expect(()=>readFormImportProposal({...proposal(),definition:{...definition,fields:[definition.fields[0],{...definition.fields[1],rule:undefined}]}},analysis)).toThrow('without a native rule');
 });
 it('requires review when a conditional or backend behavior is unsupported',()=>{
  const p={...proposal(),conditionMappings:proposal().conditionMappings.map((item)=>({...item,status:'review' as const,fieldKeys:[],note:'Ambiguous handler; review before using'}))};
  const validated=readFormImportProposal(p,analysis);expect(buildFormImportResult(validated,analysis).report.requiresAcknowledgement).toBe(true);
 });
 it('refuses to convert an originally hidden question into an unconditional question',()=>{
  const hiddenAnalysis={...analysis,fields:analysis.fields.map((field,index)=>({...field,hidden:index===0}))};
  expect(()=>readFormImportProposal(proposal(),hiddenAnalysis)).toThrow('originally hidden');
 });
 it('accepts a focused unsaved refinement and refuses all unrelated changes',()=>{
  const base=readFormImportProposal(proposal(),analysis);const refinement={target:{fieldKey:'reason'},base};
  const changed={...base,definition:{...base.definition,fields:base.definition.fields.map((field)=>field.key==='reason'?{...field,label:'Reason for not purchasing'}:field)}};
  expect(readFormImportProposal(changed,analysis,refinement).definition.fields[1]?.label).toContain('not purchasing');
  expect(()=>readFormImportProposal({...changed,definition:{...changed.definition,name:'Unexpected rename'}},analysis,refinement)).toThrow('outside');
  expect(()=>readFormImportProposal({...changed,definition:{...changed.definition,fields:changed.definition.fields.map((field)=>({...field,label:'Changed everything'}))}},analysis,refinement)).toThrow('another');
 });
});
