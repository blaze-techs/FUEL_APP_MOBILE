import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Users } from "lucide-react";
import TeamManager from "@/react-app/components/TeamManager";

type Props = { children?: ReactNode };
type State = { error: Error | null };

export default class TeamManagerSafe extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[TeamManagerSafe] Team Manager render failure", error, info);
    try {
      localStorage.setItem(
        "fuelpro_team_manager_error",
        JSON.stringify({
          message: error.message,
          stack: error.stack ?? null,
          componentStack: info.componentStack,
          at: new Date().toISOString(),
        }),
      );
    } catch {
      // Diagnostic persistence must never create a second failure.
    }
  }

  private retry = () => {
    this.setState({ error: null });
  };

  private hardReload = () => {
    try {
      localStorage.removeItem("fuelpro_team_manager_error");
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) {
      return <TeamManager />;
    }

    return (
      <section
        role="alert"
        className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-6"
      >
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-amber-100 dark:bg-amber-900/40 p-3">
            <Users className="h-6 w-6 text-amber-700 dark:text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              Team Manager could not render
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Your station data has not been deleted. Team Manager stopped at
              the UI layer; retrying will remount the feature without clearing
              the roster.
            </p>
            <p className="mt-2 break-words rounded-lg bg-white/70 dark:bg-black/20 p-2 text-xs text-gray-600 dark:text-gray-300">
              {this.state.error.message || "Unknown Team Manager error"}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={this.retry}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                <RefreshCw size={15} /> Retry Team Manager
              </button>
              <button
                type="button"
                onClick={this.hardReload}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-800"
              >
                Reload app
              </button>
            </div>
          </div>
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
        </div>
      </section>
    );
  }
}
