"use client";

import { Component, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Shown above the error text, e.g. the name of the panel that failed. */
  label?: string;
  /** For things that run in the background and draw nothing (preloaders): a failure is logged and the
   * component simply stops, instead of showing an error panel in the middle of the app. */
  silent?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render error in one panel instead of letting it unmount the whole
 * app. Without this, a component that throws while rendering (a Convex query
 * against a function that isn't deployed yet, for example) takes its entire
 * React root down — which, inside a dialog, looks exactly like the dialog
 * having stopped responding to clicks rather than like an error.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (this.props.silent) console.warn("[error-boundary]", this.props.label ?? "", error.message);
    else console.error("[error-boundary]", this.props.label ?? "", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.silent) return null;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="max-w-md space-y-1">
          <p className="text-sm font-semibold">
            {this.props.label ? `${this.props.label} failed to load.` : "Something went wrong."}
          </p>
          <p className="text-xs break-words text-muted-foreground">{error.message}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}
