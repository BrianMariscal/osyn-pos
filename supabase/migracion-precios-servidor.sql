-- OSYN POS: el servidor valida precios y cantidades de cada venta.
-- Ejecutar en Supabase SQL Editor DESPUÉS de supabase/migracion-stock-servidor.sql
-- (usa public.pos_is_manager_or_service). Se puede correr más de una vez.
--
-- Antes el total se recalculaba con el precio que mandaba el dispositivo: un
-- vendedor que manipulara la app podía registrar ventas a $0. Ahora, para
-- ventas subidas por un vendedor:
--   * Cantidad 0 o negativa: la venta se rechaza (la app la deja pendiente y
--     avisa, sin frenar las demás).
--   * El costo de cada renglón sale del catálogo (no del dispositivo), así el
--     consumo interno "a costo" no se puede abaratar.
--   * Un precio por debajo del costo se reemplaza por el precio de lista.
--     Las ofertas legítimas (entre costo y precio) se respetan.
-- Corre antes que trg_sales_guard (orden alfabético), que recalcula totales.

create or replace function public.pos_guard_sale_prices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_product record;
  v_pack numeric;
  v_cost numeric;
  v_list numeric;
begin
  if public.pos_is_manager_or_service() then
    return new;
  end if;
  if jsonb_typeof(new.items) is distinct from 'array' then
    raise exception 'Venta % sin renglones válidos', new.id using errcode = '23514';
  end if;

  for v_item in select value from jsonb_array_elements(new.items) loop
    if coalesce((v_item->>'qty')::numeric, 0) <= 0 then
      raise exception 'Venta % con cantidad inválida', new.id using errcode = '23514';
    end if;
    select cost, price, data into v_product from public.products where id = v_item->>'productId';
    if found then
      v_pack := coalesce(nullif((v_item->>'pack_size')::numeric, 0), 1);
      v_cost := round(coalesce(v_product.cost, 0) * v_pack, 2);
      v_list := case
        when v_pack > 1 then coalesce(nullif((v_product.data->>'pack_price')::numeric, 0), round(coalesce(v_product.price, 0) * v_pack, 2))
        else coalesce(v_product.price, 0)
      end;
      if coalesce((v_item->>'price')::numeric, 0) < v_cost then
        v_item := v_item || jsonb_build_object('price', v_list);
      end if;
      v_item := v_item || jsonb_build_object('cost', v_cost);
    end if;
    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  new.items := v_items;
  return new;
end;
$$;

drop trigger if exists trg_sales_0_prices on public.sales;
create trigger trg_sales_0_prices
  before insert on public.sales
  for each row execute function public.pos_guard_sale_prices();

notify pgrst, 'reload schema';

-- Verificación: debe salir trg_sales_0_prices.
select trigger_name from information_schema.triggers where trigger_name = 'trg_sales_0_prices';
