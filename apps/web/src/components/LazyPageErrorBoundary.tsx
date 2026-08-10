import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Notice } from "@/components/ui";

type Props = Readonly<{ children: ReactNode; onNavigate: (path: string) => void }>;
type State = Readonly<{ failed: boolean }>;

export class LazyPageErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  override componentDidCatch(_error: Error, _info: ErrorInfo): void { /* keep internal detail out of the UI */ }
  retry = (): void => this.setState({ failed: false });
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <section className="mx-auto max-w-xl rounded-2xl border border-danger/40 bg-danger/10 p-6 text-center"><h1 className="font-display text-2xl text-white">This page could not be displayed</h1><div className="mt-3"><Notice tone="danger">JewelOS could not safely render this page. Your session is still active.</Notice></div><div className="mt-5 flex justify-center gap-3"><Button onClick={this.retry} variant="secondary">Retry</Button><Button onClick={() => this.props.onNavigate("/dashboard")}>Go to dashboard</Button></div></section>;
  }
}
