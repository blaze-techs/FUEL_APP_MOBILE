import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { formatNumber } from "@/react-app/utils/formatUtils";
import {
  getCurrencySymbol,
  resolveCurrencySymbol,
} from "@/react-app/lib/currency";
import {
  Layers,
  TrendingUp,
  DollarSign,
  Fuel,
  Users,
  AlertTriangle,
  BarChart3,
  Receipt,
  CreditCard,
  FileText,
  Activity,
  ArrowLeft,
} from "lucide-react";

export default function CombinedStationsView() {
  const { stations, combineStations, switchStation } = useStations();
  const { state } = useFuel();
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    undefined,
  );
  const combined = combineStations();

  if (!combined) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Layers size={48} className="mx-auto text-gray-400 mb-4" />
          <p className="text-gray-500">No station data to combine</p>
        </div>
      </div>
    );
  }

  const { data, stations: stationList } = combined;

  // Aggregate metrics from all stations
  const totalStations = stationList.length;
  const totalRevenue = data.totalRevenue || 0;
  const totalFuelSold = data.totalFuelSold || 0;
  const totalDebt = data.deliveryData?.totals?.balanceDue || 0;
  const totalClients = Object.keys(data.clients || {}).length;
  const totalEmployees = data.employees?.length || 0;
  const totalInvoices = Object.keys(data.invoices || {}).length;

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 rounded-xl p-5 border border-blue-500/20">
          <Layers size={20} className="text-blue-400 mb-3" />
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {totalStations}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Stations</p>
        </div>
        <div className="bg-gradient-to-br from-green-500/10 to-green-600/10 rounded-xl p-5 border border-green-500/20">
          <DollarSign size={20} className="text-green-400 mb-3" />
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {currencySymbol} {formatNumber(totalRevenue)}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Total Revenue
          </p>
        </div>
        <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/10 rounded-xl p-5 border border-amber-500/20">
          <Fuel size={20} className="text-amber-400 mb-3" />
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatNumber(totalFuelSold)} L
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Fuel Dispensed
          </p>
        </div>
        <div className="bg-gradient-to-br from-red-500/10 to-red-600/10 rounded-xl p-5 border border-red-500/20">
          <AlertTriangle size={20} className="text-red-400 mb-3" />
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {currencySymbol} {formatNumber(totalDebt)}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Balance Due
          </p>
        </div>
      </div>

      {/* Station Details Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Layers size={18} className="text-blue-500" />
            Station Breakdown
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                <th className="px-6 py-3">Station</th>
                <th className="px-6 py-3">Location</th>
                <th className="px-6 py-3">Revenue</th>
                <th className="px-6 py-3">Fuel (L)</th>
                <th className="px-6 py-3">Debt</th>
                <th className="px-6 py-3">Clients</th>
                <th className="px-6 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {stationList.map((station) => {
                const sData = station.data || {};
                const sRevenue = sData.totalRevenue || 0;
                const sFuel = sData.totalFuelSold || 0;
                const sDebt = sData.deliveryData?.totals?.balanceDue || 0;
                const sClients = Object.keys(sData.clients || {}).length;

                return (
                  <tr
                    key={station.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-sm font-bold text-white">
                          {station.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {station.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {station.location || "-"}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                      {currencySymbol} {formatNumber(sRevenue)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {formatNumber(sFuel)}
                    </td>
                    <td className="px-6 py-4 text-sm text-red-600 dark:text-red-400">
                      {currencySymbol} {formatNumber(sDebt)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {sClients}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => switchStation(station.id)}
                        className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded-lg transition-colors"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Aggregate Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
          <Users size={20} className="text-purple-500 mb-2" />
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            {totalClients}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Total Clients
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
          <Users size={20} className="text-indigo-500 mb-2" />
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            {totalEmployees}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Total Employees
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
          <Receipt size={20} className="text-amber-500 mb-2" />
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            {totalInvoices}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Total Invoices
          </p>
        </div>
      </div>
    </div>
  );
}
