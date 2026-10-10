import { useEffect,useRef,useState } from 'react';
import { useRouter } from '@/next-shim/navigation';
import { followupHref,type FollowupFilters,type FollowupPaging } from './followup-page';
export function useFollowupControls(kind:'not_bought'|'referral',paging:FollowupPaging|undefined,defaultSort:string){
 const router=useRouter();
 const defaults={tab:'today',crm:'',search:'',status:'',branch:'',sort:defaultSort};
 const [filters,setFilters]=useState({...defaults,...paging?.filters});
 const sent=useRef('');
 const serverFilters=JSON.stringify(paging?.filters);
 const localFilters=JSON.stringify(filters);
 useEffect(()=>{if(paging){sent.current='';setFilters({...defaults,...paging.filters});}},[serverFilters]); // URL navigation/back restores the committed filters.
 useEffect(()=>{
  if(!paging||filters.search===(paging.filters.search??''))return;
  const href=followupHref(kind,filters);
  if(sent.current===href)return;
  const timeout=setTimeout(()=>{sent.current=href;router.push(href);},300);
  return()=>clearTimeout(timeout);
 },[localFilters,serverFilters]);
 function change(patch:FollowupFilters){
  const next={...filters,...patch};setFilters(next);
  if(paging&&patch.search===undefined){const href=followupHref(kind,next);sent.current=href;router.push(href);}
 }
 return {filters,change};
}
