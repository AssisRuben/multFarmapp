-- ============================================================
-- MULTI-TENANT — FASE 1b: views que rodam SEM RLS (security_invoker
-- ausente ou = false) — só estas 10 precisam de correção.
--
-- Por que só 10 e não as ~25: view com security_invoker=true já herda
-- a RLS das tabelas base (Fase 1) — como cada tabela só devolve linhas
-- do tenant do usuário logado, um JOIN em codigo_produto/codigo_vendedor
-- cru não tem como casar linha de outro tenant (ela nem está visível
-- pra query). O risco é só nas views que rodam com privilégio de DONO
-- de propósito (gamificação/cross-vendedor) — aqui TODAS as linhas de
-- TODOS os tenants ficam visíveis por baixo dos panos, então um join
-- sem tenant_id explícito casa produto/cliente/vendedor do tenant
-- errado.
-- ============================================================

-- 1) vw_venda_complementar_marcada
create or replace view vw_venda_complementar_marcada as
select
  vic.venda_item_id,
  vic.codigo_vendedor,
  vd.nome as nome_vendedor,
  v.data_emissao,
  vi.valor_total_liquido as valor,
  vi.codigo_produto,
  v.id as venda_id
from venda_item_complementar vic
join venda_itens vi on vi.id = vic.venda_item_id
join vendas v on v.id = vi.venda_id
left join vendedores vd on vd.tenant_id = vic.tenant_id and vd.codigo = vic.codigo_vendedor
where vic.tenant_id = (select tenant_id from profiles where id = auth.uid());

alter view vw_venda_complementar_marcada set (security_invoker = false);

-- 2) vw_ranking_vendedores_dia — precisa de tenant_id exposto por
-- vw_metricas_vendedor_diario (invoker-mode, então adicionar a coluna
-- não vaza nada; create-or-replace só permite ACRESCENTAR no fim).
create or replace view vw_metricas_vendedor_diario as
select
  vd.data_emissao,
  vi.codigo_vendedor,
  count(distinct vd.id) as qtd_notas,
  sum(vi.valor_total_liquido) as faturamento_liquido,
  sum(vi.valor_total_bruto) as faturamento_bruto,
  sum(vi.valor_total_bruto) - sum(vi.valor_total_liquido) as total_desconto,
  round((sum(vi.valor_total_bruto) - sum(vi.valor_total_liquido)) / nullif(sum(vi.valor_total_bruto),0) * 100, 2) as taxa_desconto_pct,
  sum(vi.valor_total_liquido * (vi.prc_comissao/100.0)) as comissao_estimada,
  round(sum(vi.valor_total_liquido) / nullif(count(distinct vd.id),0), 2) as ticket_medio,
  sum(vi.quantidade_produtos * coalesce(pc.custo_medio, 0)) as total_custo,
  round(
    (sum(vi.valor_total_liquido) - sum(vi.quantidade_produtos * coalesce(pc.custo_medio, 0)))
    / nullif(sum(vi.valor_total_liquido),0) * 100,
  2) as margem_bruta_pct,
  vend.nome as nome_vendedor,
  vi.tenant_id
from venda_itens vi
join vendas vd on vd.id = vi.venda_id
join vendedores vend on vend.tenant_id = vi.tenant_id and vend.codigo = vi.codigo_vendedor
left join produto_catalogo pc on pc.tenant_id = vi.tenant_id and pc.codigo = vi.codigo_produto
where vd.tipo_cancelamento is null
group by vd.data_emissao, vi.codigo_vendedor, vend.nome, vi.tenant_id;

create or replace view vw_ranking_vendedores_dia as
select
  m.data_emissao,
  m.codigo_vendedor,
  m.faturamento_liquido,
  rank() over (partition by m.data_emissao order by m.faturamento_liquido desc) as posicao,
  m.nome_vendedor
from vw_metricas_vendedor_diario m
where m.tenant_id = (select tenant_id from profiles where id = auth.uid());

-- 3) vw_clientes_valor_geral
create or replace view vw_clientes_valor_geral as
select
  c.codigo,
  c.nome,
  coalesce(c.celular, c.fone) as telefone,
  c.email,
  c.data_nascimento,
  count(distinct v.id) as qtd_compras,
  sum(vi.valor_total_liquido) as valor_total,
  max(v.data_emissao) as ultima_compra
