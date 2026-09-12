import { useState, useEffect } from "react";
import Modal from "@/react-app/components/ui/Modal";
import { useFuel } from "@/react-app/context/FuelContext";
import {
  X,
  LayoutDashboard,
  Save,
  RefreshCw,
  Eye,
  EyeOff,
  GripVertical,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

interface TabConfigModalProps {
  onClose: () => void;
}

export default function TabConfigModal({ onClose }: TabConfigModalProps) {
  const { state, dispatch } = useFuel();
  const [tabs, setTabs] = useState(state.tabConfigurations);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTabs(state.tabConfigurations);
  }, [state.tabConfigurations]);

  function handleSave() {
    dispatch({ type: "SET_TAB_CONFIGURATIONS", payload: tabs });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleReset() {
    if (!confirm("Reset all tab names to defaults?")) return;
    setTabs((prev) => prev.map((t) => ({ ...t, label: t.originalLabel })));
  }

  function moveTab(index: number, direction: "up" | "down") {
    const newTabs = [...tabs];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newTabs.length) return;
    [newTabs[index], newTabs[swapIndex]] = [newTabs[swapIndex], newTabs[index]];
    setTabs(newTabs.map((t, i) => ({ ...t, order: i })));
  }

  function toggleVisibility(id: string) {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, visible: !t.visible } : t)),
    );
  }

  return (
    <Modal
      onClose={onClose}
      label="Layout & Tabs"
      className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl max-h-[85vh] shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <LayoutDashboard size={20} className="text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Configure Tabs
            </h3>
            <p className="text-xs text-gray-500">
              Rename, reorder, and show/hide navigation tabs
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
        >
          <X size={18} className="text-gray-500" />
        </button>
      </div>

      {/* Tab List */}
      <div className="flex-1 overflow-auto p-5 space-y-2">
        {tabs
          .sort((a, b) => a.order - b.order)
          .map((tab, index) => (
            <div
              key={tab.id}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                tab.visible
                  ? "bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600"
                  : "bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700/50 opacity-50"
              }`}
            >
              {/* Grip Handle */}
              <div className="text-gray-300 dark:text-gray-600 flex-shrink-0">
                <GripVertical size={16} />
              </div>

              {/* Order */}
              <div className="w-7 h-7 bg-gray-100 dark:bg-gray-600 rounded-lg flex items-center justify-center text-xs font-medium text-gray-500 dark:text-gray-300 flex-shrink-0">
                {index + 1}
              </div>

              {/* Label Input */}
              <div className="flex-1 min-w-0">
                <input
                  value={tab.label}
                  onChange={(e) =>
                    setTabs((prev) =>
                      prev.map((t) =>
                        t.id === tab.id ? { ...t, label: e.target.value } : t,
                      ),
                    )
                  }
                  className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-[10px] text-gray-400 mt-0.5 ml-1">
                  {tab.description}
                </p>
              </div>

              {/* Original Label */}
              <div className="hidden sm:block text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded flex-shrink-0">
                {tab.originalLabel}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => moveTab(index, "up")}
                  disabled={index === 0}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Move up"
                >
                  <ChevronUp size={14} className="text-gray-500" />
                </button>
                <button
                  onClick={() => moveTab(index, "down")}
                  disabled={index === tabs.length - 1}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Move down"
                >
                  <ChevronDown size={14} className="text-gray-500" />
                </button>
                <button
                  onClick={() => toggleVisibility(tab.id)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    tab.visible
                      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                  title={tab.visible ? "Visible" : "Hidden"}
                >
                  {tab.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </div>
            </div>
          ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between p-5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <button
          onClick={handleReset}
          className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center gap-2 transition-colors"
        >
          <RefreshCw size={14} /> Reset Defaults
        </button>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              Saved!
            </span>
          )}
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors shadow-sm"
          >
            <Save size={14} /> Save Changes
          </button>
        </div>
      </div>
    </Modal>
  );
}
