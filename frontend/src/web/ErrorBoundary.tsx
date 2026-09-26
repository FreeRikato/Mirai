import { Component, type ReactNode } from "react";

type Props = { resetKey?: string; children: ReactNode };
type State = { error: Error | null; resetKey: string | undefined };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-4 font-mono md:p-8">
        <p className="m-0 text-bad">this page crashed: {this.state.error.message}</p>
        <button type="button" onClick={() => location.reload()} className="cursor-pointer border border-rule bg-transparent px-3 py-1.5 font-mono text-[11px] text-fg hover:border-dim">
          reload
        </button>
      </div>
    );
  }
}
