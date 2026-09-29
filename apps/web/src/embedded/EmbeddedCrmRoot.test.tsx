// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCrmEmbedPageMessage, serializeCrmEmbedMessage } from "@jewelos/core";

type CapturedProps = {
  navigate: (href: string) => void;
  onSignOut: () => void;
  path: string;
  search: string;
  jewelosHomePath: string;
  auth?: unknown;
};
const captured: { props: CapturedProps | null } = { props: null };

vi.mock("@jewelos/crm-ui", () => ({
  CrmApp: (props: CapturedProps) => {
    captured.props = props;
    return <div>CRM at {props.path}{props.search}</div>;
  },
}));

import { EmbeddedCrmRoot } from "./EmbeddedCrmRoot";

afterEach(() => {
  cleanup();
  captured.props = null;
  window.history.replaceState({}, "", "/");
});

function mount() {
  window.history.replaceState({}, "", "/crm/queue");
  const sent: unknown[] = [];
  const bridge = { postMessage: (raw: string) => sent.push(parseCrmEmbedPageMessage(raw)) };
  render(<EmbeddedCrmRoot bridge={bridge} supabaseAnonKey="anon" supabaseUrl="http://127.0.0.1:54321" />);
  return sent;
}

describe("EmbeddedCrmRoot", () => {
  it("renders the CRM at the WebView's path with the auth override and announces itself to native", async () => {
    const sent = mount();
    await screen.findByText("CRM at /crm/queue");
    expect(captured.props?.auth).toBeDefined();
    expect(sent).toContainEqual({ type: "jewelos-crm:ready" });
  });

  it("navigates inside /crm itself and hands everything else to native", async () => {
    const sent = mount();
    await screen.findByText("CRM at /crm/queue");
    act(() => captured.props?.navigate("/crm/clients?search=MKC"));
    await screen.findByText("CRM at /crm/clients?search=MKC");
    expect(window.location.pathname).toBe("/crm/clients");
    act(() => captured.props?.navigate(captured.props.jewelosHomePath));
    expect(sent).toContainEqual({ type: "jewelos-crm:home" });
    expect(window.location.pathname).toBe("/crm/clients");
    act(() => captured.props?.navigate("https://elsewhere.example/crm"));
    expect(sent.filter((message) => (message as { type: string }).type === "jewelos-crm:home")).toHaveLength(2);
  });

  it("asks native to sign out", async () => {
    const sent = mount();
    await screen.findByText("CRM at /crm/queue");
    act(() => captured.props?.onSignOut());
    expect(sent).toContainEqual({ type: "jewelos-crm:sign-out" });
  });

  it("accepts native messages on document only", async () => {
    const sent = mount();
    await screen.findByText("CRM at /crm/queue");
    window.localStorage.setItem("x", "1");
    // A clear posted by another window to `window` is ignored...
    window.dispatchEvent(new MessageEvent("message", { data: serializeCrmEmbedMessage({ type: "jewelos-crm:clear" }), origin: "https://evil.example" }));
    expect(window.localStorage.getItem("x")).toBe("1");
    // ...the native bridge's clear (dispatched on document) wipes storage and is confirmed.
    document.dispatchEvent(new MessageEvent("message", { data: serializeCrmEmbedMessage({ type: "jewelos-crm:clear" }) }));
    await vi.waitFor(() => expect(sent).toContainEqual({ type: "jewelos-crm:cleared" }));
    expect(window.localStorage.getItem("x")).toBeNull();
  });
});
