// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResponsiveDisclosure } from '@/components/responsive-disclosure';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('keeps secondary profile information collapsed on phones and accessible on demand',()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 render(<ResponsiveDisclosure title="Preferences"><p>Saved tea preference</p></ResponsiveDisclosure>);
 const panel=screen.getByText('Preferences').closest('details')!;
 expect(panel.open).toBe(false);
 panel.open=true;
 fireEvent(panel,new Event('toggle'));
 expect(panel.open).toBe(true);
 expect(screen.getByText('Saved tea preference')).toBeTruthy();
});
it('shows secondary profile information expanded on desktop',()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 render(<ResponsiveDisclosure title="Preferences"><p>Saved tea preference</p></ResponsiveDisclosure>);
 expect(screen.getByText('Preferences').closest('details')?.open).toBe(true);
});
