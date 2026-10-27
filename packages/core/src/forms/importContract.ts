import { normalizeFormDefinition, validateFormDefinition } from './definition.ts';
import { FORM_RULE_OPERATORS, formRuleHasIncompletePredicate } from './rules.ts';
import { FORM_DRAFT_FIELD_TYPES, type FormTemplateDefinition } from './types.ts';
import { analyzeFormImportSources, detectFormImportPrivacy, readFormImportSources, type FormImportSource, type FormSourceAnalysis } from './importSource.ts';

export type ImportMapping = Readonly<{ sourceId:string; fieldKeys:readonly string[]; status:'converted'|'review'|'unsupported'; note:string }>;
export type ImportFinding = Readonly<{ kind:'warning'|'unsupported'|'integration'|'assumption'; message:string; sourceId:string|null; fieldKey:string|null; sectionKey:string|null }>;
export type FormImportProposal = Readonly<{ schemaVersion:1; definition:FormTemplateDefinition; mappings:readonly ImportMapping[]; conditionMappings:readonly ImportMapping[]; findings:readonly ImportFinding[] }>;
export type ImportRefinement = Readonly<{ target:Readonly<{ fieldKey:string }>|Readonly<{ sectionKey:string }>; base:FormImportProposal }>;
export type FormImportRequest = Readonly<{ schemaVersion:1; requestKey:string; sources:readonly FormImportSource[]; instructions:string; refinement?:ImportRefinement }>;
export type FormImportResult = Readonly<{ schemaVersion:1; proposal:FormImportProposal; analysis:FormSourceAnalysis; report:Readonly<{ detectedFields:number; convertedFields:number; conditionalRulesDetected:number; convertedConditions:number; sectionPathsDetected:number; unsupportedBehaviors:number; externalIntegrations:number; warnings:number; requiresAcknowledgement:boolean }> }>;

