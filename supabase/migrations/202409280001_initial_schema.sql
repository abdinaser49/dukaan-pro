create extension if not exists pgcrypto;
create type public.app_role as enum ('super_admin', 'owner', 'manager', 'cashier', 'inventory_manager', 'accountant');

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  location text not null,
  phone text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.branches (
  id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null, address text, phone text,
  currency_code char(3) not null default 'USD', is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (shop_id, name)
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  full_name text not null default '', role public.app_role not null default 'cashier',
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null, image_url text, is_active boolean not null default true, created_at timestamptz not null default now(), unique (branch_id, name)
);
create table public.brands (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null, logo_url text, description text, is_active boolean not null default true, created_at timestamptz not null default now(), unique (branch_id, name)
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null, company text, phone text, email text, address text, notes text,
  archived_at timestamptz, created_at timestamptz not null default now()
);
create table public.customers (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null, phone text, email text, address text,
  customer_type text not null default 'regular' check (customer_type in ('regular', 'wholesale', 'vip')),
  archived_at timestamptz, created_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null, brand_id uuid references public.brands(id) on delete set null,
  name text not null, description text, sku text not null, barcode text, unit text not null default 'Each',
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  selling_price numeric(14,2) not null default 0 check (selling_price >= 0),
  wholesale_price numeric(14,2) check (wholesale_price is null or wholesale_price >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  minimum_stock numeric(14,3) not null default 0 check (minimum_stock >= 0), maximum_stock numeric(14,3),
  has_expiry boolean not null default false, expiry_date date, image_path text, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (branch_id, sku), unique (branch_id, barcode), unique (branch_id, id)
);
create table public.shop_units (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  code text not null,
  display_name text not null,
  unit_family text not null check (unit_family in ('weight', 'liquid', 'count', 'length', 'container', 'custom')),
  base_unit text not null,
  base_factor numeric(24,6) not null check (base_factor > 0),
  is_system boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, code)
);
create table public.product_unit_conversions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  unit_id uuid not null references public.shop_units(id) on delete restrict,
  base_unit text not null,
  base_quantity_per_unit numeric(24,6) not null check (base_quantity_per_unit > 0),
  is_purchase_unit boolean not null default false,
  is_sale_unit boolean not null default false,
  is_base_unit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, unit_id),
  foreign key (branch_id, product_id) references public.products(branch_id, id) on delete cascade
);
create table public.product_images (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null, alt_text text, sort_order integer not null default 0, created_at timestamptz not null default now(), unique (product_id, storage_path)
);
create table public.inventory (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade, warehouse text not null default 'Main warehouse', shelf text,
  quantity numeric(14,3) not null default 0 check (quantity >= 0), updated_at timestamptz not null default now(),
  unique (branch_id, product_id, warehouse, shelf)
);
create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict, user_id uuid references public.profiles(id) on delete set null,
  transaction_type text not null check (transaction_type in ('sale', 'return', 'purchase', 'adjustment', 'stock_in', 'stock_out', 'transfer')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0), unit_cost numeric(14,2),
  reference text, reason text, notes text, created_at timestamptz not null default now()
);
create table public.purchases (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict, created_by uuid references public.profiles(id) on delete set null,
  invoice_number text not null, status text not null default 'draft' check (status in ('draft', 'ordered', 'received', 'partially_paid', 'paid', 'cancelled')),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0), discount numeric(14,2) not null default 0 check (discount >= 0),
  tax numeric(14,2) not null default 0 check (tax >= 0), total numeric(14,2) not null default 0 check (total >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0), notes text, purchased_at timestamptz not null default now(),
  received_at timestamptz, archived_at timestamptz, unique (branch_id, invoice_number)
);
create table public.purchase_items (
  id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict, quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0), discount numeric(14,2) not null default 0 check (discount >= 0),
  tax numeric(14,2) not null default 0 check (tax >= 0), line_total numeric(14,2) not null check (line_total >= 0)
);
create table public.sales (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null, cashier_id uuid references public.profiles(id) on delete set null,
  invoice_number text not null, status text not null default 'completed' check (status in ('completed', 'pending', 'voided', 'partially_returned', 'returned')),
  subtotal numeric(14,2) not null check (subtotal >= 0), discount numeric(14,2) not null default 0 check (discount >= 0),
  tax numeric(14,2) not null default 0 check (tax >= 0), total numeric(14,2) not null check (total >= 0),
  cost_total numeric(14,2) not null default 0 check (cost_total >= 0),
  payment_method text not null check (payment_method in ('cash', 'card', 'mobile_money', 'bank', 'mixed', 'credit')),
  amount_received numeric(14,2) not null default 0 check (amount_received >= 0), change_due numeric(14,2) not null default 0 check (change_due >= 0),
  notes text, sold_at timestamptz not null default now(), archived_at timestamptz, unique (branch_id, invoice_number)
);
create table public.sale_items (
  id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict, product_name text not null, sku text not null,
  quantity numeric(14,3) not null check (quantity > 0), unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0), discount numeric(14,2) not null default 0 check (discount >= 0),
  tax numeric(14,2) not null default 0 check (tax >= 0), line_total numeric(14,2) not null check (line_total >= 0),
  returned_quantity numeric(14,3) not null default 0 check (returned_quantity between 0 and quantity)
);
create table public.sale_returns (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete restrict, processed_by uuid references public.profiles(id) on delete set null,
  refund_method text not null, refund_total numeric(14,2) not null check (refund_total >= 0), reason text not null, created_at timestamptz not null default now()
);
create table public.sale_return_items (
  id uuid primary key default gen_random_uuid(), sale_return_id uuid not null references public.sale_returns(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id) on delete restrict, quantity numeric(14,3) not null check (quantity > 0),
  refund_amount numeric(14,2) not null check (refund_amount >= 0)
);
create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict, purchase_id uuid references public.purchases(id) on delete set null,
  recorded_by uuid references public.profiles(id) on delete set null, amount numeric(14,2) not null check (amount > 0),
  payment_method text not null, reference text, notes text, paid_at timestamptz not null default now()
);
create table public.customer_payments (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict, sale_id uuid references public.sales(id) on delete set null,
  recorded_by uuid references public.profiles(id) on delete set null, amount numeric(14,2) not null check (amount > 0),
  payment_method text not null, reference text, notes text, paid_at timestamptz not null default now()
);
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null, is_active boolean not null default true, unique (branch_id, name)
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  category_id uuid references public.expense_categories(id) on delete set null, recorded_by uuid references public.profiles(id) on delete set null,
  title text not null, amount numeric(14,2) not null check (amount > 0), payment_method text not null,
  receipt_path text, description text, spent_at timestamptz not null default now(), archived_at timestamptz
);
create table public.employees (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null, full_name text not null, phone text, email text,
  salary numeric(14,2) check (salary is null or salary >= 0), hire_date date, photo_path text,
  is_active boolean not null default true, created_at timestamptz not null default now()
);
create table public.attendance (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade, checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz, notes text, check (checked_out_at is null or checked_out_at >= checked_in_at)
);
create table public.cash_registers (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  opened_by uuid not null references public.profiles(id) on delete restrict, closed_by uuid references public.profiles(id) on delete set null,
  opening_balance numeric(14,2) not null check (opening_balance >= 0), expected_cash numeric(14,2), actual_cash numeric(14,2),
  difference numeric(14,2), opened_at timestamptz not null default now(), closed_at timestamptz,
  check (closed_at is null or closed_at >= opened_at)
);
create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  register_id uuid not null references public.cash_registers(id) on delete restrict, sale_id uuid references public.sales(id) on delete set null,
  recorded_by uuid references public.profiles(id) on delete set null,
  transaction_type text not null check (transaction_type in ('sale', 'expense', 'refund', 'deposit', 'withdrawal')),
  amount numeric(14,2) not null check (amount >= 0), description text, created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade, notification_type text not null,
  title text not null, message text not null, read_at timestamptz, created_at timestamptz not null default now()
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null, action text not null, module text not null,
  record_id uuid, old_value jsonb, new_value jsonb, created_at timestamptz not null default now()
);
create table public.settings (
  id uuid primary key default gen_random_uuid(), branch_id uuid not null references public.branches(id) on delete cascade,
  setting_key text not null, setting_value jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(),
  unique (branch_id, setting_key)
);

