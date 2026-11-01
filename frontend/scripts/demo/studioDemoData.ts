import type { DataModel, ModelColumn, ModelColumnType } from '@workbook/core/model';

/** One row of a data model, keyed by the model property names it feeds. */
export type EntryValues = Readonly<Record<string, string | number | boolean>>;

export type Project = {
  name: string;
  client: string;
  fee: number;
  costBudget: number;
};

export const OVERHEAD_RATE = 0.2;

export const PROJECTS: readonly Project[] = [
  { name: 'Brand refresh', client: 'Juniper Coffee', fee: 18000, costBudget: 12000 },
  { name: 'Online shop', client: 'Northline Outdoors', fee: 32000, costBudget: 14000 },
  { name: 'Annual report', client: 'Harbour Foundation', fee: 14500, costBudget: 10000 },
  { name: 'Product launch', client: 'Solstice Audio', fee: 24000, costBudget: 17000 },
  { name: 'Packaging refresh', client: 'Fernhill Bakery', fee: 9500, costBudget: 7000 },
  { name: 'Website audit', client: 'Kestrel Legal', fee: 7200, costBudget: 5000 },
];

export const TEAM_TIME: readonly EntryValues[] = [
  { Project: 'Brand refresh', Person: 'Maya Chen', Activity: 'Discovery workshop', Hours: 10, 'Hourly Cost': 62, Billable: true },
  { Project: 'Brand refresh', Person: 'Priya Nair', Activity: 'Brand strategy', Hours: 12, 'Hourly Cost': 70, Billable: true },
  { Project: 'Brand refresh', Person: 'Maya Chen', Activity: 'Logo design', Hours: 22, 'Hourly Cost': 62, Billable: true },
  { Project: 'Brand refresh', Person: 'Jonas Weber', Activity: 'Visual system', Hours: 16, 'Hourly Cost': 58, Billable: true },
  { Project: 'Brand refresh', Person: 'Maya Chen', Activity: 'Client revisions', Hours: 8, 'Hourly Cost': 62, Billable: true },
  { Project: 'Online shop', Person: 'Tom Alvarez', Activity: 'Technical discovery', Hours: 18, 'Hourly Cost': 78, Billable: true },
  { Project: 'Online shop', Person: 'Tom Alvarez', Activity: 'Storefront build', Hours: 52, 'Hourly Cost': 78, Billable: true },
  { Project: 'Online shop', Person: 'Maya Chen', Activity: 'Checkout design', Hours: 24, 'Hourly Cost': 62, Billable: true },
  { Project: 'Online shop', Person: 'Jonas Weber', Activity: 'Product page layout', Hours: 14, 'Hourly Cost': 58, Billable: true },
  { Project: 'Online shop', Person: 'Tom Alvarez', Activity: 'QA and launch', Hours: 12, 'Hourly Cost': 78, Billable: true },
  { Project: 'Annual report', Person: 'Jonas Weber', Activity: 'Layout design', Hours: 30, 'Hourly Cost': 58, Billable: true },
  { Project: 'Annual report', Person: 'Priya Nair', Activity: 'Content editing', Hours: 20, 'Hourly Cost': 70, Billable: true },
  { Project: 'Annual report', Person: 'Maya Chen', Activity: 'Cover illustration', Hours: 12, 'Hourly Cost': 62, Billable: true },
  { Project: 'Annual report', Person: 'Jonas Weber', Activity: 'Print proofs', Hours: 6, 'Hourly Cost': 58, Billable: true },
  { Project: 'Product launch', Person: 'Priya Nair', Activity: 'Launch strategy', Hours: 16, 'Hourly Cost': 70, Billable: true },
  { Project: 'Product launch', Person: 'Maya Chen', Activity: 'Campaign design', Hours: 34, 'Hourly Cost': 62, Billable: true },
  { Project: 'Product launch', Person: 'Tom Alvarez', Activity: 'Landing page', Hours: 20, 'Hourly Cost': 78, Billable: true },
  { Project: 'Product launch', Person: 'Maya Chen', Activity: 'Art direction', Hours: 26, 'Hourly Cost': 62, Billable: true },
  { Project: 'Product launch', Person: 'Jonas Weber', Activity: 'Social assets', Hours: 18, 'Hourly Cost': 58, Billable: true },
  { Project: 'Packaging refresh', Person: 'Jonas Weber', Activity: 'Structural design', Hours: 24, 'Hourly Cost': 58, Billable: true },
  { Project: 'Packaging refresh', Person: 'Maya Chen', Activity: 'Label design', Hours: 18, 'Hourly Cost': 62, Billable: true },
  { Project: 'Packaging refresh', Person: 'Jonas Weber', Activity: 'Production files', Hours: 10, 'Hourly Cost': 58, Billable: true },
  { Project: 'Website audit', Person: 'Tom Alvarez', Activity: 'Analytics review', Hours: 10, 'Hourly Cost': 78, Billable: true },
  { Project: 'Website audit', Person: 'Priya Nair', Activity: 'Stakeholder interviews', Hours: 8, 'Hourly Cost': 70, Billable: true },
  { Project: 'Website audit', Person: 'Tom Alvarez', Activity: 'Report writing', Hours: 12, 'Hourly Cost': 78, Billable: true },
];

