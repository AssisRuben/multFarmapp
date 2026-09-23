-- ============================================================
-- SEED — Segunda farmácia fictícia, multi-tenant.
--
-- Mesmo padrão de supabase/seed_data.sql, mas:
--  - cria o tenant e usa (select id from tenants where nome = ...)
--    como referência em todo insert (mesmo padrão da Fase 0).
--  - códigos DELIBERADAMENTE baixos (vendedor 1-3, cliente 1-80,
--    produto 1-20...) que colidem de propósito com os códigos reais
--    da Farmácia piloto (vendedor 1-99, cliente 1-43830, produto
--    1-26535) — é o teste de estresse real do isolamento multi-tenant,
--    não só o cenário isolado do teste_isolamento_multi_tenant.sql.
--  - cobre tabelas que o seed original não tocava (fornecedores,
--    compras, compras_itens, faixas_comissao, atividades_checklist,
--    produtos_em_falta, pendencias, carteira_clientes) — a régua de
--    comissão em especial É por tenant desde a Fase 1, cada farmácia
--    precisa da própria.
--
-- Idempotente: pode rodar de novo sem duplicar (checa "not exists"
-- pro tenant e "on conflict do nothing" no resto).
-- ============================================================

-- ------------------------------------------------------------
-- 0) TENANT
-- ------------------------------------------------------------
insert into tenants (nome, trier_config)
select 'Farmácia Fictícia 2', '{}'::jsonb
where not exists (select 1 from tenants where nome = 'Farmácia Fictícia 2');

-- ------------------------------------------------------------
-- 1) VENDEDORES (3, códigos 1-3 — colidem de propósito com a piloto)
-- ------------------------------------------------------------
insert into vendedores (tenant_id, codigo, nome, numero_cpf, cep, email, ativo)
select (select id from tenants where nome = 'Farmácia Fictícia 2'), codigo, nome, cpf, cep, email, true
from (values
  (1, 'Marina Alves',    '333.444.555-11', '20040-020', 'marina.alves@fict2.com'),
  (2, 'Thiago Souza',    '444.555.666-22', '30140-071', 'thiago.souza@fict2.com'),
  (3, 'Bianca Ferreira', '555.666.777-33', '40026-010', 'bianca.ferreira@fict2.com')
) as v(codigo, nome, cpf, cep, email)
on conflict (tenant_id, codigo) do nothing;

-- ------------------------------------------------------------
-- 2) CLIENTES (~80, códigos 1-80)
-- ------------------------------------------------------------
do $$
declare
  v_tenant_id uuid := (select id from tenants where nome = 'Farmácia Fictícia 2');
  primeiros text[] := array['Maria','José','Ana','João','Antônio','Francisca','Carlos','Paulo','Pedro',
    'Lucas','Marcos','Luiz','Gabriel','Rafael','Daniel','Marcelo','Bruno','Eduardo','Felipe','Rodrigo'];
  sobrenomes text[] := array['Silva','Santos','Oliveira','Souza','Rodrigues','Ferreira','Alves','Pereira',
    'Lima','Gomes','Costa','Ribeiro','Martins','Carvalho','Almeida'];
  bairros text[] := array['Centro','Savassi','Funcionários','Serra','Pampulha','Buritis'];
  total int := 80;
  i int;
  nome text;