create index products_branch_name_idx on public.products (branch_id, name) where archived_at is null;
create index products_barcode_idx on public.products (branch_id, barcode) where barcode is not null;
create index inventory_low_stock_idx on public.inventory (branch_id, quantity, product_id);
create index inventory_transactions_product_date_idx on public.inventory_transactions (branch_id, product_id, created_at desc);
create index sales_branch_date_idx on public.sales (branch_id, sold_at desc) where archived_at is null;
create index sales_customer_idx on public.sales (branch_id, customer_id, sold_at desc);
create index purchases_supplier_date_idx on public.purchases (branch_id, supplier_id, purchased_at desc);
create index audit_logs_branch_date_idx on public.audit_logs (branch_id, created_at desc);
create index notifications_unread_idx on public.notifications (branch_id, user_id, created_at desc) where read_at is null;

create or replace function public.has_branch_access(target_branch uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and (p.role = 'super_admin' or p.branch_id = target_branch)); $$;
create or replace function public.can_manage_branch(target_branch uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and (p.role = 'super_admin' or (p.branch_id = target_branch and p.role in ('owner', 'manager')))); $$;
create or replace function public.can_write_branch_table(target_branch uuid, target_table text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and (p.role = 'super_admin' or (p.branch_id = target_branch and (p.role = 'owner' or p.role = any (
        case target_table
          when 'categories' then array['manager','inventory_manager']::public.app_role[]
          when 'brands' then array['manager','inventory_manager']::public.app_role[]
          when 'products' then array['manager','inventory_manager']::public.app_role[]
          when 'inventory' then array['manager','inventory_manager']::public.app_role[]
          when 'suppliers' then array['manager','inventory_manager']::public.app_role[]
          when 'purchases' then array['manager','inventory_manager']::public.app_role[]
          when 'customers' then array['manager','cashier']::public.app_role[]
          when 'employees' then array['manager']::public.app_role[]
          when 'attendance' then array['manager','cashier']::public.app_role[]
          when 'settings' then array['manager']::public.app_role[]
          else array[]::public.app_role[]
        end
      ))))
  );
