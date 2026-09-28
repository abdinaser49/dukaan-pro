# DUKAAN PRO

Responsive supermarket operations and POS application built with React, TypeScript, Vite, Tailwind CSS, Lucide, Recharts, Radix primitives, and Supabase.

## Run locally

```sh
npm install
npm run dev
```

Without Supabase environment variables, the app opens in demo mode. Products, sales, and appearance settings persist in the current browser's local storage. Sample product images are loaded from Unsplash.

## Supabase setup

1. Create a Supabase project and copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put a service-role key in a `VITE_` variable.
3. Apply `supabase/migrations/202409280001_initial_schema.sql` in the Supabase SQL editor.
4. Apply `supabase/migrations/202409280002_shops_and_units.sql` after the first migration.
5. Register through the app. After email confirmation/login, `provision_shop_from_signup` creates the shop, Owner profile, main branch, default settings/categories, and unit definitions in one database transaction.
6. The first migration creates the private `product-images` Storage bucket and branch-aware upload/read policies.

With these values configured, Supabase Auth gates the app; branch-scoped products, inventory, and sales are loaded from Postgres and refreshed with Realtime. Product images use private Storage objects and signed URLs. POS checkouts use the `record_sale` database function, which snapshots costs and updates stock, stock history, and audit logs transactionally. Stock adjustments use `adjust_inventory`.

## Current scope

The dashboard, product catalog, inventory adjustments, POS checkout, sales listing/export, customer/supplier views, reports, register, and settings provide a working foundation. Shop onboarding and exact product-specific unit conversion storage are included, with tested decimal conversion/display helpers. POS currently does not yet send selected unit conversions through its transaction RPC; purchases, credit/debt, payments, returns, expenses, employee attendance, reporting aggregation, API server, i18n, subscriptions, and super-admin workflows also require implementation. This is not yet a production-ready ERP.

The initial migration intentionally denies broad client-side financial edits; high-risk transactions should be implemented as validated database functions and tested against a real Supabase project before production use.

## Checks

```sh
npm run build
npm run lint
npm run test
```