from vendas v
join venda_itens vi on vi.venda_id = v.id
join clientes c on c.tenant_id = v.tenant_id and c.codigo = v.codigo_cliente
where v.codigo_cliente is not null
  and v.tenant_id = (select tenant_id from profiles where id = auth.uid())
group by c.codigo, c.nome, c.fone, c.celular, c.email, c.data_nascimento;

-- 4) vw_carteira_clientes
create or replace view vw_carteira_clientes as
select
  cc.id,
  cc.codigo_vendedor,
  c.codigo as codigo_cliente,
  c.nome,
  coalesce(c.celular, c.fone) as telefone,
  cc.criado_em,
  coalesce(v6m.valor_total, 0) as valor_6_meses,
  coalesce(vm.qtd_compras_mes, 0) > 0 as comprado_este_mes,
  coalesce(vm.valor_mes, 0) as valor_mes_atual
from carteira_clientes cc
join clientes c on c.tenant_id = cc.tenant_id and c.codigo = cc.codigo_cliente
left join lateral (
  select sum(vi.valor_total_liquido) as valor_total
  from vendas v
  join venda_itens vi on vi.venda_id = v.id
  where v.tenant_id = c.tenant_id
    and v.codigo_cliente = c.codigo
    and v.data_emissao >= (current_date - interval '6 months')
) v6m on true
left join lateral (
  select count(distinct v.id) as qtd_compras_mes, sum(vi.valor_total_liquido) as valor_mes
  from vendas v
  join venda_itens vi on vi.venda_id = v.id
  where v.tenant_id = c.tenant_id
    and v.codigo_cliente = c.codigo
    and date_trunc('month', v.data_emissao) = date_trunc('month', current_date)
) vm on true
where exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = cc.tenant_id
    and (p.role = 'gestor' or p.codigo_vendedor = cc.codigo_vendedor)
);

-- 5) vw_clientes_inatividade
create or replace view vw_clientes_inatividade as
select
  c.codigo,
  c.nome,
  coalesce(c.celular, c.fone) as telefone,
  ultima_venda.data_emissao as ultima_compra,
  (current_date - ultima_venda.data_emissao) as dias_sem_comprar,
  case when ultima_venda.data_emissao < current_date - interval '60 days' then true else false end as inativo,
  ultima_venda.codigo_vendedor,
  vd.nome as nome_vendedor
from clientes c
join lateral (
  select v.data_emissao, v.codigo_vendedor
  from vendas v
  where v.tenant_id = c.tenant_id
    and v.codigo_cliente = c.codigo
  order by v.data_emissao desc, v.id desc
  limit 1
) ultima_venda on true
left join vendedores vd on vd.tenant_id = c.tenant_id and vd.codigo = ultima_venda.codigo_vendedor
where exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = c.tenant_id
)
and (current_date - ultima_venda.data_emissao) <= 3000;

alter view vw_clientes_inatividade set (security_invoker = false);

-- 6) vw_produtos_promocao_clientes
create or replace view vw_produtos_promocao_clientes as
with produtos_em_promocao as (
  select
    p.tenant_id,
    p.codigo as codigo_produto,
    p.nome as nome_produto,
    p.preco_atual,
    p.preco_anterior,
    p.percentual_desconto,
    p.exige_receita,
    p.tipo_receita,
    p.updated_at::date as periodo_inicio
  from produtos p
  where p.em_promocao = true

  union all

  select
    cp.tenant_id,
    cp.codigo_produto,
    pc.nome as nome_produto,
    cp.preco_promocional as preco_atual,
    case
      when cp.percentual_desconto > 0 then round(cp.preco_promocional / (1 - cp.percentual_desconto / 100), 2)
      else cp.preco_promocional
    end::numeric(12,2) as preco_anterior,
    cp.percentual_desconto,
    (nullif(trim(pc.tipo_lista), '') is not null) as exige_receita,
    case
      when trim(pc.tipo_lista) = 'T' then 'antimicrobiano'
      when nullif(trim(pc.tipo_lista), '') is not null then 'controle_especial'
      else null
    end as tipo_receita,
    coalesce(cp.data_inicio, camp.data_inicio) as periodo_inicio
  from campanha_produtos cp
  join campanhas camp on camp.id = cp.campanha_id and camp.tenant_id = cp.tenant_id
  join produto_catalogo pc on pc.tenant_id = cp.tenant_id and pc.codigo = cp.codigo_produto
  where current_date between camp.data_inicio and camp.data_fim
),
vendido_no_periodo as (
  select
    pp.tenant_id,
    pp.codigo_produto,
    sum(vi.quantidade_produtos) as quantidade_vendida_periodo
  from produtos_em_promocao pp
  join venda_itens vi on vi.tenant_id = pp.tenant_id and vi.codigo_produto = pp.codigo_produto
  join vendas v on v.id = vi.venda_id
    and v.data_emissao >= pp.periodo_inicio
    and v.tipo_cancelamento is null
  group by pp.tenant_id, pp.codigo_produto
)
select
  pp.codigo_produto,
  pp.nome_produto,
  pp.preco_atual,
  pp.preco_anterior,
  pp.percentual_desconto,
  c.codigo as codigo_cliente,
  c.nome as nome_cliente,
  coalesce(c.celular, c.fone) as telefone_cliente,
  max(v.data_emissao) as ultima_compra_produto,
  sum(vi.quantidade_produtos) as quantidade_total,
  pp.exige_receita,
  pp.tipo_receita,
  coalesce(vp.quantidade_vendida_periodo, 0) as quantidade_vendida_periodo