$$;
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role = 'super_admin'); $$;
create or replace function public.has_shop_access(target_shop uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and (p.role = 'super_admin' or p.shop_id = target_shop)); $$;
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger shops_updated_at before update on public.shops for each row execute function public.set_updated_at();
create trigger branches_updated_at before update on public.branches for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
create policy "read own profile or super admin" on public.profiles for select to authenticated using (id = auth.uid() or public.is_super_admin());
create policy "managers update branch profiles" on public.profiles for update to authenticated using (public.can_manage_branch(branch_id)) with check (public.can_manage_branch(branch_id));
alter table public.shops enable row level security;
create policy "shop members read their shop" on public.shops for select to authenticated using (public.has_shop_access(id));
create policy "shop owners update their shop" on public.shops for update to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.shop_id = id and p.role = 'owner')) with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.shop_id = id and p.role = 'owner'));
alter table public.branches enable row level security;
create policy "members read assigned branch" on public.branches for select to authenticated using (public.has_branch_access(id));
create policy "super admins manage branches" on public.branches for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

do $$
declare table_name text;
begin
  foreach table_name in array array['categories','brands','suppliers','customers','products','product_unit_conversions','inventory','inventory_transactions','purchases','sales','sale_returns','supplier_payments','customer_payments','expense_categories','expenses','employees','attendance','cash_registers','cash_transactions','notifications','audit_logs','settings'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy "branch read %1$s" on public.%1$I for select to authenticated using (public.has_branch_access(branch_id))', table_name);
  end loop;
  foreach table_name in array array['categories','brands','suppliers','customers','products','product_unit_conversions','inventory','purchases','employees','attendance','settings'] loop
    execute format('create policy "branch role write %1$s" on public.%1$I for all to authenticated using (public.can_write_branch_table(branch_id, %2$L)) with check (public.can_write_branch_table(branch_id, %2$L))', table_name, table_name);
  end loop;
end $$;

alter table public.purchase_items enable row level security;
create policy "branch read purchase items" on public.purchase_items for select to authenticated using (exists (select 1 from public.purchases p where p.id = purchase_id and public.has_branch_access(p.branch_id)));
create policy "managers write purchase items" on public.purchase_items for all to authenticated using (exists (select 1 from public.purchases p where p.id = purchase_id and public.can_manage_branch(p.branch_id))) with check (exists (select 1 from public.purchases p where p.id = purchase_id and public.can_manage_branch(p.branch_id)));
alter table public.sale_items enable row level security;
create policy "branch read sale items" on public.sale_items for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id and public.has_branch_access(s.branch_id)));
alter table public.sale_return_items enable row level security;
create policy "branch read return items" on public.sale_return_items for select to authenticated using (exists (select 1 from public.sale_returns r where r.id = sale_return_id and public.has_branch_access(r.branch_id)));
create policy "managers write return items" on public.sale_return_items for all to authenticated using (exists (select 1 from public.sale_returns r where r.id = sale_return_id and public.can_manage_branch(r.branch_id))) with check (exists (select 1 from public.sale_returns r where r.id = sale_return_id and public.can_manage_branch(r.branch_id)));
alter table public.product_images enable row level security;
create policy "branch read product images" on public.product_images for select to authenticated using (exists (select 1 from public.products p where p.id = product_id and public.has_branch_access(p.branch_id)));
create policy "managers write product images" on public.product_images for all to authenticated using (exists (select 1 from public.products p where p.id = product_id and public.can_manage_branch(p.branch_id))) with check (exists (select 1 from public.products p where p.id = product_id and public.can_manage_branch(p.branch_id)));

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

