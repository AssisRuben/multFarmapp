-- ============================================================
-- TESTE DE ISOLAMENTO MULTI-TENANT
--
-- v3: RAISE NOTICE não aparece nos Results do SQL Editor do Supabase
-- (só em log_min_messages >= warning, que fica abaixo de NOTICE) e uma
-- TEMP TABLE criada numa parte do lote não sobreviveu até outra parte.
-- Solução: uma função NORMAL (schema public, objeto durável — mesmo
-- tipo que schema.sql/migrations já usaram com sucesso em várias
-- statements seguidas), chamada por um SELECT logo depois, removida
-- no final. Resultado aparece no grid normal.
--
-- Os dados de teste (tenant B, vendedores/clientes/vendas fake) são
-- desfeitos por dentro da própria função: um bloco
-- `begin ... exception when others then null ... end` interno provoca
-- um erro de propósito assim que termina de MEDIR os resultados — isso
-- funciona como um savepoint automático do Postgres, desfazendo só os
-- INSERTs, sem afetar o restante da execução nem exigir ROLLBACK
-- explícito.
-- ============================================================

drop function if exists public.fn_teste_isolamento_multi_tenant();

create function public.fn_teste_isolamento_multi_tenant()
returns table (ordem int, teste text, esperado text, obtido text)
language plpgsql
as $$
declare
  v_tenant_a uuid := '9b8b94ea-c072-4ab3-a8a5-d872f10c3b57'; -- Farmácia piloto (Fase 0)
  v_tenant_b uuid;
  v_venda_a_id bigint;
  v_venda_b_id bigint;
  r1_nome text;
  r2_fat numeric;
  r3_valor numeric;
  r4_fat numeric;
  r5_valor numeric;
begin
  begin
    -- ------------------------------------------------------
    -- Setup: tenant B + dados com o MESMO codigo/numero_nota do tenant A
    -- ------------------------------------------------------
    insert into tenants (nome) values ('Tenant Teste B (isolamento)') returning id into v_tenant_b;

    insert into vendedores (tenant_id, codigo, nome) values (v_tenant_a, 999, 'Vendedor A-999');
    insert into vendedores (tenant_id, codigo, nome) values (v_tenant_b, 999, 'Vendedor B-999');

    insert into clientes (tenant_id, codigo, nome) values (v_tenant_a, 999, 'Cliente A-999');
    insert into clientes (tenant_id, codigo, nome) values (v_tenant_b, 999, 'Cliente B-999');

    insert into vendas (tenant_id, numero_nota, data_emissao, codigo_vendedor, codigo_cliente, cod_filial, ser_nota_fiscal)
    values (v_tenant_a, 55555, current_date, 999, 999, 1, '1') returning id into v_venda_a_id;
    insert into vendas (tenant_id, numero_nota, data_emissao, codigo_vendedor, codigo_cliente, cod_filial, ser_nota_fiscal)
    values (v_tenant_b, 55555, current_date, 999, 999, 1, '1') returning id into v_venda_b_id;

    insert into venda_itens (tenant_id, venda_id, codigo_produto, codigo_vendedor, quantidade_produtos, valor_total_liquido, valor_total_bruto, prc_comissao)
    values (v_tenant_a, v_venda_a_id, 1, 999, 1, 100, 100, 10);
    insert into venda_itens (tenant_id, venda_id, codigo_produto, codigo_vendedor, quantidade_produtos, valor_total_liquido, valor_total_bruto, prc_comissao)
    values (v_tenant_b, v_venda_b_id, 1, 999, 1, 500, 500, 10);

    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
    values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'teste-a@isolamento.local', 'nao-eh-senha-real', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'teste-b@isolamento.local', 'nao-eh-senha-real', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');

    insert into profiles (id, tenant_id, codigo_vendedor, role)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', v_tenant_a, 999, 'gestor');
    insert into profiles (id, tenant_id, codigo_vendedor, role)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', v_tenant_b, 999, 'gestor');

    -- ------------------------------------------------------
    -- Impersona o TENANT B. Esperado: só 500, nunca 100.
    -- ------------------------------------------------------
    perform set_config('request.jwt.claims', json_build_object('sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')::text, true);
    set local role authenticated;

    select nome into r1_nome from vendedores where codigo = 999;
    select faturamento_liquido into r2_fat from vw_ranking_vendedores_dia where codigo_vendedor = 999;
    select valor_total into r3_valor from vw_clientes_valor_geral where codigo = 999;

    reset role;
    perform set_config('request.jwt.claims', '', true);

    -- ------------------------------------------------------
    -- Impersona o TENANT A. Esperado: só 100, nunca 500.
    -- ------------------------------------------------------
    perform set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::text, true);
    set local role authenticated;

    select faturamento_liquido into r4_fat from vw_ranking_vendedores_dia where codigo_vendedor = 999;
    select valor_total into r5_valor from vw_clientes_valor_geral where codigo = 999;

    reset role;
    perform set_config('request.jwt.claims', '', true);

    -- Desfaz tudo o que foi inserido acima (savepoint automático do
    -- bloco begin/exception) — os valores já medidos em r1..r5 ficam
    -- intactos, só a gravação no banco é revertida.
    raise exception using errcode = '00000';
  exception when others then
    null; -- engolido de propósito: é o mecanismo de limpeza, não um erro real
  end;

  return query select 1, 'vendedores codigo=999 sob tenant B'::text, 'Vendedor B-999'::text, coalesce(r1_nome, '(vazio)');
  return query select 2, 'vw_ranking_vendedores_dia sob tenant B'::text, '500'::text, coalesce(r2_fat::text, '(vazio)');
  return query select 3, 'vw_clientes_valor_geral sob tenant B'::text, '500'::text, coalesce(r3_valor::text, '(vazio)');
  return query select 4, 'vw_ranking_vendedores_dia sob tenant A'::text, '100'::text, coalesce(r4_fat::text, '(vazio)');
  return query select 5, 'vw_clientes_valor_geral sob tenant A'::text, '100'::text, coalesce(r5_valor::text, '(vazio)');
end;
$$;

select
  ordem,
  teste,
  esperado,
  obtido,
  case when obtido = esperado then '✅ OK' else '❌ VAZOU / DIVERGENTE' end as status
from public.fn_teste_isolamento_multi_tenant()
order by ordem;

drop function public.fn_teste_isolamento_multi_tenant();