begin
  for i in 1..total loop
    nome := primeiros[1 + floor(random() * array_length(primeiros, 1))::int]
      || ' ' || sobrenomes[1 + floor(random() * array_length(sobrenomes, 1))::int];

    insert into clientes (
      tenant_id, codigo, nome, numero_cpf_cnpj, codigo_cidade, email, cep, estado,
      fone, bairro, logradouro, numero_endereco, ativo, data_nascimento
    ) values (
      v_tenant_id,
      i,
      nome,
      case when random() < 0.08 then null else lpad((random() * 99999999999)::bigint::text, 11, '0') end,
      '3106200', -- Belo Horizonte
      case when random() < 0.25 then null
           else lower(translate(nome, 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ ', 'aaaaeeiooouc AAAAEEIOOOUC')) || i || '@example.com' end,
      lpad((random() * 99999999)::bigint::text, 8, '0'),
      'MG',
      '(31) 9' || lpad((random() * 99999999)::bigint::text, 8, '0'),
      bairros[1 + floor(random() * array_length(bairros, 1))::int],
      'Rua ' || sobrenomes[1 + floor(random() * array_length(sobrenomes, 1))::int],
      (1 + floor(random() * 1500))::text,
      random() < 0.94,
      (date '1950-01-01' + (random() * 25000)::int)
    )
    on conflict (tenant_id, codigo) do nothing;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3) PRODUTOS curados (10, códigos 1-10)
-- ------------------------------------------------------------
insert into produtos (tenant_id, codigo, nome, preco_atual, preco_anterior, em_promocao, percentual_desconto, exige_receita, tipo_receita)
select (select id from tenants where nome = 'Farmácia Fictícia 2'), * from (values
  (1,  'Dipirona 500mg',        8.50,  null,  false, null, false, null),
  (2,  'Paracetamol 750mg',     6.90,  8.10,  true,  15,   false, null),
  (3,  'Amoxicilina 500mg',     23.90, null,  false, null, true,  'antimicrobiano'),
  (4,  'Losartana 50mg',        14.80, 16.50, true,  10,   true,  'comum'),
  (5,  'Omeprazol 20mg',        12.00, null,  false, null, false, null),
  (6,  'Clonazepam 2mg',        30.90, null,  false, null, true,  'controle_especial'),
  (7,  'Protetor Solar FPS 60', 52.90, 64.90, true,  18,   false, null),
  (8,  'Vitamina D3 2000UI',    38.90, 45.00, true,  15,   false, null),
  (9,  'Metformina 850mg',      13.50, null,  false, null, true,  'comum'),
  (10, 'Fralda Geriátrica M',   31.90, 36.90, true,  13,   false, null)
) as p(codigo, nome, preco_atual, preco_anterior, em_promocao, percentual_desconto, exige_receita, tipo_receita)
on conflict (tenant_id, codigo) do nothing;

-- ------------------------------------------------------------
-- 4) PRODUTO_CATALOGO (20, códigos 1-20 — colide com a piloto)
-- ------------------------------------------------------------
insert into produto_catalogo (tenant_id, codigo, codigo_barras, nome, categoria, grupo, marca, preco_venda, custo_medio, estoque_atual, tipo_lista)
select (select id from tenants where nome = 'Farmácia Fictícia 2'), * from (values
  (1,  '7891058100001', 'Dipirona Gotas 10ml',            'Medicamentos',      'Analgésicos',   'EMS',        9.50,  5.00, 90, null),
  (2,  '7896004700002', 'Vitamina D3 2000UI 60cáps',      'Suplementos',       'Vitaminas',     'Sundown',   39.90, 21.00, 40, null),
  (3,  '7891350000003', 'Protetor Solar FPS70 120ml',     'Dermocosméticos',   'Fotoproteção',  'Sundown',   65.90, 36.00, 22, null),
  (4,  '7500435100004', 'Escova Dental Macia',            'Higiene Bucal',     'Higiene',       'Oral-B',    11.90,  5.70, 150, null),
  (5,  '7891024100005', 'Fio Dental 50m',                 'Higiene Bucal',     'Higiene',       'Colgate',    8.50,  3.90, 110, null),
  (6,  '7896098900006', 'Álcool Gel 500ml',                'Higiene',           'Limpeza',       'Asfar',     13.90,  7.00, 75, null),
  (7,  '7891010500007', 'Curativo Band-Aid 20un',          'Primeiros Socorros','Curativos',     'J&J',       14.90,  7.50, 50, null),
  (8,  '7898950600008', 'Termômetro Digital',              'Equipamentos',      'Diagnóstico',   'G-Tech',    27.90, 15.00, 20, null),
  (9,  '7898930900009', 'Colágeno Hidrolisado 300g',       'Suplementos',       'Beleza',        'Nutrated',  74.90, 42.00, 15, null),
  (10, '7891350900010', 'Sabonete Líquido Íntimo 200ml',   'Higiene',           'Higiene íntima','Nívea',     23.90, 12.50, 35, null),
  (11, '7891088000011', 'Amoxicilina 500mg 21cp',          'Medicamentos',      'Antibióticos',  'EMS',       23.90, 13.00, 60, 'T'),
  (12, '7891088000012', 'Clonazepam 2mg 30cp',             'Medicamentos',      'Controlados',   'EMS',       30.90, 18.00, 25, 'B1'),
  (13, '7896183300013', 'Repelente Spray 100ml',           'Dermocosméticos',   'Repelentes',    'Exposis',   32.90, 17.50, 28, null),
  (14, '7891350000014', 'Creme Hidratante Corporal 400ml', 'Dermocosméticos',   'Hidratação',    'Nívea',     31.90, 16.50, 48, null),
  (15, '7891010100015', 'Absorvente Noturno 8un',          'Higiene',           'Higiene fem.',  'Sempre Livre', 10.90, 5.50, 120, null),
  (16, '7500435200016', 'Shampoo Anticaspa 200ml',         'Cabelos',           'Cuidado capilar','Head & Shoulders', 26.90, 14.00, 40, null),
  (17, '7896422500017', 'Ibuprofeno 400mg 20cp',           'Medicamentos',      'Anti-inflamatórios', 'Medley', 17.90, 9.80, 65, null),
  (18, '7896004700018', 'Omeprazol 20mg 28cp',             'Medicamentos',      'Gástricos',     'EMS',       15.90,  8.40, 85, null),
  (19, '7891106900019', 'Colírio Lubrificante 15ml',       'Medicamentos',      'Oftálmicos',    'Allergan',  21.90, 11.50, 30, null),
  (20, '7891350020020', 'Fralda Geriátrica M 8un',         'Higiene',           'Incontinência', 'Bigfral',   36.90, 22.00, 18, null)
) as p(codigo, codigo_barras, nome, categoria, grupo, marca, preco_venda, custo_medio, estoque_atual, tipo_lista)
on conflict (tenant_id, codigo) do nothing;

