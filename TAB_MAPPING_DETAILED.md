# Detailed Tab-to-Category Mapping

## Current Tab → New Category Mapping

This document provides the exact mapping from your current 36+ tabs to the proposed 7-category architecture.

### TabConfiguration Interface Extension

Add this to `/workspace/src/react-app/context/FuelContext.tsx`:

```typescript
export type TabCategory = 
  | 'dashboard'
  | 'operations'
  | 'sales_customers'
  | 'finance'
  | 'reports_analytics'
  | 'administration'
  | 'resources';

export interface TabConfiguration {
  id: string;
  label: string;
  originalLabel: string;
  description: string;
  order: number;
  visible: boolean;
  category?: TabCategory;  // NEW FIELD
  icon?: string;           // Already exists in iconMap
}
```

### Complete Mapping Table

| Current Tab ID | Current Label | New Category | New Sub-Tab Position | Priority | Notes |
|----------------|---------------|--------------|---------------------|----------|-------|
| `dashboard` | Dashboard | **dashboard** | 1 (default) | Critical | Keep as landing page |
| `pos` | Point of Sale | **operations** | 1 | Critical | Most-used feature |
| `sales` | Sales Tracking | **operations** | 5 | High | Daily pump tracking |
| `livetransaction` | Live Transaction | **operations** | 6 | High | Real-time monitoring |
| `offloading` | Fuel Offloading | **operations** | 2 | Critical | Tanker receipt entry |
| `delivery` | Fuel Statement Report | **operations** | 3 | High | Customer deliveries |
| `inventory` | Stock Management | **operations** | 4 | High | Inventory control |
| `terminal` | Terminal Sessions | **operations** | 7 | Medium | Shift management |
| `maintenance` | Maintenance | **operations** | 8 | Medium | Equipment upkeep |
| `invoice` | Invoice | **sales_customers** | 3 | High | B2B invoicing |
| `credit` | Credit | **sales_customers** | 2 | High | Debtors/Receivables |
| `customers` | Customers | **sales_customers** | 1 | High | Loyalty program |
| `fuelsalesreport` | Fuel Sales Report | **sales_customers** | 4 | Medium | Sales analytics |
| `mpesa` | M-PESA Analyzer | **finance** | 1 | High (KE/TZ) | Mobile money |
| `payroll` | Payroll System | **finance** | 3 | Medium | Staff payments |
| `expenses` | Expenses | **finance** | 2 | High | Operational costs |
| `suppliers` | Supplier Management | **finance** | 4 | Medium | Vendor payments |
| `projtime` | Projects & Time | **finance** | 5 | Low | Billable hours |
| `reports` | Reports Center | **reports_analytics** | 1 | High | All reports hub |
| `analytics` | Analytics | **reports_analytics** | 2 | Medium | BI & predictions |
| `audit` | Audit Trail | **reports_analytics** | 3 | Medium | Compliance log |
| `pumpmapping` | Pump Mapping V1 | **reports_analytics** | 4 | Low | AI ledger parsing |
| `price-finder` | Fuel Price Finder | **reports_analytics** | 5 | Low | GPS price locator |
| `team` | Team Manager | **administration** | 1 | High | Staff management |
| `fueltypes` | Fuel Type Manager | **administration** | 2 | High | Products & pricing |
| `documents` | Document Center | **administration** | 3 | Medium | File management |
| `integration` | Integration Hub | **administration** | 4 | Medium | Payment/KRA setup |
| `regional` | Compliance | **administration** | 5 | Medium | Regional regulations |
| `automation` | Automation Engine | **administration** | 6 | Low | Auto-tasks |
| `settings` | Settings | **administration** | 7 | Critical | System config |
| `communication` | Communication | **resources** | 1 | Low | CRM/messaging |
| `data` | Data Manager | **resources** | 2 | Medium | Backup/restore |
| `news` | News | **resources** | 3 | Low | Industry updates |
| `subscription` | Subscription | **resources** | 4 | Medium | Billing/plans |
| `agreements` | Agreements | **resources** | 5 | Low | Contracts |
| `webstudio` | Web Studio | **resources** | 6 | Low | Website CMS |
| `videogames` | Video Games | **resources** | 7 | Low | Entertainment |

## Deprecated/Merged Tabs

These tabs should be removed as standalone and merged into parent features:

| Deprecated Tab | Merge Into | Implementation |
|----------------|------------|----------------|
| `priceboard` | `fueltypes` | Sub-tab in Fuel Type Manager |
| `shifts` | `team` | Sub-tab in Team Manager |
| `quality` | `fueltypes` | Sub-tab for fuel testing |
| `docconverter` | `documents` | Tool within Document Center |
| `purchases` | `suppliers` | Sub-tab for purchase orders |
| `sales-invoices` | `invoice` | Sub-tab for invoice archive |
| `debt` | `credit` | Already merged |
| `integrations-settings` | `integration` | Already merged |

## Category Definitions with Icons

```typescript
const CATEGORIES = {
  dashboard: {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: 'Overview & quick actions',
    color: 'blue',
  },
  operations: {
    id: 'operations',
    label: 'Operations',
    icon: Truck,
    description: 'Daily station activities',
    color: 'green',
  },
  sales_customers: {
    id: 'sales_customers',
    label: 'Sales',
    icon: ShoppingCart,
    description: 'Revenue & customers',
    color: 'purple',
  },
  finance: {
    id: 'finance',
    label: 'Finance',
    icon: Wallet,
    description: 'Money & payroll',
    color: 'emerald',
  },
  reports_analytics: {
    id: 'reports_analytics',
    label: 'Reports',
    icon: BarChart3,
    description: 'Analytics & insights',
    color: 'orange',
  },
  administration: {
    id: 'administration',
    label: 'Admin',
    icon: Settings,
    description: 'System configuration',
    color: 'gray',
  },
  resources: {
    id: 'resources',
    label: 'Resources',
    icon: Folder,
    description: 'Support & tools',
    color: 'cyan',
  },
};
```

## URL Structure for Deep Linking

Maintain backward compatibility while supporting new structure:

```
Old: /?tab=pos
New: /?category=operations&tab=pos

Backward Compatible:
- If old `tab` param exists without `category`, auto-resolve category
- Redirect: /?tab=mpesa → /?category=finance&tab=mpesa
```

## User Preference: Classic vs New View

```typescript
interface UserPreferences {
  // ... existing fields
  navigationView?: 'classic' | 'categorized'; // Default: 'categorized' for new users
}
```

## Rollout Strategy

### Week 1-2: Foundation
- [ ] Add `category` field to TabConfiguration
- [ ] Update all existing tab configs with category assignments
- [ ] Create CategoryNavigation component

### Week 3-4: UI Implementation
- [ ] Build two-level navigation (Categories → Sub-tabs)
- [ ] Implement sub-tab bar using existing SubTabBar component
- [ ] Add smooth transitions between categories

### Week 5-6: User Testing
- [ ] A/B test with 10% of users
- [ ] Gather feedback on findability
- [ ] Adjust category names if needed

### Week 7-8: Full Rollout
- [ ] Enable for all new users by default
- [ ] Provide toggle for "Classic View"
- [ ] Deprecate classic view after 90 days

## Success Metrics

Track these metrics to measure improvement:

1. **Time to First Action**: How long until new user completes first transaction
2. **Feature Discovery Rate**: % of users who find key features within first session
3. **Navigation Clicks**: Average clicks to reach commonly-used features
4. **Support Tickets**: Reduction in "where do I find..." tickets
5. **User Satisfaction**: NPS score improvement

