// @vitest-environment jsdom
import { act,renderHook } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { useFollowupControls } from '@/crm-port/use-followup-controls';
import type { FollowupPaging } from '@/crm-port/followup-page';
const router=vi.hoisted(()=>({push:vi.fn()}));
vi.mock('@/next-shim/navigation',()=>({useRouter:()=>router}));
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
const paging:FollowupPaging={page:7,total:120001,counts:{pending:120001},statuses:['PENDING'],hasOffRoster:false,filters:{tab:'pending',search:'',sort:'default'}};
it('debounces typing, resets pagination, and allows repeating a search after Back',()=>{
 vi.useFakeTimers();
 const {result,rerender}=renderHook(({page})=>useFollowupControls('not_bought',page,'default'),{initialProps:{page:paging}});
 act(()=>result.current.change({search:'123'}));act(()=>vi.advanceTimersByTime(299));expect(router.push).not.toHaveBeenCalled();
 act(()=>result.current.change({search:'1234'}));act(()=>vi.advanceTimersByTime(300));
 expect(router.push).toHaveBeenLastCalledWith('/followups?tab=pending&sort=default&search=1234');
 rerender({page:{...paging,page:1,filters:{...paging.filters,search:'1234'}}});
 rerender({page:paging});
 act(()=>result.current.change({search:'1234'}));act(()=>vi.advanceTimersByTime(300));expect(router.push).toHaveBeenCalledTimes(2);
});
it('an immediate tab change includes pending search and cancels its old timer',()=>{
 vi.useFakeTimers();const {result}=renderHook(()=>useFollowupControls('not_bought',paging,'default'));
 act(()=>result.current.change({search:'1234'}));act(()=>vi.advanceTimersByTime(100));act(()=>result.current.change({tab:'done'}));act(()=>vi.advanceTimersByTime(500));
 expect(router.push).toHaveBeenCalledTimes(1);expect(router.push).toHaveBeenCalledWith('/followups?tab=done&sort=default&search=1234');
});