-- ------------------------------------------------------------
-- 5) FORNECEDORES (4, códigos 1-4)
-- ------------------------------------------------------------
insert into fornecedores (tenant_id, codigo, nome_fantasia, razao_social, numero_cnpj, nome_cidade, email, ativo)
select (select id from tenants where nome = 'Farmácia Fictícia 2'), * from (values
  (1, 'Distribuidora Saúde BH',  'Distribuidora Saúde BH Ltda',  '11.222.333/0001-44', 'Belo Horizonte', 'contato@saudebh.com', true),
  (2, 'Farma Distrib MG',        'Farma Distribuidora MG S.A.',  '22.333.444/0001-55', 'Contagem',       'vendas@farmamg.com',  true),
  (3, 'Atacado Med Center',      'Atacado Med Center Ltda',      '33.444.555/0001-66', 'Betim',          'comercial@medcenter.com', true),
  (4, 'Higicom Distribuidora',   'Higicom Comércio Ltda',        '44.555.666/0001-77', 'Belo Horizonte', 'sac@higicom.com', true)
) as f(codigo, nome_fantasia, razao_social, numero_cnpj, nome_cidade, email, ativo)
on conflict (tenant_id, codigo) do nothing;

-- ------------------------------------------------------------
-- 6) COMPRAS + COMPRAS_ITENS (~15 compras, últimos 3 meses)
-- ------------------------------------------------------------
do $$
declare
  v_tenant_id uuid := (select id from tenants where nome = 'Farmácia Fictícia 2');
  fornecedores int[] := array[1,2,3,4];
  total_compras int := 15;
  i int;
  j int;
  v_compra_id bigint;
  n_itens int;
  codigo_prod int;
begin
  for i in 1..total_compras loop
    insert into compras (tenant_id, data_entrada, numero_nota_fiscal, codigo_fornecedor, valor_total_nota, valor_total_produtos, quantidade_itens, chave_acesso_nfe)
    values (
      v_tenant_id,
      now() - (random() * 90) * interval '1 day',
      5000 + i,
      fornecedores[1 + floor(random() * array_length(fornecedores, 1))::int],
      0, 0, 0,
      lpad((random() * 9999999999999999999999999999999999999999999::numeric)::text, 44, '0')
    )
    returning id into v_compra_id;

    n_itens := 2 + floor(random() * 5)::int;
    for j in 1..n_itens loop
      codigo_prod := 1 + floor(random() * 20)::int;
      insert into compras_itens (tenant_id, compra_id, codigo_produto, quantidade_produtos, fator_compra, valor_unitario, valor_unitario_liquido, valor_custo, valor_st)
      values (
        v_tenant_id, v_compra_id, codigo_prod,
        (5 + floor(random() * 45))::int,
        1,
        round((5 + random() * 60)::numeric, 2),
        round((5 + random() * 60)::numeric, 2),
        round((5 + random() * 60)::numeric, 2),
        0
      );
    end loop;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 7) VENDAS + VENDA_ITENS (~120 notas, últimos 4 meses)
