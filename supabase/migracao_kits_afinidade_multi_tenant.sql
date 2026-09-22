-- ============================================================
-- KITS DE AFINIDADE — versão multi-tenant (substitui
-- migracao_kits_afinidade.sql pra projetos novos/já migrados pra
-- Fase 1). Essa feature nunca tinha sido aplicada neste projeto (São
-- Paulo) — achado comparando as tabelas que o app espera
-- (supabaseRepository.ts) contra as que existem de fato no banco.
--
-- Diferenças da versão original:
-- - campanha_kits e campanha_kit_produtos nascem com tenant_id.
-- - campanha_kit_produtos.codigo_produto vira FK composta
--   (tenant_id, codigo_produto) -> produto_catalogo (tenant_id, codigo),
--   já que produto_catalogo tem PK composta desde a Fase 1.
-- - RLS ganha "and p.tenant_id = ...tenant_id", mesmo padrão da Fase 1
--   Parte H.
-- - fn_sugerir_pares_afinidade não precisa de nenhuma mudança: é uma
--   function comum (não SECURITY DEFINER), roda com o privilégio de
--   quem chama — RLS de vendas/venda_itens/produto_catalogo já
--   filtra por tenant sozinha (mesmo raciocínio das views
--   security_invoker=true da Fase 1b).
-- ============================================================

create table campanha_kits (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id),
  campanha_id bigint not null references campanhas(id) on delete cascade,
  nome text,
  tipo_precificacao text not null check (tipo_precificacao in ('percentual', 'preco_fixo')),
  percentual_desconto_item numeric(5,2) check (percentual_desconto_item is null or percentual_desconto_item between 0 and 100),
  preco_fixo numeric(12,2) check (preco_fixo is null or preco_fixo > 0),
  quantidade_cartazes integer not null default 1 check (quantidade_cartazes > 0),
  data_inicio date,
  data_fim date,
  created_at timestamptz not null default now(),
  constraint campanha_kits_precificacao_coerente check (
    (tipo_precificacao = 'percentual' and percentual_desconto_item is not null and preco_fixo is null)
    or (tipo_precificacao = 'preco_fixo' and preco_fixo is not null and percentual_desconto_item is null)
  )
);

create table campanha_kit_produtos (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id),
  kit_id bigint not null references campanha_kits(id) on delete cascade,
  codigo_produto integer not null,
  quantidade integer not null default 1 check (quantidade > 0),
  unique (kit_id, codigo_produto),
  foreign key (tenant_id, codigo_produto) references produto_catalogo (tenant_id, codigo)
);

create index idx_campanha_kits_campanha on campanha_kits (campanha_id);
create index idx_campanha_kits_tenant on campanha_kits (tenant_id);
create index idx_campanha_kit_produtos_kit on campanha_kit_produtos (kit_id);
create index idx_campanha_kit_produtos_tenant on campanha_kit_produtos (tenant_id);

alter table campanha_kits enable row level security;
alter table campanha_kit_produtos enable row level security;

create policy "campanha_kits: gestor tudo"
on campanha_kits for all
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanha_kits.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanha_kits.tenant_id
));

create policy "campanha_kit_produtos: gestor tudo"
on campanha_kit_produtos for all
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanha_kit_produtos.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanha_kit_produtos.tenant_id
));

-- ============================================================
-- fn_sugerir_pares_afinidade — idêntica à original, sem mudanças
-- (ver nota no topo do arquivo).
-- ============================================================
create or replace function fn_sugerir_pares_afinidade(
  p_codigos_seed integer[],
  p_dias integer default 120,
  p_min_co_ocorrencias integer default 8,
  p_lift_minimo numeric default 1.2,
  p_limite integer default 50
)
returns table (
  codigo_produto_seed integer,
  codigo_produto_parceiro integer,
  co_ocorrencias bigint,
  vendas_seed bigint,
  vendas_parceiro bigint,
  lift numeric
)
language sql
stable
as $$
  with janela as (
    select v.id as venda_id
    from vendas v
    where v.data_emissao >= current_date - make_interval(days => p_dias)
      and v.tipo_cancelamento is null
  ),
  total as (
    select count(*) as n from janela
  ),
  contagem_produto as (
    select vi.codigo_produto, count(distinct vi.venda_id) as vendas
    from venda_itens vi
    join janela j on j.venda_id = vi.venda_id
    group by vi.codigo_produto
  ),
  pares as (
    select
      a.codigo_produto as seed,
      b.codigo_produto as parceiro,
      count(distinct a.venda_id) as co_ocorrencias
    from venda_itens a
    join janela j on j.venda_id = a.venda_id
    join venda_itens b on b.venda_id = a.venda_id and b.codigo_produto <> a.codigo_produto
    where a.codigo_produto = any(p_codigos_seed)
    group by a.codigo_produto, b.codigo_produto
    having count(distinct a.venda_id) >= p_min_co_ocorrencias
  )
  select
    p.seed,
    p.parceiro,
    p.co_ocorrencias,
    cs.vendas,
    cp.vendas,
    round((p.co_ocorrencias::numeric * (select n from total)) / nullif(cs.vendas * cp.vendas, 0), 2) as lift
  from pares p
  join contagem_produto cs on cs.codigo_produto = p.seed
  join contagem_produto cp on cp.codigo_produto = p.parceiro
  where (p.co_ocorrencias::numeric * (select n from total)) / nullif(cs.vendas * cp.vendas, 0) >= p_lift_minimo
  order by lift desc, co_ocorrencias desc
  limit p_limite;
$$;
