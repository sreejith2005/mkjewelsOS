import Link from '@/next-shim/link';
import { FOLLOWUP_PAGE_SIZE,followupHref,type FollowupPaging } from '@/crm-port/followup-page';
export function FollowupPager({kind,paging}:{kind:'not_bought'|'referral';paging:FollowupPaging}){
 const pages=Math.max(1,Math.ceil(paging.total/FOLLOWUP_PAGE_SIZE));
 return <nav aria-label="Follow-up pages" className="flex flex-wrap items-center gap-3 p-4 text-xs text-stone-600">
 <span>PAGE {paging.page} OF {pages}</span>
 {paging.page>1&&<Link className="rounded border px-3 py-1" href={followupHref(kind,paging.filters,paging.page-1)}>PREVIOUS</Link>}
 {paging.page<pages&&<Link className="rounded border px-3 py-1" href={followupHref(kind,paging.filters,paging.page+1)}>NEXT</Link>}
 </nav>;
}