-- ------------------------------------------------------------
do $$
declare
  v_tenant_id uuid := (select id from tenants where nome = 'Farmácia Fictícia 2');
  vendedores int[] := array[1, 2, 3];
  qtd_clientes int := 80;
  total_vendas int := 120;
  i int;
  j int;
  v_id bigint;
  v_data date;
  v_vendedor int;
  v_cliente int;
  v_cancelado boolean;
  n_itens int;
  codigo_prod int;
  qtd_prod numeric;
  vlr_unit numeric;
  vlr_bruto numeric;
  vlr_desc numeric;
  vlr_liq numeric;
  vlr_custo numeric;
begin
  for i in 1..total_vendas loop
    v_data := current_date - floor(random() * 120)::int;
    v_vendedor := vendedores[1 + floor(random() * array_length(vendedores, 1))::int];
    v_cliente := case when random() < 0.08 then null else 1 + floor(random() * qtd_clientes)::int end;
    v_cancelado := random() < 0.03;

    insert into vendas (
      tenant_id, numero_nota, tipo_cancelamento, data_emissao, hora_emissao,
      codigo_vendedor, codigo_cliente, entrega, pagamento_na_entrega, condicao_pagamento,
      numero_cupom_fiscal, numero_nota_fiscal, cod_filial, ser_nota_fiscal, modelo_venda
    ) values (
      v_tenant_id,
      i,
      case when v_cancelado then 'E' else null end,
      v_data,
      (time '08:00:00' + (random() * interval '11 hours'))::time,
      v_vendedor,
      v_cliente,
      random() < 0.08,
      random() < 0.04,
      jsonb_build_object('tipo', (array['dinheiro','credito','debito','pix'])[1 + floor(random() * 4)::int], 'parcelas', 1),
      i, i, 1, '1', 'NFCE'
    )
    on conflict (tenant_id, numero_nota, cod_filial, ser_nota_fiscal) do nothing
    returning id into v_id;

    if v_id is not null and not v_cancelado then
      n_itens := 1 + floor(random() * 4)::int;
      for j in 1..n_itens loop
        codigo_prod := 1 + floor(random() * 20)::int;
        qtd_prod := round((1 + random() * 3)::numeric, 3);
        vlr_unit := round((5 + random() * 90)::numeric, 2);
        vlr_bruto := round((qtd_prod * vlr_unit)::numeric, 2);
        vlr_desc := round((vlr_bruto * (random() * 0.1))::numeric, 2);
        vlr_liq := vlr_bruto - vlr_desc;
        vlr_custo := round((vlr_bruto * (0.4 + random() * 0.3))::numeric, 2);

        insert into venda_itens (
          tenant_id, venda_id, codigo_produto, codigo_vendedor, quantidade_produtos,
          valor_total_bruto, valor_total_liquido, valor_total_custo,
          num_sequencial, prc_comissao, vlr_desconto, vlr_unitario,
          vlr_custo_aquisicao, vlr_custo_produto, venda_com_desconto
        ) values (
          v_tenant_id, v_id, codigo_prod, v_vendedor, qtd_prod,
          vlr_bruto, vlr_liq, vlr_custo,
          j, round((1 + random() * 4)::numeric, 3), vlr_desc, vlr_unit,
          round((vlr_custo / greatest(qtd_prod, 0.001))::numeric, 2), vlr_custo, vlr_desc > 0
        );
      end loop;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 8) VENDAS_VENDEDOR_DIARIO (recalculado a partir do que foi gerado)
-- ------------------------------------------------------------
insert into vendas_vendedor_diario (tenant_id, data_emissao, codigo_vendedor, quantidade_itens, quantidade_atendimentos)
select
  agg.tenant_id, agg.data_emissao, agg.codigo_vendedor, agg.quantidade_itens, agg.quantidade_atendimentos
