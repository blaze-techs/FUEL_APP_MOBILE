/**
 * FuelPro feature contract registry.
 *
 * Different from the workspace navigation registry: this describes how a
 * module behaves after it is opened — its purpose, canonical sub-views,
 * primary action, and data boundary. Navigation answers "where"; this file
 * answers "what should work there".
 */
export type FeatureContract = {
  id: string;
  purpose: string;
  primaryAction: string;
  subTabs?: string[];
  dataBoundary: "station" | "user" | "transaction" | "finance" | "content" | "system";
  supportsOffline?: boolean;
  searchable?: boolean;
};

export const FEATURE_REGISTRY: FeatureContract[] = [
  { id:"dashboard", purpose:"Station command center", primaryAction:"Review station status", dataBoundary:"station", searchable:true },
  { id:"reports", purpose:"Operational and financial reporting", primaryAction:"Run report", dataBoundary:"station", searchable:true },
  { id:"analytics", purpose:"Performance trends and KPIs", primaryAction:"Inspect KPI trend", dataBoundary:"station", searchable:true },
  { id:"pos", purpose:"Create and settle fuel sales", primaryAction:"Start sale", dataBoundary:"transaction", supportsOffline:true, searchable:true },
  { id:"livetransaction", purpose:"Monitor payment and transaction state", primaryAction:"Open live transactions", dataBoundary:"transaction", supportsOffline:true, searchable:true },
  { id:"sales", purpose:"Review sales ledger", primaryAction:"Review sales", dataBoundary:"transaction", supportsOffline:true, searchable:true },
  { id:"pumpmapping", purpose:"Map pumps, nozzles and fuel products", primaryAction:"Manage pump mapping", dataBoundary:"station", searchable:true },
  { id:"inventory", purpose:"Track stock and tank movements", primaryAction:"Record stock movement", dataBoundary:"station", supportsOffline:true, searchable:true },
  { id:"offloading", purpose:"Record fuel deliveries/offloading", primaryAction:"Record offloading", dataBoundary:"transaction", supportsOffline:true, searchable:true },
  { id:"delivery", purpose:"Reconcile supplier deliveries", primaryAction:"Review delivery", dataBoundary:"transaction", searchable:true },
  { id:"suppliers", purpose:"Manage fuel and service suppliers", primaryAction:"Add supplier", dataBoundary:"station", searchable:true },
  { id:"price-finder", purpose:"Reference current fuel pricing", primaryAction:"Find price", dataBoundary:"station", searchable:true },
  { id:"maintenance", purpose:"Track equipment maintenance", primaryAction:"Create maintenance task", dataBoundary:"station", supportsOffline:true, searchable:true },
  { id:"customers", purpose:"Manage customer accounts and loyalty", primaryAction:"Open customer", dataBoundary:"station", searchable:true },
  { id:"invoice", purpose:"Create and manage invoices", primaryAction:"Create invoice", dataBoundary:"transaction", supportsOffline:true, searchable:true },
  { id:"credit", purpose:"Manage customer credit ledger", primaryAction:"Open credit account", dataBoundary:"finance", supportsOffline:true, searchable:true },
  { id:"mpesa", purpose:"Reconcile M-PESA payments", primaryAction:"Open M-PESA", dataBoundary:"finance", searchable:true },
  { id:"fuelsalesreport", purpose:"Analyze fuel sales by product and period", primaryAction:"Run fuel sales report", dataBoundary:"transaction", searchable:true },
  { id:"team", purpose:"Manage people, access and workforce", primaryAction:"Review team access", subTabs:["team","roles","teams","shifts","leave","performance","activity"], dataBoundary:"station", searchable:true },
  { id:"payroll", purpose:"Manage payroll records", primaryAction:"Review payroll", dataBoundary:"finance", searchable:true },
  { id:"projtime", purpose:"Track projects and time", primaryAction:"Log time", dataBoundary:"user", supportsOffline:true, searchable:true },
  { id:"communication", purpose:"Manage staff communication", primaryAction:"Send message", dataBoundary:"station", searchable:true },
  { id:"expenses", purpose:"Record and review station expenses", primaryAction:"Record expense", dataBoundary:"finance", supportsOffline:true, searchable:true },
  { id:"regional", purpose:"Compliance and regional controls", primaryAction:"Review compliance", dataBoundary:"station", searchable:true },
  { id:"audit", purpose:"Immutable operational audit trail", primaryAction:"Review audit events", dataBoundary:"station", searchable:true },
  { id:"documents", purpose:"Store and retrieve station documents", primaryAction:"Upload document", dataBoundary:"content", searchable:true },
  { id:"agreements", purpose:"Manage business agreements", primaryAction:"Open agreement", dataBoundary:"content", searchable:true },
  { id:"webstudio", purpose:"Manage public website content", primaryAction:"Edit site", dataBoundary:"content", searchable:true },
  { id:"news", purpose:"Manage station news and media", primaryAction:"Publish update", dataBoundary:"content", searchable:true },
  { id:"integration", purpose:"Connect external services", primaryAction:"Test integration", dataBoundary:"system", searchable:true },
  { id:"automation", purpose:"Manage scheduled and event automations", primaryAction:"Review automations", dataBoundary:"system", searchable:true },
  { id:"terminal", purpose:"Manage station terminal sessions", primaryAction:"Open terminal session", dataBoundary:"system", searchable:true },
  { id:"fueltypes", purpose:"Configure fuel products and pricing rules", primaryAction:"Manage fuel type", dataBoundary:"station", searchable:true },
  { id:"data", purpose:"Manage data import, export and recovery", primaryAction:"Open data tools", dataBoundary:"system", searchable:true },
  { id:"subscription", purpose:"Manage FuelPro subscription", primaryAction:"Review subscription", dataBoundary:"system", searchable:true },
  { id:"settings", purpose:"Manage station and account settings", primaryAction:"Open settings", dataBoundary:"system", searchable:true },
  { id:"videogames", purpose:"Optional station entertainment", primaryAction:"Open games", dataBoundary:"content", searchable:true },
];

export const FEATURE_BY_ID: Record<string, FeatureContract> = Object.fromEntries(
  FEATURE_REGISTRY.map((feature) => [feature.id, feature]),
);

export function getFeatureContract(id: string): FeatureContract | undefined {
  return FEATURE_BY_ID[id];
}
