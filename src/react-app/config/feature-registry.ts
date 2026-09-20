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
  /** Canonical workspace used for contextual navigation and onboarding. */
  workspace?: string;
  /** Search aliases and natural-language terms used by QuickSearch/AI. */
  searchAliases?: string[];
  /** Relative importance when the module is surfaced on compact screens. */
  mobilePriority?: "primary" | "secondary" | "utility";
  /** Whether a module can perform its primary workflow while offline. */
  offlineMode?: "full" | "read-only" | "none";
};

export const FEATURE_REGISTRY: FeatureContract[] = [
  { id:"dashboard", workspace:"home", searchAliases:["home","overview","command center"], mobilePriority:"primary", offlineMode:"full", purpose:"Station command center", primaryAction:"Review station status", dataBoundary:"station", searchable:true },
  { id:"reports", workspace:"home", searchAliases:["report center","statements","exports"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Operational and financial reporting", primaryAction:"Run report", dataBoundary:"station", searchable:true },
  { id:"analytics", workspace:"home", searchAliases:["kpi","performance","trends"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Performance trends and KPIs", primaryAction:"Inspect KPI trend", dataBoundary:"station", searchable:true },
  { id:"pos", workspace:"forecourt", searchAliases:["cash sale","point of sale","checkout"], mobilePriority:"primary", offlineMode:"full", purpose:"Create and settle fuel sales", primaryAction:"Start sale", dataBoundary:"transaction", supportsOffline:true, searchable:true },
  { id:"livetransaction", workspace:"forecourt", searchAliases:["live transaction","stk","payment status"], mobilePriority:"primary", offlineMode:"read-only", purpose:"Monitor payment and transaction state", primaryAction:"Open live transactions", dataBoundary:"transaction", supportsOffline:true, searchable:true },
  { id:"sales", workspace:"forecourt", searchAliases:["sales tracking","sales ledger","pump sales"], mobilePriority:"primary", offlineMode:"full", purpose:"Review sales ledger", primaryAction:"Review sales", dataBoundary:"transaction", supportsOffline:true, searchable:true },
  { id:"pumpmapping", workspace:"forecourt", searchAliases:["pump map","nozzle","pump setup"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Map pumps, nozzles and fuel products", primaryAction:"Manage pump mapping", dataBoundary:"station", searchable:true },
  { id:"inventory", workspace:"stock-supply", searchAliases:["stock","tank","inventory"], mobilePriority:"primary", offlineMode:"full", purpose:"Track stock and tank movements", primaryAction:"Record stock movement", dataBoundary:"station", supportsOffline:true, searchable:true },
  { id:"offloading", workspace:"stock-supply", searchAliases:["delivery receipt","fuel receipt","offload"], mobilePriority:"primary", offlineMode:"full", purpose:"Record fuel deliveries/offloading", primaryAction:"Record offloading", dataBoundary:"transaction", supportsOffline:true, searchable:true },
  { id:"delivery", workspace:"stock-supply", searchAliases:["fuel statement","supplier reconciliation"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Reconcile supplier deliveries", primaryAction:"Review delivery", dataBoundary:"transaction", searchable:true },
  { id:"suppliers", workspace:"stock-supply", searchAliases:["supplier","vendor"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Manage fuel and service suppliers", primaryAction:"Add supplier", dataBoundary:"station", searchable:true },
  { id:"price-finder", workspace:"stock-supply", searchAliases:["fuel prices","price lookup"], mobilePriority:"utility", offlineMode:"read-only", purpose:"Reference current fuel pricing", primaryAction:"Find price", dataBoundary:"station", searchable:true },
  { id:"maintenance", workspace:"stock-supply", searchAliases:["equipment","service","maintenance"], mobilePriority:"secondary", offlineMode:"full", purpose:"Track equipment maintenance", primaryAction:"Create maintenance task", dataBoundary:"station", supportsOffline:true, searchable:true },
  { id:"customers", workspace:"sales-payments", searchAliases:["clients","customer accounts","loyalty"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Manage customer accounts and loyalty", primaryAction:"Open customer", dataBoundary:"station", searchable:true },
  { id:"invoice", workspace:"sales-payments", searchAliases:["billing","invoice","receipt"], mobilePriority:"primary", offlineMode:"full", purpose:"Create and manage invoices", primaryAction:"Create invoice", dataBoundary:"transaction", supportsOffline:true, searchable:true },
  { id:"credit", workspace:"sales-payments", searchAliases:["credit ledger","debtor","debt account"], mobilePriority:"primary", offlineMode:"full", purpose:"Manage customer credit ledger", primaryAction:"Open credit account", dataBoundary:"finance", supportsOffline:true, searchable:true },
  { id:"mpesa", workspace:"sales-payments", searchAliases:["mobile money","mpesa","payments"], mobilePriority:"primary", offlineMode:"read-only", purpose:"Reconcile M-PESA payments", primaryAction:"Open M-PESA", dataBoundary:"finance", searchable:true },
  { id:"fuelsalesreport", workspace:"sales-payments", searchAliases:["fuel sales","product sales"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Analyze fuel sales by product and period", primaryAction:"Run fuel sales report", dataBoundary:"transaction", searchable:true },
  { id:"team", workspace:"people", searchAliases:["staff","users","access","roles","workforce"], mobilePriority:"primary", offlineMode:"read-only", purpose:"Manage people, access and workforce", primaryAction:"Review team access", subTabs:["team","roles","teams","shifts","leave","performance","activity"], dataBoundary:"station", searchable:true },
  { id:"payroll", workspace:"people", searchAliases:["salary","wages","payroll"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Manage payroll records", primaryAction:"Review payroll", dataBoundary:"finance", searchable:true },
  { id:"projtime", workspace:"people", searchAliases:["projects","timesheet","time tracking"], mobilePriority:"secondary", offlineMode:"full", purpose:"Track projects and time", primaryAction:"Log time", dataBoundary:"user", supportsOffline:true, searchable:true },
  { id:"communication", workspace:"people", searchAliases:["staff messages","chat","announcements"], mobilePriority:"utility", offlineMode:"full", purpose:"Manage staff communication", primaryAction:"Send message", dataBoundary:"station", searchable:true },
  { id:"expenses", workspace:"finance", searchAliases:["costs","expense","spending"], mobilePriority:"primary", offlineMode:"full", purpose:"Record and review station expenses", primaryAction:"Record expense", dataBoundary:"finance", supportsOffline:true, searchable:true },
  { id:"regional", workspace:"finance", searchAliases:["compliance","permits","licenses","regulatory"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Compliance and regional controls", primaryAction:"Review compliance", dataBoundary:"station", searchable:true },
  { id:"audit", workspace:"finance", searchAliases:["audit log","history","security events"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Immutable operational audit trail", primaryAction:"Review audit events", dataBoundary:"station", searchable:true },
  { id:"documents", workspace:"business", searchAliases:["files","documents","attachments"], mobilePriority:"primary", offlineMode:"full", purpose:"Store and retrieve station documents", primaryAction:"Upload document", dataBoundary:"content", searchable:true },
  { id:"agreements", workspace:"business", searchAliases:["contracts","agreements"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Manage business agreements", primaryAction:"Open agreement", dataBoundary:"content", searchable:true },
  { id:"webstudio", workspace:"business", searchAliases:["website","web editor","public site"], mobilePriority:"secondary", offlineMode:"full", purpose:"Manage public website content", primaryAction:"Edit site", dataBoundary:"content", searchable:true },
  { id:"news", workspace:"business", searchAliases:["announcements","media","news"], mobilePriority:"utility", offlineMode:"full", purpose:"Manage station news and media", primaryAction:"Publish update", dataBoundary:"content", searchable:true },
  { id:"integration", workspace:"connected", searchAliases:["integrations","connections","providers"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Connect external services", primaryAction:"Test integration", dataBoundary:"system", searchable:true },
  { id:"automation", workspace:"connected", searchAliases:["workflows","scheduled jobs","automation"], mobilePriority:"secondary", offlineMode:"read-only", purpose:"Manage scheduled and event automations", primaryAction:"Review automations", dataBoundary:"system", searchable:true },
  { id:"terminal", workspace:"connected", searchAliases:["device sessions","terminal"], mobilePriority:"utility", offlineMode:"read-only", purpose:"Manage station terminal sessions", primaryAction:"Open terminal session", dataBoundary:"system", searchable:true },
  { id:"fueltypes", workspace:"administration", searchAliases:["fuel configuration","pricing rules","fuel products"], mobilePriority:"primary", offlineMode:"full", purpose:"Configure fuel products and pricing rules", primaryAction:"Manage fuel type", dataBoundary:"station", searchable:true },
  { id:"data", workspace:"administration", searchAliases:["backup","restore","import","export"], mobilePriority:"secondary", offlineMode:"full", purpose:"Manage data import, export and recovery", primaryAction:"Open data tools", dataBoundary:"system", searchable:true },
  { id:"subscription", workspace:"administration", searchAliases:["billing","plan","subscription"], mobilePriority:"utility", offlineMode:"read-only", purpose:"Manage FuelPro subscription", primaryAction:"Review subscription", dataBoundary:"system", searchable:true },
  { id:"settings", workspace:"administration", searchAliases:["configuration","preferences","branding"], mobilePriority:"primary", offlineMode:"full", purpose:"Manage station and account settings", primaryAction:"Open settings", dataBoundary:"system", searchable:true },
  { id:"videogames", workspace:"utilities", searchAliases:["games","entertainment"], mobilePriority:"utility", offlineMode:"read-only", purpose:"Optional station entertainment", primaryAction:"Open games", dataBoundary:"content", searchable:true },
];

export const FEATURE_BY_ID: Record<string, FeatureContract> = Object.fromEntries(
  FEATURE_REGISTRY.map((feature) => [feature.id, feature]),
);

export function getFeatureContract(id: string): FeatureContract | undefined {
  return FEATURE_BY_ID[id];
}
