/** Static, bounded source inspection. No DOM, evaluator, URL fetch or script execution. */
export const FORM_IMPORT_LIMITS = { files: 8, fileBytes: 120_000, totalBytes: 220_000, bodyBytes: 500_000, fields: 100, nodes: 8_000 } as const;
export type FormImportSource = Readonly<{ name: string; language: 'html' | 'javascript' | 'apps_script' | 'css'; content: string }>;
export type ImportReference = Readonly<{ id: string; file: string; line: number; description: string }>;
export type ImportSourceField = ImportReference & Readonly<{ tag: string; sourceName: string; inputType: string; label: string; required: boolean; hidden: boolean; options: readonly Readonly<{ value: string; label: string }>[]; attributes: Readonly<Record<string, string>> }>;
export type FormSourceAnalysis = Readonly<{ fields: readonly ImportSourceField[]; sections: readonly ImportReference[]; conditions: readonly ImportReference[]; paths: readonly ImportReference[]; integrations: readonly ImportReference[]; warnings: readonly ImportReference[]; privacy: readonly ImportReference[] }>;
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const languages: ReadonlySet<string> = new Set(['html','javascript','apps_script','css']);
export function readFormImportSources(value: unknown): readonly FormImportSource[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > FORM_IMPORT_LIMITS.files) throw new Error('Provide between one and eight source files.');
  let total = 0;
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('name' in entry) || !('language' in entry) || !('content' in entry) || Object.keys(entry).some((key) => !['name','language','content'].includes(key))) throw new Error('Invalid source file.');
    const { name, language, content } = entry;
    if (typeof name !== 'string' || !/^[\w .()-]{1,100}$/.test(name) || typeof language !== 'string' || !languages.has(language) || typeof content !== 'string' || !content.trim() || bytes(content) > FORM_IMPORT_LIMITS.fileBytes || content.split('\n').length>5000) throw new Error('Use a source filename and a nonempty HTML, JavaScript, Apps Script or CSS file under 120 KB and 5,000 lines.');
    total += bytes(content);
    if (total > FORM_IMPORT_LIMITS.totalBytes) throw new Error('Source files together must be under 220 KB.');
    // The language was checked against the complete four-member enum above.
    return { name, language: language as FormImportSource['language'], content };
  });
}
const entities: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (text: string) => text.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (whole: string, key: string) => {
  if (key[0] !== '#') return entities[key.toLowerCase()] ?? whole;
  const number = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
  return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
});
const plain = (text: string) => decode(text.replace(/<[^>]{0,2000}>/g,' ')).replace(/\s+/g,' ').trim().slice(0,500);
function attributes(text: string): Record<string,string> {
  const result: Record<string,string> = {};
  for (const match of text.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const key = match[1]!.toLowerCase();
    if (!['__proto__','constructor','prototype'].includes(key)) result[key] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}
/** Findings never echo the matched private value. Both browser and server use this. */
export function detectFormImportPrivacy(text: string, file = 'Instructions'): readonly ImportReference[] {
  const findings: ImportReference[] = [];
  const patterns: readonly [RegExp,string][] = [
    [/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{12,}|sb_(?:secret|publishable)_[\w-]{12,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|AIza[\w-]{20,}|AKIA[A-Z0-9]{16})\b/g,'Possible credential or access token'],
    [/\b(?:api[_-]?key|secret|password|service[_-]?role|access[_-]?token|database[_-]?url)\b\s*[=:]\s*["'`][^"'`\n]{4,}["'`]/gi,'Possible embedded credential'],
    [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g,'Private key'],
    [/\bBearer\s+[A-Za-z0-9._~-]{16,}/gi,'Possible authorization credential'],
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'Possible personal email address'],
    [/(?:\+\d{1,3}[- .]?)?(?:\d[- .]?){10,13}\b/g,'Possible personal phone or identifier'],
    [/\b(?:customer[_-]?name|client[_-]?name|phone|mobile|email|address|customerName|clientName)\b["']?\s*[:=]\s*["'`][^"'`\n]{2,}["'`]/gi,'Possible identifiable record'],
    [/<input\b(?=[^>]{0,2000}\btype\s*=\s*["']?(?:password|hidden))(?=[^>]{0,2000}\bvalue\s*=\s*["'][^"']+)[^>]*>/gi,'Prefilled hidden or password control'],
    [/<input\b(?![^>]{0,2000}\btype\s*=\s*["']?(?:radio|checkbox|button|submit|reset))(?=[^>]{0,2000}\bvalue\s*=\s*["'][^"']+)[^>]*>/gi,'Prefilled input may contain a live record'],
    [/<textarea\b[^>]*>\s*[^<\s][\s\S]*?<\/textarea>/gi,'Prefilled text area may contain a live record'],
  ];
  for (const [pattern,description] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0,match.index).split('\n').length;
      if (!findings.some((item) => item.line === line && item.description === description)) findings.push({ id: `privacy:${findings.length}`, file, line, description });
      if (findings.length >= 30) return findings;
    }
  }
  return findings;
}
export function analyzeFormImportSources(sources: readonly FormImportSource[]): FormSourceAnalysis {
  readFormImportSources(sources);
  const fields: ImportSourceField[] = [], sections: ImportReference[] = [], conditions: ImportReference[] = [], paths: ImportReference[] = [], integrations: ImportReference[] = [], warnings: ImportReference[] = [], privacy: ImportReference[] = [];
  sources.forEach((source,fileIndex) => {
    privacy.push(...detectFormImportPrivacy(source.content,source.name));
    const reference = (position: number, description: string, category: string, index: number): ImportReference => ({ id: `${fileIndex}:${category}${index}`, file: source.name, line: source.content.slice(0,position).split('\n').length, description });
    const scan = (pattern: RegExp, list: ImportReference[], category: string, describe: (match: RegExpMatchArray) => string) => {
      for (const match of source.content.matchAll(pattern)) {
        if (list.length >= 300) throw new Error('Too many code references; split this source into a smaller form.');
        list.push(reference(match.index,describe(match),category,list.length));
      }
    };
    if(source.language==='css')scan(/display\s*:\s*none|visibility\s*:\s*hidden|:(?:checked|has|valid|invalid)\b/gi,conditions,'c',()=> 'CSS visibility behavior needs a verified native condition or explicit review');
    if (source.language !== 'css') {
      scan(/\bif\s*\(|\bswitch\s*\(|\?\s*[^\s:][^\n;]{0,100}:|\bon(?:change|click|input)\s*=|\.addEventListener\s*\(|\.(?:hidden|display|visibility)\s*=|\b(?:hidden|data-condition)\b|display\s*:\s*none/gi,conditions,'c',() => 'Conditional/event/hidden behavior requires a verified native mapping');
      scan(/\.classList\s*\.\s*(?:toggle|add|remove)\s*\(|\.(?:show|hide|toggle)\s*\(/g,conditions,'c',()=> 'Script-controlled visibility or classes require a verified native condition or review');
      scan(/\b(?:goToSection|nextSection|showSection|navigateTo)\s*\(|\bdata-next\s*=/gi,paths,'p',() => 'Source section navigation');
      scan(/google\s*\.\s*script\s*\.\s*run\b[\s\S]{0,400}?(?=;|\n|<\/script|$)/g,integrations,'i',(match) => {
        const functions = [...match[0].matchAll(/\.\s*([A-Za-z_$][\w$]*)\s*\(/g)].map((item) => item[1]!).filter((name) => !['withSuccessHandler','withFailureHandler','withUserObject'].includes(name));
        return `Google Apps Script backend${functions.length ? `: ${functions.join(', ')}` : ''}. Its backend operations were not migrated.`;
      });
      scan(/\b(?:fetch|XMLHttpRequest|SpreadsheetApp|UrlFetchApp|FirebaseApp|supabase)\b|<\?[^>]*\?>|<form\b[^>]*\baction\s*=/gi,integrations,'i',() => 'External data, template or submission dependency was not migrated; map data to an existing Dropdown Master or request an authorized integration');
      scan(/\b(?:eval|Function)\s*\(|document\s*\.\s*write\s*\(|javascript\s*:|<iframe\b|<object\b|<embed\b/gi,warnings,'w',() => 'Executable or embedded source is inert and cannot be migrated as code');
      scan(/\b(?:setCustomValidity|checkValidity|validate[A-Z]\w*|withSuccessHandler|withFailureHandler)\s*\(/g,warnings,'w',() => 'Custom validation or asynchronous handler needs review');
      scan(/\b(?:createElement|insertAdjacentHTML)\s*\(|\.innerHTML\s*=/g,warnings,'w',() => 'Dynamically generated controls need manual review; source scripts never run');
      scan(/\bpattern\s*=|\b(?:checked|selected)\s*(?:=|(?=[\s>]))/gi,warnings,'w',() => 'Source regular-expression validation or a default answer needs review; it has no equivalent native initial-answer contract');
      scan(/<canvas\b|\bcontenteditable\s*=/gi,warnings,'w',() => 'A custom canvas or editable control needs manual reconstruction in the native builder');
    }
    if (source.language !== 'html') return;
    // Preserve offsets/line numbers while removing script/style/comment contents
    // from structural tokenization; their original text is only scanned above.
    const html = source.content.replace(/<!--([\s\S]*?)-->|<(script|style)\b[^>]*>[\s\S]*?<\/\2\s*>/gi,(match) => match.replace(/[^\n]/g,' '));
    const labels = new Map<string,string>();
    for (const match of html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label\s*>/gi)) {
      const attrs = attributes(match[1]!); if (attrs.for) labels.set(attrs.for,plain(match[2]!));
      else { const nested=match[2]!.match(/<input\b([^>]*)>/i); if(nested) { const input=attributes(nested[1]!); labels.set(input.id || `${input.name}:${input.value}`,plain(match[2]!)); } }
    }
    const grouped = new Map<string,number>();
    let nodes = 0;
    const stack: Array<{ tag: string; hidden: boolean }> = [];
    for (const match of html.matchAll(/<\/?([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
      if (++nodes > FORM_IMPORT_LIMITS.nodes) throw new Error('Source HTML is too complex; provide a smaller form.');
      const tag = match[1]!.toLowerCase();
      if (match[0].startsWith('</')) { const index = stack.map((item) => item.tag).lastIndexOf(tag); if (index >= 0) stack.splice(index); continue; }
      const attrs = attributes(match[2]!);
      const hidden = stack.some((item) => item.hidden) || 'hidden' in attrs || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style ?? '') || attrs['aria-hidden'] === 'true';
      if (['fieldset','section'].includes(tag)) { if(sections.length>=100)throw new Error('Too many sections; provide a smaller source form.');sections.push(reference(match.index,attrs.id || `Section ${sections.length + 1}`,'s',sections.length)); }
      if (!['input','select','textarea','hr','h1','h2','h3','h4'].includes(tag)) { if (!['br','img','meta','link','area','source','wbr','!doctype'].includes(tag) && !match[0].endsWith('/>')) stack.push({ tag,hidden }); continue; }
      const inputType = tag === 'input' ? (attrs.type || 'text').toLowerCase() : tag;
      if (['submit','reset','button','hidden','password','image'].includes(inputType)) { if (inputType === 'password') warnings.push(reference(match.index,'Password fields cannot be imported','w',warnings.length)); continue; }
      const tail = html.slice(match.index + match[0].length);
      const body = tag === 'input' || tag === 'hr' ? '' : tail.slice(0,Math.max(0,tail.search(new RegExp(`</${tag}\\s*>`,'i'))));
      const options = tag === 'select' ? [...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi)].map((option) => ({ value: attributes(option[1]!).value ?? plain(option[2]!), label: plain(option[2]!) })) : [];
      if(options.length>100)throw new Error('A source dropdown has more than 100 choices. Replace its live data with an empty control and choose a Dropdown Master in the native builder.');
      const name = attrs.name || attrs.id || `control_${fields.length + 1}`;
      const label = labels.get(attrs.id ?? '') || labels.get(`${attrs.name}:${attrs.value}`) || attrs['aria-label'] || attrs['data-label'] || (tag.startsWith('h') ? plain(body) : '') || name;
      const groupKey = `${inputType}:${name}`;
      if (['radio','checkbox'].includes(inputType) && attrs.name && grouped.has(groupKey)) {
        const index = grouped.get(groupKey)!; const prior = fields[index]!;
        fields[index] = { ...prior, options: [...prior.options,{ value: attrs.value || label, label }], required: prior.required || 'required' in attrs };
        continue;
      }
      if (fields.length >= FORM_IMPORT_LIMITS.fields) throw new Error('A native form supports at most 100 controls. Split this form before importing.');
      fields.push({ ...reference(match.index,`Detected ${tag} ${name}`,'f',fields.length),tag,sourceName:name,inputType,label,required:'required' in attrs,hidden,options: ['radio','checkbox'].includes(inputType) ? [{ value:attrs.value || label,label }] : options,
        // Only structural attributes are included in the static outline. The raw
        // source remains separate untrusted data for the model.
        attributes:Object.fromEntries(Object.entries(attrs).filter(([key]) => ['id','name','type','required','placeholder','min','max','minlength','maxlength','pattern','multiple','data-next','data-condition'].includes(key))) });
      if (['radio','checkbox'].includes(inputType) && attrs.name) grouped.set(groupKey,fields.length - 1);
    }
  });
  return { fields,sections,conditions,paths,integrations,warnings,privacy };
}