from (
  select
    vd.tenant_id,
    vd.data_emissao,
    vd.codigo_vendedor,
    count(distinct vd.id) as quantidade_atendimentos,
    coalesce(sum(itens.qtd_itens), 0)::int as quantidade_itens
  from vendas vd
  left join (
    select venda_id, count(*) as qtd_itens from venda_itens group by venda_id
  ) itens on itens.venda_id = vd.id
  where vd.tenant_id = (select id from tenants where nome = 'Farmácia Fictícia 2')
    and vd.codigo_vendedor is not null
  group by vd.tenant_id, vd.data_emissao, vd.codigo_vendedor
) agg
on conflict (tenant_id, data_emissao, codigo_vendedor) do update
  set quantidade_itens = excluded.quantidade_itens,
      quantidade_atendimentos = excluded.quantidade_atendimentos;

-- ------------------------------------------------------------
-- 9) VENDA_ITEM_RECEITAS (parte dos itens controlados já com receita)
-- ------------------------------------------------------------
insert into venda_item_receitas (tenant_id, venda_item_id, tipo_receita, foto_url, data_anexo)
select
  vi.tenant_id, vi.id, p.tipo_receita, null,
  (v.data_emissao::timestamptz + interval '1 day')
from venda_itens vi
join produtos p on p.tenant_id = vi.tenant_id and p.codigo = vi.codigo_produto and p.exige_receita = true
join vendas v on v.id = vi.venda_id
where vi.tenant_id = (select id from tenants where nome = 'Farmácia Fictícia 2')
  and (vi.id % 100) < 40
on conflict (venda_item_id) do nothing;

-- ------------------------------------------------------------
-- 10) METAS (mês corrente, 3 vendedores)
-- ------------------------------------------------------------
do $$
declare
  v_tenant_id uuid := (select id from tenants where nome = 'Farmácia Fictícia 2');
  ano_atual int := extract(year from current_date)::int;
  mes_atual int := extract(month from current_date)::int;
begin
  insert into metas (tenant_id, codigo_vendedor, ano, mes, semana, valor_meta) values
    (v_tenant_id, 1, ano_atual, mes_atual, null, 45000),
    (v_tenant_id, 1, ano_atual, mes_atual, 1,    10000),
    (v_tenant_id, 1, ano_atual, mes_atual, 2,    11000),
    (v_tenant_id, 1, ano_atual, mes_atual, 3,    11000),
    (v_tenant_id, 1, ano_atual, mes_atual, 4,    13000),
    (v_tenant_id, 2, ano_atual, mes_atual, null, 52000),
    (v_tenant_id, 2, ano_atual, mes_atual, 1,    12000),
    (v_tenant_id, 2, ano_atual, mes_atual, 2,    12500),
    (v_tenant_id, 2, ano_atual, mes_atual, 3,    13000),
    (v_tenant_id, 2, ano_atual, mes_atual, 4,    14500),
    (v_tenant_id, 3, ano_atual, mes_atual, null, 38000),
    (v_tenant_id, 3, ano_atual, mes_atual, 1,     9000),
    (v_tenant_id, 3, ano_atual, mes_atual, 2,     9000),
    (v_tenant_id, 3, ano_atual, mes_atual, 3,     9500),
    (v_tenant_id, 3, ano_atual, mes_atual, 4,    10500)
  on conflict do nothing;
end $$;

-- ------------------------------------------------------------
-- 11) FAIXAS_COMISSAO (régua própria dessa farmácia — desde a Fase 1
-- é por tenant, cada uma pode ter percentuais diferentes)
-- ------------------------------------------------------------
insert into faixas_comissao (tenant_id, percentual_meta_min, percentual_comissao)
select (select id from tenants where nome = 'Farmácia Fictícia 2'), * from (values
  (100, 9),
  (90,  7),
  (80,  6),
  (70,  4),
  (0,   2)
) as f(percentual_meta_min, percentual_comissao)
on conflict (tenant_id, percentual_meta_min) do nothing;

-- ------------------------------------------------------------
-- 12) CAMPANHA de exemplo (produtos 1-3 em promoção)
-- ------------------------------------------------------------
do $$
declare
  v_tenant_id uuid := (select id from tenants where nome = 'Farmácia Fictícia 2');
  v_campanha_id bigint;
