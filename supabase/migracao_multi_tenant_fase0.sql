-- ============================================================
-- MULTI-TENANT — FASE 0: fundamentos (tabela tenants + profiles.tenant_id)
--
-- Escopo desta migration: só cria a base. NÃO mexe ainda em vendedores,
-- clientes, produtos, vendas etc. — isso é Fase 1 (composite PK
-- (tenant_id, codigo) + reescrita de FKs + RLS por tenant).
--
-- Decisão de PK (Fase 1): tabelas hoje com `codigo integer primary key`
-- (o código cru da Trier) vão trocar pra chave composta
-- (tenant_id, codigo) — o código deixa de ser único sozinho, só é
-- único dentro do tenant. Convenção daqui em diante: toda tabela nova
-- já nasce com `tenant_id uuid not null references tenants(id)`.
-- ============================================================

-- ------------------------------------------------------------
-- 1) TENANTS (uma linha por farmácia)
-- ------------------------------------------------------------
create table tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  -- Config de integração com a Trier desse tenant (URL base, token/bearer
  -- da API SGF). jsonb pra não exigir nova coluna a cada credencial nova
  -- (mesmo padrão já usado em `clientes.grupo`/`clientes.empresa_convenio`).
  trier_config jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table tenants is 'Uma linha por farmácia cliente. Âncora do RLS multi-tenant: profiles.tenant_id -> filtra tudo.';
comment on column tenants.trier_config is 'URL base + token/bearer da API SGF (Trier) desse tenant, usados pelo coletor/n8n.';

-- ------------------------------------------------------------
-- 2) Tenant único da farmácia já existente (piloto)
--    Ajuste o nome antes de rodar, se quiser algo mais descritivo.
-- ------------------------------------------------------------
insert into tenants (nome) values ('Farmácia piloto')
returning id;
-- ⚠️ Copie o `id` retornado acima — ele é usado no passo 3 (backfill de
-- profiles) e depois na Fase 1 (backfill de tenant_id em todas as
-- tabelas de negócio). Se preferir automatizar sem copiar manualmente,
-- rode o bloco alternativo comentado no final deste arquivo.

-- ------------------------------------------------------------
-- 3) profiles.tenant_id
-- ------------------------------------------------------------
alter table profiles
  add column tenant_id uuid references tenants(id);

-- Backfill: todo profile existente pertence ao tenant único criado acima.
-- Subquery em vez de UUID colado à mão — funciona direto, sem copiar
-- nada do retorno do passo 2 (só funciona enquanto houver um único
-- tenant; a partir da Fase 1, com mais de uma farmácia, deixa de fazer
-- sentido um backfill "pega o primeiro que achar").
update profiles
set tenant_id = (select id from tenants where nome = 'Farmácia piloto' limit 1)
where tenant_id is null;

alter table profiles
  alter column tenant_id set not null;

create index idx_profiles_tenant on profiles (tenant_id);

comment on column profiles.tenant_id is 'Farmácia do usuário. Toda policy de RLS das tabelas de negócio (Fase 1) filtra por este valor.';

-- ------------------------------------------------------------
-- Alternativa automatizada aos passos 2-3 (sem copiar id manualmente) —
-- descomente e rode ISSO no lugar dos blocos 2 e 3 acima, não os dois:
-- ------------------------------------------------------------
-- do $$
-- declare
--   v_tenant_id uuid;
-- begin
--   insert into tenants (nome) values ('Farmácia piloto')
--   returning id into v_tenant_id;
--
--   alter table profiles add column tenant_id uuid references tenants(id);
--
--   update profiles set tenant_id = v_tenant_id where tenant_id is null;
--
--   alter table profiles alter column tenant_id set not null;
-- end $$;
--
-- create index idx_profiles_tenant on profiles (tenant_id);