from produtos_em_promocao pp
join venda_itens vi on vi.tenant_id = pp.tenant_id and vi.codigo_produto = pp.codigo_produto
join vendas v on v.id = vi.venda_id and v.tipo_cancelamento is null
join clientes c on c.tenant_id = v.tenant_id and c.codigo = v.codigo_cliente
left join vendido_no_periodo vp on vp.tenant_id = pp.tenant_id and vp.codigo_produto = pp.codigo_produto
where pp.tenant_id = (select tenant_id from profiles where id = auth.uid())
group by pp.tenant_id, pp.codigo_produto, pp.nome_produto, pp.preco_atual, pp.preco_anterior, pp.percentual_desconto,
  c.codigo, c.nome, c.fone, c.celular, pp.exige_receita, pp.tipo_receita, vp.quantidade_vendida_periodo;

-- 7) vw_produtos_em_falta
create or replace view vw_produtos_em_falta as
select
  pef.id,
  pef.nome_produto,
  pef.codigo_produto,
  pef.data,
  case
    when exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor')
    then coalesce(vd.nome, 'Gestor(a) da Farmácia')
    else null
  end as nome_registrado_por,
  pef.tem_saldo_estoque
from produtos_em_falta pef
left join profiles perfil_registro on perfil_registro.id = pef.registrado_por
left join vendedores vd on vd.tenant_id = perfil_registro.tenant_id and vd.codigo = perfil_registro.codigo_vendedor
where pef.tenant_id = (select tenant_id from profiles where id = auth.uid());

-- 8) vw_compras_classificacoes
create or replace view vw_compras_classificacoes as
select
  cc.id,
  cc.codigo_produto,
  pc.nome as nome_produto,
  cc.motivo,
  cc.observacao,
  cc.classificado_em,
  coalesce(vd2.nome, 'Gestor(a) da Farmácia') as nome_classificado_por
from compras_classificacoes cc
join produto_catalogo pc on pc.tenant_id = cc.tenant_id and pc.codigo = cc.codigo_produto
left join profiles perfil_classificacao on perfil_classificacao.id = cc.classificado_por
left join vendedores vd2 on vd2.tenant_id = perfil_classificacao.tenant_id and vd2.codigo = perfil_classificacao.codigo_vendedor
where exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = cc.tenant_id
);

-- 9) vw_pendencias
create or replace view vw_pendencias as
select
  pd.id,
  pd.nome_cliente,
  pd.produtos,
  pd.foto_url,
  pd.data,
  pd.baixada,
  pd.baixada_em,
  coalesce(vd.nome, 'Gestor(a) da Farmácia') as nome_registrado_por
from pendencias pd
left join profiles perfil_registro on perfil_registro.id = pd.registrado_por
left join vendedores vd on vd.tenant_id = perfil_registro.tenant_id and vd.codigo = perfil_registro.codigo_vendedor
where pd.tenant_id = (select tenant_id from profiles where id = auth.uid());

-- 10) vw_cliente_dono_carteira
create or replace view vw_cliente_dono_carteira as
select
  cc.codigo_cliente,
  cc.codigo_vendedor,
  vd.nome as nome_vendedor
from carteira_clientes cc
join vendedores vd on vd.tenant_id = cc.tenant_id and vd.codigo = cc.codigo_vendedor
where exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = cc.tenant_id
);
