import { mysqlTable, mysqlSchema, AnyMySqlColumn, bigint, varchar, text, timestamp, mysqlEnum, decimal } from "drizzle-orm/mysql-core"
import { sql } from "drizzle-orm"

export const additionalPaymentMethods = mysqlTable("additional_payment_methods", {
	id: bigint({ mode: "number", unsigned: true }).autoincrement().notNull(),
	stationId: bigint({ mode: "number", unsigned: true }),
	userId: bigint({ mode: "number", unsigned: true }),
	name: varchar({ length: 255 }).notNull(),
	config: text(),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const auditLogs = mysqlTable("audit_logs", {
	id: bigint({ mode: "number", unsigned: true }).autoincrement().notNull(),
	userId: bigint({ mode: "number", unsigned: true }).notNull(),
	stationId: bigint({ mode: "number", unsigned: true }),
	event: varchar({ length: 255 }).notNull(),
	detail: text(),
	severity: mysqlEnum(['info','success','warning','danger']).default('info').notNull(),
	ipAddress: varchar({ length: 45 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const bankAccounts = mysqlTable("bank_accounts", {
	id: bigint({ mode: "number", unsigned: true }).autoincrement().notNull(),
	stationId: bigint({ mode: "number", unsigned: true }),
	userId: bigint({ mode: "number", unsigned: true }),
	bankName: varchar({ length: 255 }).notNull(),
	accountName: varchar({ length: 255 }).notNull(),
	accountNumber: varchar({ length: 100 }).notNull(),
	branch: varchar({ length: 255 }),
	currency: varchar({ length: 10 }).default('USD').notNull(),
	countryCode: varchar({ length: 2 }),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const founderSessions = mysqlTable("founder_sessions", {
	id: bigint({ mode: "number", unsigned: true }).autoincrement().notNull(),
	userId: bigint({ mode: "number", unsigned: true }).notNull(),
	lastLoginAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	twoFactorEnabled: tinyint().default(0).notNull(),
	twoFactorSecret: varchar({ length: 255 }),
	contactEmail: varchar({ length: 320 }),
	contactPhone: varchar({ length: 50 }),
	passwordHash: varchar({ length: 500 }),
	updatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const inventory = mysqlTable("inventory", {
	id: bigint({ mode: "number", unsigned: true }).autoincrement().notNull(),
	stationId: bigint({ mode: "number", unsigned: true }).notNull(),
	fuelType: mysqlEnum(['petrol','diesel','premium','kerosene','lpg']).notNull(),
	currentStock: decimal({ precision: 12, scale: 2 }).default('0').notNull(),
	capacity: decimal({ precision: 12, scale: 2 }).default('0').notNull(),
	pricePerLiter: decimal({ precision: 10, scale: 2 }).default('0').notNull(),
	costPerLiter: decimal({ precision: 10, scale: 2 }).default('0').notNull(),
	supplierName: varchar({ length: 255 }),
	lastRestockedAt: timestamp({ mode: 'string' }),
	alertThreshold: decimal({ precision: 12, scale: 2 }).default('500').notNull(),
	updatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const mobileMoneyConfigs = mysqlTable("mobile_money_configs", {
	id: bigint({ mode: "number", unsigned: true }).autoincrement().notNull(),
	stationId: bigint({ mode: "number", unsigned: true }),
	userId: bigint({ mode: "number", unsigned: true }),
	provider: varchar({ length: 255 }).notNull(),
	paybillNumber: varchar({ length: 100 }),
	accountReference: varchar({ length: 100 }),
	apiKey: varchar({ length: 500 }),
	shortCode: varchar({ length: 50 }),
	countryCode: varchar({ length: 2 }),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const sales = mysqlTable("sales", {
	id: bigint({ mode: "number", unsigned: true }).autoincrement().notNull(),
	stationId: bigint({ mode: "number", unsigned: true }).notNull(),
	userId: bigint({ mode: "number", unsigned: true }),
	fuelType: mysqlEnum(['petrol','diesel','premium','kerosene','lpg']).notNull(),
	quantityLiters: decimal({ precision: 12, scale: 2 }).notNull(),
	pricePerLiter: decimal({ precision: 10, scale: 2 }).notNull(),
	subtotal: decimal({ precision: 12, scale: 2 }).notNull(),
	taxAmount: decimal({ precision: 12, scale: 2 }).default('0').notNull(),
	total: decimal({ precision: 12, scale: 2 }).notNull(),
	paymentMethod: varchar({ length: 100 }).notNull(),
	pumpNumber: varchar({ length: 20 }),
	receiptNumber: varchar({ length: 50 }),
	notes: text(),
	latitude: decimal({ precision: 10, scale: 8 }),
	longitude: decimal({ precision: 11, scale: 8 }),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const stationUsers = mysqlTable("station_users", {
	id: bigint({ mode: "number", unsigned: true }).autoincrement().notNull(),
	stationId: bigint({ mode: "number", unsigned: true }).notNull(),
	userId: bigint({ mode: "number", unsigned: true }).notNull(),
	stationRole: mysqlEnum(['owner','manager','cashier','viewer']).default('viewer').notNull(),
	isActive: tinyint().default(1).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const stations = mysqlTable("stations", {
	id: bigint({ mode: "number", unsigned: true }).autoincrement().notNull(),
	name: varchar({ length: 255 }).notNull(),
	code: varchar({ length: 50 }).notNull(),
	location: varchar({ length: 500 }),
	latitude: decimal({ precision: 10, scale: 8 }),
	longitude: decimal({ precision: 11, scale: 8 }),
	country: varchar({ length: 100 }),
	countryCode: varchar({ length: 2 }),
	phone: varchar({ length: 50 }),
	managerName: varchar({ length: 255 }),
	status: mysqlEnum(['active','inactive','maintenance']).default('active').notNull(),
	taxRate: decimal({ precision: 5, scale: 2 }).default('0').notNull(),
	receiptFooter: text(),
	createdBy: bigint({ mode: "number", unsigned: true }).notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});

export const users = mysqlTable("users", {
	id: bigint({ mode: "number", unsigned: true }).autoincrement().notNull(),
	unionId: varchar({ length: 255 }).notNull(),
	name: varchar({ length: 255 }),
	email: varchar({ length: 320 }),
	avatar: text(),
	role: mysqlEnum(['user','admin']).default('user').notNull(),
	createdAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	updatedAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
	lastSignInAt: timestamp({ mode: 'string' }).default('CURRENT_TIMESTAMP').notNull(),
});
