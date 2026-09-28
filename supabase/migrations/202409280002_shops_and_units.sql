create or replace function public.provision_shop_from_signup()
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  account_id uuid := auth.uid();
  metadata jsonb := coalesce(auth.jwt()->'user_metadata', '{}'::jsonb);
  current_branch uuid;
  new_shop uuid;
  new_branch uuid;
  business_name text;
  business_location text;
  business_phone text;
  account_name text;
begin
  if account_id is null then raise exception 'Sign in before creating a business'; end if;
  perform pg_advisory_xact_lock(hashtext('dukaan:signup:' || account_id::text));
  select branch_id into current_branch from public.profiles where id = account_id;
  if current_branch is not null then return current_branch; end if;
  business_name := nullif(trim(metadata->>'business_name'), '');
  business_location := nullif(trim(metadata->>'business_location'), '');
  business_phone := nullif(trim(metadata->>'phone'), '');
  account_name := coalesce(nullif(trim(metadata->>'full_name'), ''), split_part(auth.jwt()->>'email', '@', 1));
  if business_name is null or business_location is null or business_phone is null or account_name is null then
    raise exception 'Registration is missing required business details';
  end if;

  insert into public.shops (owner_user_id, name, location, phone)
  values (account_id, business_name, business_location, business_phone) returning id into new_shop;
  insert into public.branches (shop_id, name, address, phone)
  values (new_shop, 'Main branch', business_location, business_phone) returning id into new_branch;
  insert into public.profiles (id, shop_id, branch_id, full_name, role)
  values (account_id, new_shop, new_branch, account_name, 'owner')
  on conflict (id) do update set shop_id = excluded.shop_id, branch_id = excluded.branch_id, full_name = excluded.full_name, role = 'owner';
  insert into public.settings (branch_id, setting_key, setting_value) values
    (new_branch, 'currency', '"USD"'::jsonb),
    (new_branch, 'tax_rate', '0'::jsonb),
    (new_branch, 'receipt', jsonb_build_object('business_name', business_name, 'phone', business_phone, 'address', business_location));
  insert into public.categories (branch_id, name)
    select new_branch, category_name from unnest(array['Food','Drinks','Cleaning','Personal Care','Household','Cosmetics','Baby Products','Other']) as category_name;
  insert into public.shop_units (shop_id, code, display_name, unit_family, base_unit, base_factor) values
    (new_shop, 'mg', 'Milligram', 'weight', 'g', 0.001),
    (new_shop, 'g', 'Gram', 'weight', 'g', 1),
    (new_shop, 'kg', 'KG', 'weight', 'g', 1000),
    (new_shop, 'ton', 'Ton', 'weight', 'g', 1000000),
    (new_shop, 'tumin', 'Tumin', 'weight', 'g', 125),
    (new_shop, 'rubac', 'Rubac', 'weight', 'g', 250),
    (new_shop, 'nus_kilo', 'Nus Kilo', 'weight', 'g', 500),
    (new_shop, 'each', 'Xabo', 'count', 'each', 1),
    (new_shop, 'dozen', 'Dozen', 'count', 'each', 12),
    (new_shop, 'pair', 'Pair', 'count', 'each', 2);
  return new_branch;
end;
$$;
revoke all on function public.provision_shop_from_signup() from public;
grant execute on function public.provision_shop_from_signup() to authenticated;

create or replace function public.bootstrap_first_branch(p_branch_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  account_id uuid := auth.uid();
  new_shop uuid;
  new_branch uuid;
  account_name text;
begin
  if account_id is null then raise exception 'Sign in before setting up a branch'; end if;
  if nullif(trim(p_branch_name), '') is null then raise exception 'Branch name is required'; end if;
  perform pg_advisory_xact_lock(hashtext('dukaan:first-branch-bootstrap'));
  if exists (select 1 from public.branches) then
    raise exception 'A branch already exists. Ask an administrator to assign your profile';
  end if;
  account_name := coalesce(nullif(split_part(auth.jwt()->>'email', '@', 1), ''), 'Shop owner');
  insert into public.shops (owner_user_id, name, location, phone)
  values (account_id, trim(p_branch_name), trim(p_branch_name), '') returning id into new_shop;
  insert into public.branches (shop_id, name, address, phone)
  values (new_shop, trim(p_branch_name), trim(p_branch_name), '') returning id into new_branch;
  insert into public.profiles (id, shop_id, branch_id, full_name, role)
  values (account_id, new_shop, new_branch, account_name, 'owner')
  on conflict (id) do update set shop_id = excluded.shop_id, branch_id = excluded.branch_id,
    full_name = excluded.full_name, role = 'owner';
  insert into public.settings (branch_id, setting_key, setting_value)
  values (new_branch, 'currency', '"USD"'::jsonb), (new_branch, 'tax_rate', '0'::jsonb);
  return new_branch;
end;
$$;
revoke all on function public.bootstrap_first_branch(text) from public;
grant execute on function public.bootstrap_first_branch(text) to authenticated;