create or replace function public.record_sale(
  p_branch_id uuid,
  p_customer_id uuid,
  p_payment_method text,
  p_amount_received numeric,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  product_row public.products%rowtype;
  inventory_row public.inventory%rowtype;
  item_quantity numeric(14,3);
  item_discount numeric(14,2);
  line_subtotal numeric(14,2);
  line_tax numeric(14,2);
  subtotal numeric(14,2) := 0;
  discount_total numeric(14,2) := 0;
  tax_total numeric(14,2) := 0;
  cost_total numeric(14,2) := 0;
  grand_total numeric(14,2);
  invoice text;
  new_sale_id uuid;
begin
  if not public.has_branch_access(p_branch_id) then
    raise exception 'You do not have access to this branch';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A sale must contain at least one item';
  end if;
  if p_payment_method not in ('cash', 'card', 'mobile_money', 'bank', 'mixed', 'credit') then
    raise exception 'Unsupported payment method';
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    select * into product_row from public.products
      where id = (item->>'product_id')::uuid and branch_id = p_branch_id and archived_at is null;
    if not found then raise exception 'Product is unavailable in this branch'; end if;
    item_quantity := (item->>'quantity')::numeric;
    item_discount := coalesce((item->>'discount')::numeric, 0);
    if item_quantity <= 0 or item_discount < 0 or item_discount > product_row.selling_price * item_quantity then
      raise exception 'Invalid sale quantity or discount';
    end if;
    line_subtotal := product_row.selling_price * item_quantity;
    line_tax := (line_subtotal - item_discount) * product_row.tax_rate / 100;
    subtotal := subtotal + line_subtotal;
    discount_total := discount_total + item_discount;
    tax_total := tax_total + line_tax;
    cost_total := cost_total + product_row.cost_price * item_quantity;
  end loop;
  grand_total := subtotal - discount_total + tax_total;
  if p_payment_method = 'cash' and coalesce(p_amount_received, 0) < grand_total then
    raise exception 'Amount received is less than the sale total';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id and branch_id = p_branch_id
  ) then
    raise exception 'Customer is not available in this branch';
  end if;

  invoice := 'INV-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  insert into public.sales (branch_id, customer_id, cashier_id, invoice_number, subtotal, discount, tax, total, cost_total, payment_method, amount_received, change_due)
  values (p_branch_id, p_customer_id, auth.uid(), invoice, subtotal, discount_total, tax_total, grand_total, cost_total,
    p_payment_method, coalesce(p_amount_received, grand_total), greatest(0, coalesce(p_amount_received, grand_total) - grand_total))
  returning id into new_sale_id;

  for item in select value from jsonb_array_elements(p_items) loop
    select * into product_row from public.products where id = (item->>'product_id')::uuid and branch_id = p_branch_id;
    item_quantity := (item->>'quantity')::numeric;
    item_discount := coalesce((item->>'discount')::numeric, 0);
    select * into inventory_row from public.inventory
      where branch_id = p_branch_id and product_id = product_row.id and quantity >= item_quantity
      order by updated_at desc limit 1 for update;
    if not found then raise exception 'Insufficient stock for %', product_row.name; end if;

    line_subtotal := product_row.selling_price * item_quantity;
    line_tax := (line_subtotal - item_discount) * product_row.tax_rate / 100;
    insert into public.sale_items (sale_id, product_id, product_name, sku, quantity, unit_price, unit_cost, discount, tax, line_total)
    values (new_sale_id, product_row.id, product_row.name, product_row.sku, item_quantity, product_row.selling_price,
      product_row.cost_price, item_discount, line_tax, line_subtotal - item_discount + line_tax);
    update public.inventory set quantity = quantity - item_quantity, updated_at = now() where id = inventory_row.id;
    insert into public.inventory_transactions (branch_id, product_id, user_id, transaction_type, quantity_delta, unit_cost, reference)
    values (p_branch_id, product_row.id, auth.uid(), 'sale', -item_quantity, product_row.cost_price, invoice);
  end loop;

  insert into public.audit_logs (branch_id, user_id, action, module, record_id, new_value)
  values (p_branch_id, auth.uid(), 'sale.completed', 'sales', new_sale_id, jsonb_build_object('invoice', invoice, 'total', grand_total));
  return jsonb_build_object('id', new_sale_id, 'invoice_number', invoice, 'total', grand_total, 'cost_total', cost_total, 'profit', grand_total - tax_total - cost_total);
