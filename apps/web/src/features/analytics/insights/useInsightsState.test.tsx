// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {act,cleanup,renderHook} from "@testing-library/react";
import {useInsightsRequest} from "./useInsightsState";
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("insights requests",()=>{it("discards old scope responses after filters change",async()=>{vi.useFakeTimers();let resolveOld:(v:string)=>void=()=>{};let resolveNew:(v:string)=>void=()=>{};const old=()=>new Promise<string>(resolve=>{resolveOld=resolve;});const next=()=>new Promise<string>(resolve=>{resolveNew=resolve;});const {result,rerender}=renderHook(({loader,key})=>useInsightsRequest(loader,key),{initialProps:{loader:old,key:"branch-a"}});await act(()=>vi.advanceTimersByTimeAsync(200));rerender({loader:next,key:"branch-b"});await act(()=>vi.advanceTimersByTimeAsync(200));await act(async()=>resolveOld("old private scope"));expect(result.current.data).toBeNull();await act(async()=>resolveNew("new scope"));expect(result.current.data).toBe("new scope");});});
