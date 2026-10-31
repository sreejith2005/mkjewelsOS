// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn().mockResolvedValue({ data: [] });
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> })); // crm-port: next/link -> local shim module

import { ClientSearch } from "@/components/client-search";

afterEach(() => { cleanup(); vi.restoreAllMocks(); rpc.mockReset().mockResolvedValue({data:[],error:null}); });

describe("ClientSearch", () => {
  it('retains completed results when only surrounding query whitespace changes',async()=>{
    rpc.mockResolvedValue({data:[{client_id:'one',primary_name:'Li',primary_phone:null,client_code:'MKC-1'}],error:null});
    render(<ClientSearch/>);
    const input=screen.getByLabelText('Search client');
    fireEvent.change(input,{target:{value:'Li'}});
    await screen.findByRole('link',{name:/Li/});
    fireEvent.change(input,{target:{value:' Li '}});
    expect(screen.getByRole('link',{name:/Li/})).toBeTruthy();
    expect(screen.queryByText('Searching…')).toBeNull();
  });
  it('selects a referring client without submitting the surrounding referral form',async()=>{
    rpc.mockResolvedValue({data:[{client_id:'referrer',primary_name:'Synthetic Referrer',primary_phone:null,client_code:'MKC-1'}],error:null});
    const onSelect=vi.fn(),submit=vi.fn();
    render(<form onSubmit={submit}><ClientSearch onSelect={onSelect}/></form>);
    const input=screen.getByLabelText('Search client');
    fireEvent.change(input,{target:{value:'Synthetic'}});
    await screen.findByRole('button',{name:/Synthetic Referrer/});
    fireEvent.keyDown(input,{key:'Enter'});
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({client_id:'referrer'}));
    expect(submit).not.toHaveBeenCalled();
  });
  it('finds short names and offers the complete result page', async()=>{
    rpc.mockResolvedValue({data:[{client_id:'one',primary_name:'Li',primary_phone:null,client_code:'MKC-1',household_code:null,referral_code:null}],error:null});
    render(<ClientSearch/>);
    fireEvent.change(screen.getByLabelText('Search client'),{target:{value:'Li'}});
    const link=await screen.findByRole('link',{name:/Li/});
    expect(link.getAttribute('href')).toBe('/clients/one');
    expect(screen.getByRole('link',{name:'See all results'}).getAttribute('href')).toBe('/clients?search=Li');
  });

  it('shows a retryable failure instead of suggesting a duplicate client', async()=>{
    rpc.mockResolvedValue({data:null,error:{message:'network unavailable'}});
    render(<ClientSearch/>);
    fireEvent.change(screen.getByLabelText('Search client'),{target:{value:'Anita'}});
    await screen.findByRole('alert');
    expect(screen.queryByText(/No client found/)).toBeNull();
    rpc.mockResolvedValue({data:[],error:null});
    fireEvent.click(screen.getByRole('button',{name:'Retry search'}));
    await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
  });

  it('dismisses results with Escape and never reopens them for an obsolete response',async()=>{
    let resolve: (value: {data:unknown[];error:null})=>void = () => undefined;
    rpc.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    render(<ClientSearch/>);
    const input=screen.getByLabelText('Search client');
    fireEvent.change(input,{target:{value:'Anita'}});
    await waitFor(()=>expect(rpc).toHaveBeenCalled());
    fireEvent.keyDown(input,{key:'Escape'});
    resolve({data:[{client_id:'old',primary_name:'Obsolete'}],error:null});
    await waitFor(()=>expect(screen.queryByText('Obsolete')).toBeNull());
  });
  it("does not warn when crossing search thresholds or typing rapidly", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ClientSearch />);
    const input = screen.getByLabelText("Search client");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.change(input, { target: { value: "abcd" } });
    fireEvent.change(input, { target: { value: "abcde" } });
    expect(error.mock.calls.flat().join(" ")).not.toContain("The final argument passed to useEffect changed size");
  });
});