end;
$$;

revoke all on function public.record_sale(uuid, uuid, text, numeric, jsonb) from public;
grant execute on function public.record_sale(uuid, uuid, text, numeric, jsonb) to authenticated;

create or replace function public.adjust_inventory(
  p_branch_id uuid,
  p_product_id uuid,
  p_quantity_delta numeric,
  p_reason text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  inventory_row public.inventory%rowtype;
  new_quantity numeric(14,3);
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.branch_id = p_branch_id
      and p.role in ('super_admin', 'manager', 'inventory_manager')
  ) then
    raise exception 'You do not have permission to adjust this branch inventory';
  end if;
  if p_quantity_delta = 0 then raise exception 'Adjustment quantity must not be zero'; end if;
  select * into inventory_row from public.inventory
    where branch_id = p_branch_id and product_id = p_product_id
    order by updated_at desc limit 1 for update;
  if not found then raise exception 'No inventory record exists for this product'; end if;
  new_quantity := inventory_row.quantity + p_quantity_delta;
  if new_quantity < 0 then raise exception 'Adjustment cannot reduce stock below zero'; end if;
  update public.inventory set quantity = new_quantity, updated_at = now() where id = inventory_row.id;
  insert into public.inventory_transactions (branch_id, product_id, user_id, transaction_type, quantity_delta, reason)
  values (p_branch_id, p_product_id, auth.uid(), 'adjustment', p_quantity_delta, p_reason);
  insert into public.audit_logs (branch_id, user_id, action, module, record_id, new_value)
  values (p_branch_id, auth.uid(), 'inventory.adjusted', 'inventory', p_product_id,
    jsonb_build_object('delta', p_quantity_delta, 'quantity', new_quantity, 'reason', p_reason));
  return new_quantity;
end;
$$;

revoke all on function public.adjust_inventory(uuid, uuid, numeric, text) from public;
grant execute on function public.adjust_inventory(uuid, uuid, numeric, text) to authenticated;

create or replace function public.bootstrap_first_branch(p_branch_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_branch_id uuid;
  account_name text;
begin
  if auth.uid() is null then raise exception 'Sign in before setting up a branch'; end if;
  if nullif(trim(p_branch_name), '') is null then raise exception 'Branch name is required'; end if;

  perform pg_advisory_xact_lock(hashtext('dukaan:first-branch-bootstrap'));
  if exists (select 1 from public.branches) then
    raise exception 'A branch already exists. Ask an administrator to assign your profile';
  end if;

  account_name := coalesce(
    nullif(auth.jwt()->'user_metadata'->>'full_name', ''),
    nullif(split_part(auth.jwt()->>'email', '@', 1), ''),
    'Store manager'
  );
  insert into public.branches (name) values (trim(p_branch_name)) returning id into new_branch_id;
  insert into public.profiles (id, branch_id, full_name, role)
  values (auth.uid(), new_branch_id, account_name, 'manager')
  on conflict (id) do update set branch_id = excluded.branch_id, role = 'manager';

  return new_branch_id;
end;
$$;

revoke all on function public.bootstrap_first_branch(text) from public;
grant execute on function public.bootstrap_first_branch(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy "branch members read product images" on storage.objects for select to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and public.has_branch_access(((storage.foldername(name))[1])::uuid)
);
create policy "catalog managers upload product images" on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and public.can_write_branch_table(((storage.foldername(name))[1])::uuid, 'products')
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
);
create policy "catalog managers replace product images" on storage.objects for update to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and public.can_write_branch_table(((storage.foldername(name))[1])::uuid, 'products')
)
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and public.can_write_branch_table(((storage.foldername(name))[1])::uuid, 'products')
);
create policy "catalog managers delete product images" on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and public.can_write_branch_table(((storage.foldername(name))[1])::uuid, 'products')
);

do $$
declare table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['products', 'inventory', 'sales'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end $$;

alter table public.shop_units enable row level security;
create policy "shop members read units" on public.shop_units for select to authenticated using (public.has_shop_access(shop_id));
create policy "shop owners manage units" on public.shop_units for all to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.shop_id = shop_id and p.role = 'owner')) with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.shop_id = shop_id and p.role = 'owner'));