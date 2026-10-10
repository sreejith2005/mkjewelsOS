import Link from '@/next-shim/link';
export type ClientHistoryPaging={visits:number;activity:number;audit:number;hasMoreVisits:boolean;hasMoreActivity:boolean;hasMoreAudit:boolean};
export function ClientHistoryPager({clientId,section,paging}:{clientId:string;section:'visits'|'activity'|'audit';paging:ClientHistoryPaging}){
 const page=paging[section];const more=section==='visits'?paging.hasMoreVisits:section==='activity'?paging.hasMoreActivity:paging.hasMoreAudit;
 function href(next:number){const params=new URLSearchParams();for(const key of ['visits','activity','audit'] as const){const value=key===section?next:paging[key];if(value>1)params.set(key+'_page',String(value));}return `/clients/${clientId}${params.size?'?'+params:''}`;}
 return <nav aria-label={`${section} pages`} className="flex flex-wrap gap-3 p-4 text-xs text-stone-600"><span>{section.toUpperCase()} HISTORY · PAGE {page}</span>{page>1&&<Link className="rounded border px-3 py-1" href={href(page-1)}>NEWER {section.toUpperCase()}</Link>}{more&&<Link className="rounded border px-3 py-1" href={href(page+1)}>OLDER {section.toUpperCase()}</Link>}</nav>;
}
