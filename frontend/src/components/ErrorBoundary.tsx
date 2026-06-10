"use client";

import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-8">
          <div className="glass-panel !rounded-xl p-6 max-w-md text-center space-y-4">
            <AlertTriangle className="w-8 h-8 mx-auto text-amber-400/60" />
            <div className="space-y-1">
              <div className="text-sm font-medium text-zinc-300">Something went wrong</div>
              <div className="text-[10px] font-mono text-zinc-600 leading-relaxed max-w-xs mx-auto line-clamp-3">
                {this.state.error.message}
              </div>
            </div>
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06]
                text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