begin
  insert into campanhas (tenant_id, nome, data_inicio, data_fim)
  select v_tenant_id, 'Queima de estoque - Dermocosméticos', current_date - 2, current_date + 5
  where not exists (
    select 1 from campanhas where tenant_id = v_tenant_id and nome = 'Queima de estoque - Dermocosméticos'
  )
  returning id into v_campanha_id;

  if v_campanha_id is not null then
    insert into campanha_produtos (tenant_id, campanha_id, codigo_produto, preco_promocional, percentual_desconto, quantidade_cartazes)
    select v_tenant_id, v_campanha_id, codigo, round(preco_venda * 0.8, 2), 20, 1
    from produto_catalogo
    where tenant_id = v_tenant_id and codigo in (3, 13, 14);
  end if;
end $$;

-- ------------------------------------------------------------
-- 13) ATIVIDADES_CHECKLIST (2 atividades, vale pra todo mundo)
-- ------------------------------------------------------------
insert into atividades_checklist (tenant_id, titulo, horario, ativo, dias_semana)
select (select id from tenants where nome = 'Farmácia Fictícia 2'), *
from (values
  ('Conferir temperatura da geladeira de medicamentos', '08:00'::time, true, array[2,3,4,5,6,7]),
  ('Organizar balcão de promoções',                     '14:00'::time, true, array[2,3,4,5,6,7])
) as a(titulo, horario, ativo, dias_semana)
on conflict do nothing;

-- ------------------------------------------------------------
-- 14) PRODUTOS_EM_FALTA (3 registros recentes)
-- ------------------------------------------------------------
insert into produtos_em_falta (tenant_id, nome_produto, codigo_produto, data, tem_saldo_estoque)
select (select id from tenants where nome = 'Farmácia Fictícia 2'), *
from (values
  ('Dipirona Gotas 10ml', 1, current_date - 1, false),
  ('Vitamina D3 2000UI 60cáps', 2, current_date, false),
  ('Repelente Spray 100ml', 13, current_date, true)
) as pf(nome_produto, codigo_produto, data, tem_saldo_estoque);

-- ------------------------------------------------------------
-- 15) PENDÊNCIAS (2 exemplos)
-- ------------------------------------------------------------
insert into pendencias (tenant_id, nome_cliente, produtos, data, baixada)
select (select id from tenants where nome = 'Farmácia Fictícia 2'), *
from (values
  ('Maria Silva', 'Losartana 50mg (2 caixas)', current_date - 2, false),
  ('João Souza',  'Omeprazol 20mg + Vitamina D3', current_date - 1, false)
) as pd(nome_cliente, produtos, data, baixada);

-- ------------------------------------------------------------
-- 16) CARTEIRA_CLIENTES (alguns vínculos vendedor-cliente)
-- ------------------------------------------------------------
do $$
declare
  v_tenant_id uuid := (select id from tenants where nome = 'Farmácia Fictícia 2');
begin
  insert into carteira_clientes (tenant_id, codigo_vendedor, codigo_cliente)
  select v_tenant_id, (1 + (n % 3)), n
  from generate_series(1, 20) as n
  on conflict (tenant_id, codigo_vendedor, codigo_cliente) do nothing;
end $$;

-- ------------------------------------------------------------
-- RESUMO — rode pra conferir o que entrou
-- ------------------------------------------------------------
-- select
--   (select count(*) from vendedores where tenant_id = (select id from tenants where nome='Farmácia Fictícia 2')) as vendedores,
--   (select count(*) from clientes where tenant_id = (select id from tenants where nome='Farmácia Fictícia 2')) as clientes,
--   (select count(*) from vendas where tenant_id = (select id from tenants where nome='Farmácia Fictícia 2')) as vendas,
--   (select count(*) from venda_itens where tenant_id = (select id from tenants where nome='Farmácia Fictícia 2')) as venda_itens,
--   (select count(*) from produto_catalogo where tenant_id = (select id from tenants where nome='Farmácia Fictícia 2')) as produto_catalogo,
--   (select count(*) from compras where tenant_id = (select id from tenants where nome='Farmácia Fictícia 2')) as compras;
