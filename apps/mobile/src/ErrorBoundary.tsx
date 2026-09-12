import { Component, type ErrorInfo, type ReactNode } from "react";
import { log } from "@/lib/log";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { ErrorState } from "@/ui/states";

type Props = Readonly<{ children: ReactNode }>;
type State = Readonly<{ error: Error | null }>;

/**
 * The last line before a white screen.
 *
 * A render error anywhere below this shows a recoverable message instead of
 * killing the app, and is logged with its component stack in development. The
 * message deliberately carries no record content: whatever the app was showing
 * when it broke may have been a customer's.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error("startup", "a screen failed to render", error);
    log.debug("startup", "component stack", info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Screen footer={<Button full label="Try again" onPress={() => this.setState({ error: null })} />}>
        <ErrorState
          message="Something went wrong while drawing this screen. Trying again usually clears it."
          title="JewelOS hit a problem"
        />
      </Screen>
    );
  }
}
