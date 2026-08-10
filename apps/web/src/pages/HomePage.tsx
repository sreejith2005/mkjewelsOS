import {HomeView} from "@/features/home/HomeView";
export function HomePage({onNavigate}: {onNavigate:(path:string)=>void}){return <HomeView onNavigate={onNavigate}/>;}
