import { useEffect, useState, type ReactNode } from 'react';

/** Desktop dossiers stay expanded; phones disclose secondary saved information. */
export function ResponsiveDisclosure({ title, children, className = '' }: {title:string;children:ReactNode;className?:string}) {
 const [expanded,setExpanded]=useState(()=>typeof window.matchMedia==='function' ? !window.matchMedia('(max-width:767px)').matches : true);
 useEffect(()=>{
  if(typeof window.matchMedia!=='function')return;
  const media=window.matchMedia('(max-width:767px)');
  const change=()=>setExpanded(!media.matches);
  media.addEventListener('change',change);
  return()=>media.removeEventListener('change',change);
 },[]);
 return <details open={expanded} className={`crm-profile-disclosure ${className}`} onToggle={event=>setExpanded(event.currentTarget.open)}><summary><h2>{title}</h2><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2"/></svg></summary>{children}</details>;
}
