-- ============================================================
-- calcular_metricas_mes — versão multi-tenant. Substitui
-- migracao_metricas_mensais_calculo_ao_vivo.sql (que nunca tinha sido
-- aplicada neste projeto — achado no mesmo levantamento que achou
-- campanha_kits/campanha_kit_produtos faltando).
--
-- É SECURITY DEFINER (bypassa RLS de propósito — precisa ver
-- carteira_clientes/contatos_clientes/pendencias de TODOS os
-- vendedores, não só o do chamador). Isso a torna exatamente o tipo
-- de função que vazaria entre tenants se não filtrasse manualmente —
-- mesmo problema das views "owner mode" da Fase 1b, só que aqui é uma
-- função com ~10 CTEs fazendo join em codigo_produto/codigo_cliente
-- cru.
--
-- Mudança: novo parâmetro obrigatório p_tenant_id. Toda CTE que junta
-- tabela de negócio ganha o filtro de tenant; joins que hoje casam só
-- por codigo_produto/codigo_cliente cru (sem passar por um id
-- bigserial que já pinaria o tenant sozinho) ganham `and
-- X.tenant_id = Y.tenant_id` na condição do JOIN, não só um WHERE no
-- fim — um WHERE no fim não impede o join errado de acontecer por
-- dentro, só filtra o resultado depois (mesma lição da Fase 1b).
-- ============================================================
drop function if exists calcular_metricas_mes(date, date);
drop function if exists calcular_metricas_mes(date);