export const FREELANCE_TIME: readonly EntryValues[] = [
  { Project: 'Brand refresh', Person: 'Rafael Ortiz', Activity: 'Illustration', Hours: 10, 'Hourly Cost': 55, Billable: true },
  { Project: 'Brand refresh', Person: 'Nadia Haddad', Activity: 'Studio photography', Hours: 6, 'Hourly Cost': 65, Billable: true },
  { Project: 'Online shop', Person: 'Nadia Haddad', Activity: 'Product photography', Hours: 12, 'Hourly Cost': 65, Billable: true },
  { Project: 'Online shop', Person: 'Ines Duarte', Activity: 'Product descriptions', Hours: 8, 'Hourly Cost': 48, Billable: false },
  { Project: 'Annual report', Person: 'Ines Duarte', Activity: 'Copywriting', Hours: 14, 'Hourly Cost': 48, Billable: true },
  { Project: 'Annual report', Person: 'Rafael Ortiz', Activity: 'Charts', Hours: 8, 'Hourly Cost': 55, Billable: true },
  { Project: 'Product launch', Person: 'Ines Duarte', Activity: 'Campaign copy', Hours: 12, 'Hourly Cost': 48, Billable: true },
  { Project: 'Product launch', Person: 'Rafael Ortiz', Activity: 'Key visuals', Hours: 16, 'Hourly Cost': 55, Billable: true },
  { Project: 'Packaging refresh', Person: 'Rafael Ortiz', Activity: 'Illustration', Hours: 6, 'Hourly Cost': 55, Billable: true },
  { Project: 'Website audit', Person: 'Ines Duarte', Activity: 'Report editing', Hours: 5, 'Hourly Cost': 48, Billable: true },
];

export const EXPENSES: readonly EntryValues[] = [
  { Project: 'Brand refresh', Supplier: 'Studio North', Category: 'Photography', Quantity: 1, 'Unit Cost': 1200 },
  { Project: 'Brand refresh', Supplier: 'Vellum Print', Category: 'Print proofs', Quantity: 3, 'Unit Cost': 180 },
  { Project: 'Brand refresh', Supplier: 'Type Foundry', Category: 'Font licence', Quantity: 1, 'Unit Cost': 260 },
  { Project: 'Online shop', Supplier: 'Shopify', Category: 'Platform setup', Quantity: 1, 'Unit Cost': 480 },
  { Project: 'Online shop', Supplier: 'Pixelstock', Category: 'Product imagery', Quantity: 12, 'Unit Cost': 45 },
  { Project: 'Online shop', Supplier: 'Stripe', Category: 'Payment integration', Quantity: 1, 'Unit Cost': 350 },
  { Project: 'Online shop', Supplier: 'Studio North', Category: 'Lifestyle shoot', Quantity: 1, 'Unit Cost': 1650 },
  { Project: 'Annual report', Supplier: 'Vellum Print', Category: 'Print run', Quantity: 1, 'Unit Cost': 2850 },
  { Project: 'Annual report', Supplier: 'Type Foundry', Category: 'Editorial font licence', Quantity: 1, 'Unit Cost': 180 },
  { Project: 'Product launch', Supplier: 'Studio North', Category: 'Launch film', Quantity: 1, 'Unit Cost': 9600 },
  { Project: 'Product launch', Supplier: 'Adstream', Category: 'Paid social', Quantity: 1, 'Unit Cost': 3600 },
  { Project: 'Product launch', Supplier: 'Pixelstock', Category: 'Stock assets', Quantity: 30, 'Unit Cost': 38 },
  { Project: 'Packaging refresh', Supplier: 'Carton Co', Category: 'Packaging samples', Quantity: 6, 'Unit Cost': 90 },
  { Project: 'Packaging refresh', Supplier: 'Vellum Print', Category: 'Label proofs', Quantity: 2, 'Unit Cost': 120 },
  { Project: 'Website audit', Supplier: 'Hotjar', Category: 'Analytics tools', Quantity: 1, 'Unit Cost': 240 },
];

const manual = (id: string, name: string, type: ModelColumnType): ModelColumn => ({ id, name, kind: 'manual', type });
const calculated = (id: string, name: string, type: ModelColumnType, formula: string): ModelColumn => ({ id, name, kind: 'calculated', type, formula });

/** Labour cost and billable hours are declared once and apply to every row of both time sheets. */
export const TIME_ENTRY_MODEL: DataModel = {
  id: '10000000-0000-4000-8000-000000000100',
  name: 'Time Entry',
  columns: [
    manual('10000000-0000-4000-8000-000000000101', 'Project', 'string'),
    manual('10000000-0000-4000-8000-000000000102', 'Person', 'string'),
    manual('10000000-0000-4000-8000-000000000103', 'Activity', 'string'),
    manual('10000000-0000-4000-8000-000000000104', 'Hours', 'float'),
    manual('10000000-0000-4000-8000-000000000105', 'Hourly Cost', 'float'),
    manual('10000000-0000-4000-8000-000000000106', 'Billable', 'boolean'),
    calculated('10000000-0000-4000-8000-000000000107', 'Labour Cost', 'float', "=@Hours[1]*@'Hourly Cost'[1]"),
    calculated('10000000-0000-4000-8000-000000000108', 'Billable Hours', 'float', '=IF(@Billable[1], @Hours[1], 0)'),
  ],
};

export const PROJECT_EXPENSE_MODEL: DataModel = {
  id: '10000000-0000-4000-8000-000000000200',
  name: 'Project Expense',
  columns: [
    manual('10000000-0000-4000-8000-000000000201', 'Project', 'string'),
    manual('10000000-0000-4000-8000-000000000202', 'Supplier', 'string'),
    manual('10000000-0000-4000-8000-000000000203', 'Category', 'string'),
    manual('10000000-0000-4000-8000-000000000204', 'Quantity', 'int'),
    manual('10000000-0000-4000-8000-000000000205', 'Unit Cost', 'float'),
    calculated('10000000-0000-4000-8000-000000000206', 'Amount', 'float', "=@Quantity[1]*@'Unit Cost'[1]"),
  ],
};
