-- ============================================================
-- MULTI-TENANT — FASE 1d: gap encontrado ao popular a segunda
-- farmácia fictícia (produtos_em_falta).
--
-- O trigger incrementar_metrica_produtos_em_falta() (schema.sql)
-- ainda fazia ON CONFLICT (mes_referencia, chave,
-- coalesce(codigo_vendedor,-1)) — o índice único de metricas_mensais
-- virou (tenant_id, mes_referencia, chave, coalesce(...)) na Fase 1
-- Parte G, mas o trigger nunca foi atualizado. Isso quebrava (e ainda
-- quebra, até rodar isso) TODO insert real em produtos_em_falta, tanto
-- pelo app quanto por qualquer seed.
-- ============================================================
create or replace function incrementar_metrica_produtos_em_falta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into metricas_mensais (tenant_id, mes_referencia, codigo_vendedor, chave, valor)
  values (new.tenant_id, date_trunc('month', new.data)::date, null, 'produtos_em_falta_reportados', 1)
  on conflict (tenant_id, mes_referencia, chave, coalesce(codigo_vendedor, -1))
  do update set valor = metricas_mensais.valor + 1, atualizado_em = now();
  return new;
end;
$$;

-- ============================================================
-- vw_metas_progresso / vw_metas_comissao — não expunham tenant_id.
-- Isso é seguro quando chamadas pelo app (security_invoker=true,
-- RLS de metas/vendas/venda_itens já filtra por tenant antes de
-- qualquer join), mas fechar_comissoes_mes roda via service_role
-- (n8n), que ignora RLS por completo — aí o join
-- `v.codigo_vendedor = m.codigo_vendedor` sem tenant_id casaria
-- vendedor de tenants diferentes. Adiciona tenant_id na view (aditivo,
-- só ACRESCENTA coluna no fim, create-or-replace não quebra quem já
-- usa) e trava o join da subquery lateral com tenant_id também, pra
-- ficar seguro independente de quem chama.
-- ============================================================
create or replace view vw_metas_progresso as
select
  m.id as meta_id,
  m.codigo_vendedor,
  vd.nome as nome_vendedor,
  m.ano,
  m.mes,
  m.semana,
  m.valor_meta,
  coalesce(realizado.valor, 0) as valor_realizado,
  m.tenant_id
from metas m
join vendedores vd on vd.tenant_id = m.tenant_id and vd.codigo = m.codigo_vendedor
left join lateral (
  select
    sum(vi.valor_total_liquido) - sum(vi.quantidade_produtos * coalesce(pc.custo_medio, 0)) as valor
  from vendas v
  join venda_itens vi on vi.venda_id = v.id
  left join produto_catalogo pc on pc.tenant_id = v.tenant_id and pc.codigo = vi.codigo_produto
  where v.tenant_id = m.tenant_id
    and v.codigo_vendedor = m.codigo_vendedor
    and v.tipo_cancelamento is null
    and extract(year from v.data_emissao) = m.ano
    and extract(month from v.data_emissao) = m.mes
    and (
      m.semana is null
      or (m.semana = 1 and extract(day from v.data_emissao) between 1 and 7)
      or (m.semana = 2 and extract(day from v.data_emissao) between 8 and 14)
      or (m.semana = 3 and extract(day from v.data_emissao) between 15 and 21)
      or (m.semana = 4 and extract(day from v.data_emissao) >= 22)
    )
) realizado on true;

create or replace view vw_metas_comissao as
select
  mp.meta_id,
  mp.codigo_vendedor,
  mp.nome_vendedor,
  mp.ano,
  mp.mes,
  mp.valor_meta,
  mp.valor_realizado,
  round(mp.valor_realizado / nullif(mp.valor_meta, 0) * 100, 2) as percentual_atingido,
  mp.valor_realizado as margem_bruta_valor,
  round(calc.comissao_valor / nullif(mp.valor_realizado, 0) * 100, 2) as percentual_comissao,
  calc.comissao_valor,
  calc.regra_aplicada,
  calc.detalhe_semanas,
  mp.tenant_id