create or replace function calcular_metricas_mes(p_tenant_id uuid, mes_ref date, data_fim date default null)
returns table (codigo_vendedor integer, chave text, valor numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  fim_natural date := (mes_ref + interval '1 month' - interval '1 day')::date;
  fim date := coalesce(data_fim, (mes_ref + interval '1 month' - interval '1 day')::date);
  fim_exclusivo date := fim + interval '1 day';
begin
  if auth.uid() is not null and not exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = p_tenant_id
  ) then
    raise exception 'Só gestor pode consultar métricas mensais desse tenant.';
  end if;

  return query

  with

  -- ---------- IDs de venda_itens rastreados por categoria (pra dedup) ----------
  ia_venda_adicional as (
    select distinct vi.id as venda_item_id
    from campanha_venda_adicional_produtos cvap
    join campanhas_venda_adicional camp on camp.id = cvap.campanha_id
    join venda_itens vi on vi.tenant_id = cvap.tenant_id and vi.codigo_produto = cvap.codigo_produto
    join vendas v on v.id = vi.venda_id and v.data_emissao between camp.data_inicio and camp.data_fim
    where cvap.tenant_id = p_tenant_id
      and v.codigo_vendedor is not null
      and v.tipo_cancelamento is null
      and v.data_emissao >= mes_ref and v.data_emissao < fim_exclusivo
  ),
  ia_venda_complementar as (
    select distinct vic.venda_item_id
    from venda_item_complementar vic
    join venda_itens vi on vi.id = vic.venda_item_id
    join vendas v on v.id = vi.venda_id
    where vic.tenant_id = p_tenant_id
      and v.tipo_cancelamento is null
      and v.data_emissao >= mes_ref and v.data_emissao < fim_exclusivo
  ),
  ia_venda_campanha as (
    select distinct vi.id as venda_item_id
    from campanha_produtos cp
    join campanhas c on c.id = cp.campanha_id
    join venda_itens vi on vi.tenant_id = cp.tenant_id and vi.codigo_produto = cp.codigo_produto
    join vendas v on v.id = vi.venda_id
      and v.data_emissao between coalesce(cp.data_inicio, c.data_inicio) and coalesce(cp.data_fim, c.data_fim)
    where cp.tenant_id = p_tenant_id
      and v.codigo_vendedor is not null
      and v.tipo_cancelamento is null
      and v.data_emissao >= mes_ref and v.data_emissao < fim_exclusivo
  ),
  ia_produto_promocao as (
    select distinct vi.id as venda_item_id
    from produtos p
    join venda_itens vi on vi.tenant_id = p.tenant_id and vi.codigo_produto = p.codigo
    join vendas v on v.id = vi.venda_id
    where p.tenant_id = p_tenant_id
      and p.em_promocao = true
      and v.codigo_vendedor is not null
      and v.tipo_cancelamento is null
      and v.data_emissao >= mes_ref and v.data_emissao < fim_exclusivo
  ),

  -- ---------- Agregados por categoria (reaproveita os IDs acima) ----------
  agr_venda_adicional as (
    select
      v.codigo_vendedor,
      sum(vi.quantidade_produtos) as qtd,
      sum(vi.valor_total_liquido) as receita,
      sum(vi.valor_total_liquido - vi.valor_total_custo) as margem
    from ia_venda_adicional ia
    join venda_itens vi on vi.id = ia.venda_item_id
    join vendas v on v.id = vi.venda_id
    group by v.codigo_vendedor
  ),
  agr_venda_complementar as (
    select
      v.codigo_vendedor,
      sum(vi.quantidade_produtos) as qtd,
      sum(vi.valor_total_liquido) as receita,
      sum(vi.valor_total_liquido - vi.valor_total_custo) as margem
    from ia_venda_complementar ia
    join venda_itens vi on vi.id = ia.venda_item_id
    join vendas v on v.id = vi.venda_id
    group by v.codigo_vendedor
  ),
  agr_venda_campanha as (
    select
      v.codigo_vendedor,
      sum(vi.quantidade_produtos) as qtd,
      sum(vi.valor_total_liquido) as receita,
      sum(vi.valor_total_liquido - vi.valor_total_custo) as margem
    from ia_venda_campanha ia
    join venda_itens vi on vi.id = ia.venda_item_id
    join vendas v on v.id = vi.venda_id
    group by v.codigo_vendedor
  ),
  agr_produto_promocao as (
    select
      v.codigo_vendedor,
      sum(vi.quantidade_produtos) as qtd,
      sum(vi.valor_total_liquido) as receita,
      sum(vi.valor_total_liquido - vi.valor_total_custo) as margem
    from ia_produto_promocao ia
    join venda_itens vi on vi.id = ia.venda_item_id
    join vendas v on v.id = vi.venda_id
    group by v.codigo_vendedor
  ),

  -- ---------- Cliente de alto valor que voltou a comprar ----------
  venda_agregada as (
    select
      v.id as venda_id,
      v.codigo_cliente,
      v.codigo_vendedor,
      v.data_emissao,
      sum(vi.quantidade_produtos) as qtd,
      sum(vi.valor_total_liquido) as receita,
      sum(vi.valor_total_liquido - vi.valor_total_custo) as margem
    from vendas v
    join venda_itens vi on vi.venda_id = v.id
    where v.tenant_id = p_tenant_id
      and v.codigo_cliente is not null and v.codigo_vendedor is not null
      and v.tipo_cancelamento is null
    group by v.id, v.codigo_cliente, v.codigo_vendedor, v.data_emissao
  ),
  receita_por_cliente as (
    select codigo_cliente, sum(receita) as receita_total
    from venda_agregada
    group by codigo_cliente
  ),
  corte as (
    select percentile_cont(0.75) within group (order by receita_total) as p75
    from receita_por_cliente
    where receita_total > 0
  ),
  com_gap as (
    select
      va.*,
      lag(va.data_emissao) over (partition by va.codigo_cliente order by va.data_emissao, va.venda_id) as data_anterior
    from venda_agregada va
  ),
  agr_cliente_recuperado as (
    select
      cg.codigo_vendedor,
      count(distinct cg.codigo_cliente) as qtd,
      sum(cg.receita) as receita,
      sum(cg.margem) as margem
    from com_gap cg
    join receita_por_cliente rc on rc.codigo_cliente = cg.codigo_cliente
    cross join corte c
    where rc.receita_total >= c.p75
      and cg.data_anterior is not null
      and (cg.data_emissao - cg.data_anterior) >= 60
      and cg.data_emissao >= mes_ref
      and cg.data_emissao < fim_exclusivo
    group by cg.codigo_vendedor
  ),

  -- ---------- Vendas pra clientes da carteira ----------
  agr_venda_carteira as (
    select
      cc.codigo_vendedor,
      count(distinct v.id) as qtd,
      sum(vi.valor_total_liquido) as receita,
      sum(vi.valor_total_liquido - vi.valor_total_custo) as margem
    from carteira_clientes cc
    join vendas v on v.tenant_id = cc.tenant_id and v.codigo_cliente = cc.codigo_cliente
    join venda_itens vi on vi.venda_id = v.id
    where cc.tenant_id = p_tenant_id
      and v.tipo_cancelamento is null
      and v.data_emissao >= mes_ref and v.data_emissao < fim_exclusivo
    group by cc.codigo_vendedor
  ),

  -- ---------- Margem total DEDUPLICADA ----------
  ia_todos as (
    select venda_item_id from ia_venda_adicional
    union
    select venda_item_id from ia_venda_complementar
    union
    select venda_item_id from ia_venda_campanha
    union
    select venda_item_id from ia_produto_promocao
  ),
  agr_itens_dedup as (
    select v.codigo_vendedor, sum(vi.valor_total_liquido - vi.valor_total_custo) as margem
    from ia_todos ia
    join venda_itens vi on vi.id = ia.venda_item_id
    join vendas v on v.id = vi.venda_id
    where v.codigo_vendedor is not null
    group by v.codigo_vendedor
  ),
  agr_margem_total as (
    select
      coalesce(d.codigo_vendedor, r.codigo_vendedor) as codigo_vendedor,
      coalesce(d.margem, 0) + coalesce(r.margem, 0) as margem
    from agr_itens_dedup d
    full outer join agr_cliente_recuperado r on r.codigo_vendedor = d.codigo_vendedor
  )

  -- ---------- Saída final ----------
  select m.codigo_vendedor, m.chave, m.valor
  from metricas_mensais m
  where m.tenant_id = p_tenant_id
    and m.mes_referencia = mes_ref
    and m.chave = 'produtos_em_falta_reportados'
    and fim = fim_natural

  union all

  select cc.codigo_vendedor, 'carteira_clientes_total'::text, count(*)::numeric
  from carteira_clientes cc
  where cc.tenant_id = p_tenant_id
  group by cc.codigo_vendedor

  union all

  select
    cc.codigo_vendedor,
    case cc.tipo_contato when 'whatsapp' then 'whatsapp_enviados' else 'ligacoes_feitas' end,
    count(*)::numeric
  from contatos_clientes cc
  where cc.tenant_id = p_tenant_id
    and cc.tipo_contato in ('whatsapp', 'ligacao')
    and cc.codigo_vendedor is not null
    and cc.contatado_em >= mes_ref
    and cc.contatado_em < fim_exclusivo
  group by cc.codigo_vendedor, cc.tipo_contato

  union all

  select null::integer, 'pendencias_dadas_baixa'::text, count(*)::numeric
  from pendencias p
  where p.tenant_id = p_tenant_id
    and p.baixada = true
    and p.baixada_em >= mes_ref
    and p.baixada_em < fim_exclusivo

  union all

  select b.codigo_vendedor, x.rotulo, x.montante
  from agr_venda_adicional b
  cross join lateral (values
    ('venda_adicional_quantidade', b.qtd),
    ('venda_adicional_valor', b.receita),
    ('venda_adicional_margem', b.margem)
  ) as x(rotulo, montante)

  union all

  select b.codigo_vendedor, x.rotulo, x.montante
  from agr_venda_complementar b
  cross join lateral (values
    ('venda_complementar_quantidade', b.qtd),
    ('venda_complementar_valor', b.receita),
    ('venda_complementar_margem', b.margem)
  ) as x(rotulo, montante)

  union all

  select b.codigo_vendedor, x.rotulo, x.montante
  from agr_venda_campanha b
  cross join lateral (values
    ('venda_campanha_quantidade', b.qtd),
    ('venda_campanha_valor', b.receita),
    ('venda_campanha_margem', b.margem)
  ) as x(rotulo, montante)

  union all

  select b.codigo_vendedor, x.rotulo, x.montante
  from agr_produto_promocao b
  cross join lateral (values
    ('produto_promocao_quantidade', b.qtd),
    ('produto_promocao_valor', b.receita),
    ('produto_promocao_margem', b.margem)
  ) as x(rotulo, montante)

  union all

  select b.codigo_vendedor, x.rotulo, x.montante
  from agr_cliente_recuperado b
  cross join lateral (values
    ('cliente_alto_valor_recuperado_quantidade', b.qtd),
    ('cliente_alto_valor_recuperado_valor', b.receita),
    ('cliente_alto_valor_recuperado_margem', b.margem)
  ) as x(rotulo, montante)

  union all

  select b.codigo_vendedor, x.rotulo, x.montante
  from agr_venda_carteira b
  cross join lateral (values
    ('venda_carteira_quantidade', b.qtd),
    ('venda_carteira_valor', b.receita),
    ('venda_carteira_margem', b.margem)
  ) as x(rotulo, montante)

  union all

  select t.codigo_vendedor, 'margem_bruta_total_deduplicada'::text, t.margem
  from agr_margem_total t
  where t.codigo_vendedor is not null;
end;
$$;

grant execute on function calcular_metricas_mes(uuid, date, date) to authenticated;
