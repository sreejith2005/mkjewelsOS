// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {useState} from 'react';
import type {FormTemplateDefinition} from '@jewelos/core';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),builder:vi.fn(),save:vi.fn()}));
vi.mock('@jewelos/api-client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
vi.mock('./FormRenderer',()=>({FormRenderer:({definition}:{definition:FormTemplateDefinition})=><div data-testid="native-preview">{definition.fields.map((field)=><span key={field.key}>{field.label}</span>)}</div>}));
vi.mock('./FormBuilder',()=>({FormBuilder:(props:{initialDefinition:FormTemplateDefinition;origin:unknown;onSaved:()=>Promise<void>})=>{mocks.builder(props);const [name,setName]=useState(props.initialDefinition.name);return <div data-testid="native-builder"><label>Native form name<input onChange={(event)=>setName(event.target.value)} value={name}/></label><button onClick={()=>{mocks.save(props.origin);void props.onSaved();}} type="button">Save Draft</button></div>;}}));
import {FormImporter} from './FormImporter';
const options={users:[],branches:[],departments:[],masters:[]};
const output=(findings:unknown[]=[])=>({schemaVersion:1,proposal:{schemaVersion:1,definition:{name:'Synthetic form',fields:[{key:'note',label:'Note',type:'text',sortOrder:0}],permissions:{roles:['staff']}},mappings:[{sourceId:'0:f0',fieldKeys:['note'],status:'converted',note:'Converted text'}],conditionMappings:[],findings}});
const mount=()=>render(<FormImporter dynamicOptions={options} onClose={vi.fn()} onSaved={vi.fn().mockResolvedValue(undefined)}/>);
const enterSource=(content='<input name="note">')=>fireEvent.change(screen.getByRole('textbox',{name:'Source code for Form.html'}),{target:{value:content}});
beforeEach(()=>{vi.clearAllMocks();mocks.invoke.mockResolvedValue({data:output(),error:null});});
afterEach(()=>cleanup());
describe('Forms AI import workflow',()=>{
 it('presents a source workspace with multiple file types, line numbers and inert highlighted text',()=>{
  const {container}=mount();enterSource('<input name="note" onchange="alert(1)"><script>alert(1)</script><iframe src="https://invalid.example"></iframe>');
  expect(container.querySelector('iframe')).toBeNull();expect(container.querySelector('script')).toBeNull();expect(screen.getByRole('button',{name:'Add Apps Script'})).toBeTruthy();expect(screen.getByRole('button',{name:'Add JavaScript'})).toBeTruthy();expect(container.querySelector('pre')).not.toBeNull();expect(mocks.invoke).not.toHaveBeenCalled();
 });
 it('blocks possible private records before invoking the server',()=>{
  mount();enterSource('<input name="email" value="synthetic@example.test">');expect(screen.getByText(/Possible private content detected/)).toBeTruthy();expect(screen.getByRole('button',{name:'Analyze & Build Form'})).toHaveProperty('disabled',true);expect(mocks.invoke).not.toHaveBeenCalled();
 });
 it('analyzes, reviews counts and hands an editable proposal to the native builder only on approval',async()=>{
  mount();enterSource();fireEvent.click(screen.getByRole('button',{name:'Analyze & Build Form'}));
  await screen.findByText('Native preview · Test mode');expect(mocks.invoke).toHaveBeenCalledWith('forms-import',expect.objectContaining({body:expect.objectContaining({schemaVersion:1,sources:[expect.objectContaining({language:'html'})]})}));expect(screen.getByText('source controls detected')).toBeTruthy();expect(mocks.save).not.toHaveBeenCalled();expect(mocks.builder).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Edit in Form Builder'}));expect(screen.getByRole('textbox',{name:'Native form name'})).toHaveProperty('value','Synthetic form');expect(mocks.builder).toHaveBeenCalledWith(expect.objectContaining({origin:{kind:'ai_import',import_method:'html'},initialDefinition:expect.objectContaining({fields:[expect.objectContaining({key:'note'})]})}));expect(screen.queryByRole('button',{name:/Publish/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));expect(mocks.save).toHaveBeenCalledWith({kind:'ai_import',import_method:'html'});
 });
 it('requires acknowledgement of unsupported findings before opening the editor',async()=>{
  mocks.invoke.mockResolvedValue({data:output([{kind:'unsupported',message:'The original backend save operation was not migrated.',sourceId:null,fieldKey:'note',sectionKey:null}]),error:null});mount();enterSource();fireEvent.click(screen.getByRole('button',{name:'Analyze & Build Form'}));
  await screen.findByText('The original backend save operation was not migrated.');expect(screen.getByRole('button',{name:'Edit in Form Builder'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('checkbox',{name:/I reviewed the condition mappings/}));expect(screen.getByRole('button',{name:'Edit in Form Builder'})).toHaveProperty('disabled',false);
 });
 it('preserves manual edits when navigating back to review and source',async()=>{
  mount();enterSource();fireEvent.click(screen.getByRole('button',{name:'Analyze & Build Form'}));await screen.findByText('Native preview · Test mode');fireEvent.click(screen.getByRole('button',{name:'Edit in Form Builder'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Native form name'}),{target:{value:'Unsaved edited name'}});fireEvent.click(screen.getByRole('button',{name:'Back to conversion review'}));fireEvent.click(screen.getByRole('button',{name:'Return to Form Editor'}));expect(screen.getByRole('textbox',{name:'Native form name'})).toHaveProperty('value','Unsaved edited name');expect(mocks.save).not.toHaveBeenCalled();
 });
 it('rejects invalid AI output without opening or saving any form',async()=>{
  mocks.invoke.mockResolvedValue({data:{schemaVersion:1,proposal:{definition:{fields:[{type:'script'}]}}},error:null});mount();enterSource();fireEvent.click(screen.getByRole('button',{name:'Analyze & Build Form'}));await screen.findByText(/supported versioned form schema/);expect(mocks.builder).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
 });
 it('sends a focused refinement with its exact unsaved base and target',async()=>{
  mount();enterSource();fireEvent.click(screen.getByRole('button',{name:'Analyze & Build Form'}));await screen.findByText('Native preview · Test mode');fireEvent.change(screen.getByRole('combobox',{name:'Part to correct'}),{target:{value:'field:note'}});fireEvent.change(screen.getByRole('textbox',{name:'Correction instructions'}),{target:{value:'Rename the note label'}});fireEvent.click(screen.getByRole('button',{name:'Correct selected part'}));await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledTimes(2));expect(mocks.invoke.mock.calls[1]?.[1]).toEqual(expect.objectContaining({body:expect.objectContaining({refinement:expect.objectContaining({target:{fieldKey:'note'},base:expect.objectContaining({schemaVersion:1})})})}));
 });
 it('closes the entire import after draft persistence and prevents a second new-family save while refresh is pending',async()=>{
  let resolveRefresh:()=>void=()=>{};const refresh=vi.fn(()=>new Promise<void>((resolve)=>{resolveRefresh=resolve;}));const close=vi.fn();render(<FormImporter dynamicOptions={options} onClose={close} onSaved={refresh}/>);
  enterSource();fireEvent.click(screen.getByRole('button',{name:'Analyze & Build Form'}));await screen.findByText('Native preview · Test mode');fireEvent.click(screen.getByRole('button',{name:'Edit in Form Builder'}));fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));
  await screen.findByText(/Draft saved. Returning to Forms Library/);expect(screen.queryByRole('button',{name:'Save Draft'})).toBeNull();expect(screen.queryByRole('button',{name:'Return to Form Editor'})).toBeNull();expect(mocks.save).toHaveBeenCalledTimes(1);expect(close).not.toHaveBeenCalled();resolveRefresh();await waitFor(()=>expect(close).toHaveBeenCalledTimes(1));
 });
});