from vw_metas_progresso mp
join lateral (
  select
    case
      when mp.valor_meta > 0 and mp.valor_realizado >= mp.valor_meta
        then round(mp.valor_realizado * 0.10, 2)
      else round(coalesce(semanal.total_comissao, 0), 2)
    end as comissao_valor,
    case
      when mp.valor_meta > 0 and mp.valor_realizado >= mp.valor_meta then 'flat_10_mensal'
      else 'soma_semanal'
    end as regra_aplicada,
    case
      when mp.valor_meta > 0 and mp.valor_realizado >= mp.valor_meta then null
      else semanal.detalhe
    end as detalhe_semanas
  from (
    select
      sum(s.comissao_semana) as total_comissao,
      jsonb_agg(
        jsonb_build_object(
          'semana', s.semana, 'margem', s.margem, 'meta', s.meta,
          'percentual', s.percentual, 'taxa', s.taxa, 'comissao', s.comissao_semana
        ) order by s.semana
      ) as detalhe
    from (
      select
        mps.semana,
        mps.valor_realizado as margem,
        mps.valor_meta as meta,
        round(mps.valor_realizado / nullif(mps.valor_meta, 0) * 100, 2) as percentual,
        faixa_sem.percentual_comissao as taxa,
        round(mps.valor_realizado * faixa_sem.percentual_comissao / 100, 2) as comissao_semana
      from vw_metas_progresso mps
      join lateral (
        select percentual_comissao
        from faixas_comissao
        where tenant_id = mps.tenant_id
          and percentual_meta_min <= coalesce(round(mps.valor_realizado / nullif(mps.valor_meta, 0) * 100, 2), 0)
        order by percentual_meta_min desc
        limit 1
      ) faixa_sem on true
      where mps.tenant_id = mp.tenant_id
        and mps.codigo_vendedor = mp.codigo_vendedor
        and mps.ano = mp.ano
        and mps.mes = mp.mes
        and mps.semana is not null
    ) s
  ) semanal
) calc on true
where mp.semana is null;

-- fechar_comissoes_mes — mesmo gap: sem parâmetro de tenant, e
-- não sendo SECURITY DEFINER, quando chamada pelo n8n via
-- service_role (que ignora RLS) `vw_metas_comissao` devolveria
-- margem de TODOS os tenants misturados, e o INSERT nem tinha
-- tenant_id na lista de colunas (violaria not-null na hora).
-- Ganha p_tenant_id, filtra vw_metas_comissao por ele e grava.
-- ============================================================
drop function if exists fechar_comissoes_mes(integer, integer);

create or replace function fechar_comissoes_mes(p_tenant_id uuid, p_ano integer, p_mes integer)
returns integer as $$
declare
  v_total integer;
begin
  insert into comissoes_fechadas (
    tenant_id, codigo_vendedor, ano, mes, valor_comissao, margem_bruta_mes,
    meta_mensal, percentual_atingido_mensal, regra_aplicada, detalhe_semanas
  )
  select
    p_tenant_id, codigo_vendedor, ano, mes, comissao_valor, margem_bruta_valor,
    valor_meta, percentual_atingido, regra_aplicada, detalhe_semanas
  from vw_metas_comissao
  where ano = p_ano and mes = p_mes
    and tenant_id = p_tenant_id
  on conflict (tenant_id, codigo_vendedor, ano, mes) do update set
    valor_comissao = excluded.valor_comissao,
    margem_bruta_mes = excluded.margem_bruta_mes,
    meta_mensal = excluded.meta_mensal,
    percentual_atingido_mensal = excluded.percentual_atingido_mensal,
    regra_aplicada = excluded.regra_aplicada,
    detalhe_semanas = excluded.detalhe_semanas,
    fechado_em = now();
  get diagnostics v_total = row_count;
  return v_total;
end;
$$ language plpgsql;