type Schema = Readonly<{ type?:string; enum?:readonly unknown[]; const?:unknown; properties?:Readonly<Record<string,Schema>>; required?:readonly string[]; additionalProperties?:boolean; items?:Schema; minItems?:number; maxItems?:number; minLength?:number; maxLength?:number; anyOf?:readonly Schema[] }>;
const text = (maxLength=500):Schema => ({ type:'string',maxLength });
const object = (properties:Readonly<Record<string,Schema>>,required:readonly string[]=Object.keys(properties)):Schema => ({type:'object',properties,required,additionalProperties:false});
const array = (items:Schema,maxItems=100):Schema => ({type:'array',items,maxItems});
const scalar:Schema = {anyOf:[text(2000),{type:'number'},{type:'boolean'},array(text(500))]};
const predicate:Schema = object({kind:{const:'predicate'},fieldKey:text(60),operator:{enum:FORM_RULE_OPERATORS},value:scalar},['kind','fieldKey','operator']);
const ruleSchema = (depth:number):Schema => depth <= 1 ? predicate : {anyOf:[predicate,object({kind:{enum:['all','any']},rules:{...array(ruleSchema(depth-1),20),minItems:1}})]};
const mappingSchema = object({sourceId:text(100),fieldKeys:array(text(60)),status:{enum:['converted','review','unsupported']},note:{...text(1000),minLength:1}});
const definitionSchema = object({
  name:{...text(150),minLength:1},description:text(2000),recordNameFieldKey:text(60),
  sections:array(object({key:text(60),title:text(150),description:text(2000),next:text(60)},['key','title'])),
  permissions:object({roles:{...array({enum:['super_admin','admin','manager','hr','crm','staff','doer','housekeeping']},8),minItems:1}}),
  fields:array(object({key:text(60),label:text(500),type:{enum:FORM_DRAFT_FIELD_TYPES},sortOrder:{type:'number'},sectionKey:text(60),required:{type:'boolean'},shown:{type:'boolean'},editable:{type:'boolean'},placeholder:text(500),helperText:text(1000),
    options:array(object({value:text(500),label:text(500)})),optionSource:object({kind:{const:'master'},masterType:text(100)}),
    branches:array(object({operator:{enum:['equals','not_equals','contains','not_empty']},value:scalar,targetSectionKey:text(60)},['operator','targetSectionKey'])),
    validation:object({minLength:{type:'number'},maxLength:{type:'number'},min:{type:'number'},max:{type:'number'}},[]),
    condition:object({fieldKey:text(60),operator:{enum:['equals','not_equals','contains','not_empty']},value:scalar},['fieldKey','operator']),rule:ruleSchema(3),
  },['key','label','type','sortOrder']))
},['name','fields']);
export const FORM_IMPORT_OUTPUT_SCHEMA = object({
  schemaVersion:{const:1},definition:definitionSchema,mappings:array(mappingSchema),conditionMappings:array(mappingSchema,300),
  findings:array(object({
    kind:{enum:['warning','unsupported','integration','assumption']},message:{...text(1000),minLength:1},
    sourceId:{anyOf:[text(100),{type:'null'}]},fieldKey:{anyOf:[text(60),{type:'null'}]},sectionKey:{anyOf:[text(60),{type:'null'}]},
  })),
});
function matches(value:unknown,schema:Schema):boolean {
  if (schema.anyOf) return schema.anyOf.some((part) => matches(value,part));
  if ('const' in schema && value!==schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (!schema.type) return true;
  if (schema.type==='null') return value===null;
  if (schema.type==='string') return typeof value==='string' && value.length >= (schema.minLength??0) && value.length <= (schema.maxLength??Infinity);
  if (schema.type==='number') return typeof value==='number' && Number.isFinite(value);
  if (schema.type==='boolean') return typeof value==='boolean';
  if (schema.type==='array') return Array.isArray(value) && value.length >= (schema.minItems??0) && value.length <= (schema.maxItems??Infinity) && value.every((entry:unknown) => !schema.items || matches(entry,schema.items));
  if (!value || typeof value!=='object' || Array.isArray(value)) return false;
  const record:Record<string,unknown> = Object.fromEntries(Object.entries(value));
  return (schema.required??[]).every((key) => key in record) && Object.entries(record).every(([key,item]) => schema.properties?.[key] ? (item===undefined && !(schema.required??[]).includes(key)) || matches(item,schema.properties[key]!) : schema.additionalProperties!==false);
}
const canonical = (value:unknown):string => JSON.stringify(value && typeof value==='object' ? Array.isArray(value) ? value.map((entry:unknown) => JSON.parse(canonical(entry)) as unknown) : Object.fromEntries(Object.entries(value).filter(([,entry]) => entry!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,JSON.parse(canonical(entry)) as unknown])) : value) ?? 'null';
function nativeDefinition(value:unknown):FormTemplateDefinition {
  if (!matches(value,definitionSchema)) throw new Error('The conversion returned an invalid native form definition.');
  // Every supported property was checked recursively against the native schema.
  const definition=value as FormTemplateDefinition;
  if (definition.fields.some((field) => formRuleHasIncompletePredicate(field.rule))) throw new Error('A conditional question has an incomplete answer comparison.');
  if (definition.fields.some((field)=>field.optionSource)) throw new Error('Choose an existing Dropdown Master in the native builder. The AI cannot verify or create a data-source integration.');
  if (definition.fields.some((field)=>field.condition && field.condition.operator!=='not_empty' && (field.condition.value===undefined || field.condition.value===''))) throw new Error('A conditional question has an incomplete answer comparison.');
  const issues=validateFormDefinition(definition);
  if (issues.length) throw new Error(issues[0]!.message);
  const normalized=normalizeFormDefinition(definition);
  for (const field of definition.fields) {
    const next=normalized.fields.find((item)=>item.key===field.key);
    if ((field.rule && !next?.rule) || (field.condition && !next?.condition) || ((field.branches?.length??0)!==(next?.branches?.length??0))) throw new Error('A conditional rule could not be preserved safely.');
  }
  return normalized;
}
export function readFormImportRequest(value:unknown):FormImportRequest {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid import request.');
  const record:Record<string,unknown>=Object.fromEntries(Object.entries(value));
  if (record.schemaVersion!==1 || typeof record.requestKey!=='string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(record.requestKey) || typeof record.instructions!=='string' || record.instructions.length>2000 || Object.keys(record).some((key)=>!['schemaVersion','requestKey','sources','instructions','refinement'].includes(key))) throw new Error('Invalid versioned import request.');
  const sources=readFormImportSources(record.sources);
  let refinement:ImportRefinement|undefined;
  if (record.refinement!==undefined) {
    if (!record.refinement || typeof record.refinement!=='object' || Array.isArray(record.refinement)) throw new Error('Invalid refinement target.');
    const ref:Record<string,unknown>=Object.fromEntries(Object.entries(record.refinement));
    if (Object.keys(ref).some((key)=>!['target','base'].includes(key)) || !ref.target || typeof ref.target!=='object' || Array.isArray(ref.target)) throw new Error('Invalid refinement target.');
    const target:Record<string,unknown>=Object.fromEntries(Object.entries(ref.target));
    if (Object.keys(target).length!==1 || !(typeof target.fieldKey==='string' || typeof target.sectionKey==='string')) throw new Error('Choose exactly one question or section to refine.');
    const base=readFormImportProposal(ref.base,analyzeFormImportSources(sources));
    if (typeof target.fieldKey==='string') {
      if (!base.definition.fields.some((field)=>field.key===target.fieldKey)) throw new Error('Unknown refinement question.');
      refinement={target:{fieldKey:target.fieldKey},base};
    } else if (typeof target.sectionKey==='string') {
      if (!base.definition.sections?.some((section)=>section.key===target.sectionKey)) throw new Error('Unknown refinement section.');
      refinement={target:{sectionKey:target.sectionKey},base};
    }
  }
  return {schemaVersion:1,requestKey:record.requestKey,sources,instructions:record.instructions,...(refinement?{refinement}:{})};
}
export function assertFormImportPrivacy(request:FormImportRequest,analysis:FormSourceAnalysis):void {
  if (analysis.privacy.length || detectFormImportPrivacy(request.instructions).length || (request.refinement && detectFormImportPrivacy(JSON.stringify(request.refinement.base)).length)) throw new Error('Possible credentials or identifiable records found. Remove all private values and use an empty form before analyzing. No source was sent to the AI provider.');
}
export function readFormImportProposal(value:unknown,analysis:FormSourceAnalysis,refinement?:ImportRefinement):FormImportProposal {
  if (!matches(value,FORM_IMPORT_OUTPUT_SCHEMA)) throw new Error('The AI conversion did not match the supported versioned form schema.');
  // Recursive schema validation above covers every property and rejects extras.
  const proposal=value as FormImportProposal;
  const definition=nativeDefinition(proposal.definition);
  const fields=new Map(definition.fields.map((field)=>[field.key,field]));
  if (!fields.size) throw new Error('No native questions were converted. Review the source and try again.');
  const checkMappings=(mappings:readonly ImportMapping[],ids:readonly string[],isCondition:boolean) => {
    if (mappings.length!==ids.length || new Set(mappings.map((item)=>item.sourceId)).size!==ids.length || mappings.some((item)=>!ids.includes(item.sourceId))) throw new Error('The conversion did not account for every source control or condition.');
    for (const mapping of mappings) {
      if (mapping.fieldKeys.some((key)=>!fields.has(key)) || (mapping.status==='converted' && !mapping.fieldKeys.length)) throw new Error('A conversion mapping refers to a missing question.');
      if (isCondition && mapping.status==='converted' && !mapping.fieldKeys.some((key)=>{const field=fields.get(key)!; return field.rule || field.condition || field.branches?.length || definition.sections?.some((section)=>section.key===field.sectionKey && section.next);})) throw new Error('A source condition was marked converted without a native rule.');
    }
  };
  checkMappings(proposal.mappings,analysis.fields.map((field)=>field.id),false);
  checkMappings(proposal.conditionMappings,analysis.conditions.map((condition)=>condition.id),true);
  for(const source of analysis.fields.filter((field)=>field.hidden)) {
    const mapping=proposal.mappings.find((item)=>item.sourceId===source.id)!;
    if(mapping.status==='converted' && mapping.fieldKeys.some((key)=>{const field=fields.get(key)!;return field.shown!==false && !field.rule && !field.condition;})) throw new Error('An originally hidden question became unconditional. Mark the mapping for review or preserve its condition.');
  }
  if (definition.fields.some((field)=>!proposal.mappings.some((mapping)=>mapping.fieldKeys.includes(field.key)))) throw new Error('The conversion invented a question without a source mapping.');
  const references=new Set([...analysis.fields,...analysis.conditions,...analysis.sections,...analysis.paths,...analysis.integrations,...analysis.warnings].map((ref)=>ref.id));
  if (proposal.findings.some((finding)=>(finding.sourceId!==null && !references.has(finding.sourceId)) || (finding.fieldKey!==null && !fields.has(finding.fieldKey)) || (finding.sectionKey!==null && !definition.sections?.some((section)=>section.key===finding.sectionKey)))) throw new Error('A conversion finding points to an unknown source or question.');
  if (refinement) assertFormImportRefinement(refinement,definition);
  return {...proposal,definition};
}
export function assertFormImportRefinement(refinement:ImportRefinement,next:FormTemplateDefinition):void {
  const base=refinement.base.definition;
  const {fields:oldFields,sections:oldSections,...oldMetadata}=base;
  const {fields:newFields,sections:newSections,...newMetadata}=next;
  if (canonical(oldMetadata)!==canonical(newMetadata) || canonical(oldFields.map((field)=>field.key))!==canonical(newFields.map((field)=>field.key))) throw new Error('The refinement changed the form or question identities outside its selected target.');
  const target=refinement.target;
  if ('fieldKey' in target) {
    if (canonical(oldSections)!==canonical(newSections) || oldFields.some((field,index)=>field.key!==target.fieldKey && canonical(field)!==canonical(newFields[index]))) throw new Error('The refinement changed another question or section.');
    const old=oldFields.find((field)=>field.key===target.fieldKey)!; const changed=newFields.find((field)=>field.key===target.fieldKey)!;
    if (old.sortOrder!==changed.sortOrder || old.sectionKey!==changed.sectionKey) throw new Error('A focused question refinement cannot reorder or move questions.');
  } else {
    if (canonical(oldSections?.map((section)=>section.key))!==canonical(newSections?.map((section)=>section.key)) || oldSections?.some((section,index)=>section.key!==target.sectionKey && canonical(section)!==canonical(newSections?.[index])) || oldFields.some((field,index)=>field.sectionKey!==target.sectionKey && canonical(field)!==canonical(newFields[index]))) throw new Error('The refinement changed a question or section outside the selected section.');
    if (oldFields.some((field,index)=>field.sectionKey!==newFields[index]?.sectionKey || field.sortOrder!==newFields[index]?.sortOrder)) throw new Error('A focused section refinement cannot move questions between sections.');
  }
}
export function buildFormImportResult(proposal:FormImportProposal,analysis:FormSourceAnalysis):FormImportResult {
  const unsupported=proposal.mappings.filter((mapping)=>mapping.status!=='converted').length+proposal.conditionMappings.filter((mapping)=>mapping.status!=='converted').length+analysis.warnings.length+proposal.findings.filter((finding)=>finding.kind==='unsupported').length;
  return {schemaVersion:1,proposal,analysis,report:{detectedFields:analysis.fields.length,convertedFields:proposal.mappings.filter((mapping)=>mapping.status==='converted').length,conditionalRulesDetected:analysis.conditions.length,convertedConditions:proposal.conditionMappings.filter((mapping)=>mapping.status==='converted').length,sectionPathsDetected:analysis.paths.length,unsupportedBehaviors:unsupported,externalIntegrations:analysis.integrations.length+proposal.findings.filter((finding)=>finding.kind==='integration' && !finding.sourceId).length,warnings:proposal.findings.filter((finding)=>finding.kind==='warning' || finding.kind==='assumption').length,requiresAcknowledgement:unsupported>0 || analysis.integrations.length>0 || analysis.conditions.length>0 || proposal.findings.length>0 || analysis.paths.length>0}};
}
