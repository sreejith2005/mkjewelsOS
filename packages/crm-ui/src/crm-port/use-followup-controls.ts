import { useEffect,useRef,useState } from 'react';
import { useRouter } from '@/next-shim/navigation';
import { usePreload } from './navigation-context';
import { followupHref,type FollowupFilters,type FollowupPaging,type FollowupPreset } from './followup-page';
export function useFollowupControls(kind:'not_bought'|'referral',paging:FollowupPaging|undefined,defaultSort:string,preset?:FollowupPreset){
 const router=useRouter();
 const preloadHref=usePreload();
 const defaults={tab:'today',crm:'',search:'',status:'',branch:'',sort:defaultSort};
 const [filters,setFilters]=useState({...defaults,...paging?.filters});
 const sent=useRef('');
 const serverFilters=JSON.stringify(paging?.filters);
 const localFilters=JSON.stringify(filters);
 useEffect(()=>{if(paging){sent.current='';setFilters({...defaults,...paging.filters});}},[serverFilters]); // URL navigation/back restores the committed filters.
 useEffect(()=>{
  if(!paging||filters.search===(paging.filters.search??''))return;
  const href=followupHref(kind,filters,1,preset??paging?.preset);
  if(sent.current===href)return;
  const timeout=setTimeout(()=>{sent.current=href;router.push(href);},300);
  return()=>clearTimeout(timeout);
 },[localFilters,serverFilters]);
 function change(patch:FollowupFilters){
  const next={...filters,...patch};setFilters(next);
  if(paging&&Object.keys(patch).some(key=>key!=='search')){const href=followupHref(kind,next,1,preset??paging?.preset);sent.current=href;router.push(href);}
 }
 /** Starts loading a tab before it is opened (hover, focus or touch). */
 function preload(patch:FollowupFilters){if(paging)preloadHref(followupHref(kind,{...filters,...patch},1,preset??paging.preset));}
 return {filters,change,preload};
}
