-- ============================================================
-- MULTI-TENANT — FASE 1: tenant_id em todo lugar, PK composta,
-- FKs compostas, uniques corrigidos, RLS por tenant.
--
-- Pré-requisito: Fase 0 já aplicada (tabela `tenants` + `profiles.tenant_id`).
-- Tenant único existente: 'Farmácia piloto', id 9b8b94ea-c072-4ab3-a8a5-d872f10c3b57
-- (troque a constante abaixo se o id for outro no seu banco).
--
-- ⚠️ ESCOPO — o que este arquivo NÃO cobre:
-- As ~25 views analíticas (vw_metricas_vendedor_diario, vw_carteira_clientes,
-- vw_produtos_promocao_clientes, vw_clientes_produtos, etc.) fazem JOIN
-- direto em colunas `codigo_*` cruas (ex.: `vi.codigo_produto = pp.codigo_produto`,
-- `v.codigo_cliente = c.codigo`). Depois desta migration, o MESMO código
-- pode existir em tenants diferentes com significado diferente — um join
-- sem `tenant_id` na condição pode casar produto/cliente/vendedor do
-- tenant errado, não é só questão de RLS/filtro final, é a query montando
-- linha ERRADA por dentro. Corrigir isso exige reescrever a condição de
-- JOIN de cada view (não só acrescentar um WHERE no fim) — é trabalho
-- grande o bastante pra ser uma migration própria (Fase 1b), pra não
-- arriscar sair braço com bug sutil em 25 views de uma vez. Não rode
-- este arquivo achando que as views já estão seguras — elas AINDA
-- vazam entre tenants até a Fase 1b rodar.
-- ============================================================

-- ============================================================
-- PARTE A — tenant_id em toda tabela de negócio
-- Cada ALTER usa DEFAULT pra preencher linhas já existentes (ex.:
-- faixas_comissao já nasce com 5 linhas via schema.sql) e depois
-- remove o default, pra todo insert novo ser obrigado a informar o
-- tenant explicitamente (evita bug silencioso de "esqueci de passar
-- tenant_id e caiu tudo no piloto por acidente").
-- ============================================================

do $$
declare
  v_tenant_id uuid := '9b8b94ea-c072-4ab3-a8a5-d872f10c3b57';
  v_tabela text;
  v_tabelas text[] := array[
    'sync_control', 'vendedores', 'clientes', 'vendas', 'venda_itens',
    'produtos', 'venda_item_receitas', 'metas', 'metricas_mensais',
    'faixas_comissao', 'atividades_checklist', 'atividade_checklist_vendedores',
    'checklist_respostas', 'produto_catalogo', 'fornecedores', 'compras',
    'compras_itens', 'campanhas', 'campanha_produtos', 'campanhas_venda_adicional',
    'campanha_venda_adicional_produtos', 'venda_item_complementar',
    'campanhas_complementares', 'venda_complementar_oferta_diaria',
    'produtos_em_falta', 'compras_classificacoes', 'pendencias',
    'vendas_vendedor_diario', 'contatos_clientes', 'carteira_clientes',
    'comissao_faixa_alcancada', 'comissoes_fechadas'
  ];
begin
  foreach v_tabela in array v_tabelas loop
    execute format(
      'alter table %I add column tenant_id uuid not null default %L references tenants(id)',
      v_tabela, v_tenant_id
    );
    execute format('alter table %I alter column tenant_id drop default', v_tabela);
    execute format('create index idx_%s_tenant on %I (tenant_id)', v_tabela, v_tabela);
  end loop;
end $$;

-- ============================================================
-- PARTE B — VENDEDORES: PK composta + FKs compostas dos 14 dependentes
-- ============================================================

-- B.1 — drop dos FKs dependentes (nome default: <tabela>_<coluna>_fkey)
alter table vendas drop constraint if exists vendas_codigo_vendedor_fkey;
alter table venda_itens drop constraint if exists venda_itens_codigo_vendedor_fkey;
alter table metas drop constraint if exists metas_codigo_vendedor_fkey;
alter table metricas_mensais drop constraint if exists metricas_mensais_codigo_vendedor_fkey;
alter table atividade_checklist_vendedores drop constraint if exists atividade_checklist_vendedores_codigo_vendedor_fkey;
alter table checklist_respostas drop constraint if exists checklist_respostas_codigo_vendedor_fkey;
alter table venda_item_complementar drop constraint if exists venda_item_complementar_codigo_vendedor_fkey;
alter table venda_complementar_oferta_diaria drop constraint if exists venda_complementar_oferta_diaria_codigo_vendedor_fkey;
alter table contatos_clientes drop constraint if exists contatos_clientes_codigo_vendedor_fkey;
alter table carteira_clientes drop constraint if exists carteira_clientes_codigo_vendedor_fkey;
alter table vendas_vendedor_diario drop constraint if exists vendas_vendedor_diario_codigo_vendedor_fkey;
alter table comissao_faixa_alcancada drop constraint if exists comissao_faixa_alcancada_codigo_vendedor_fkey;
alter table comissoes_fechadas drop constraint if exists comissoes_fechadas_codigo_vendedor_fkey;
alter table profiles drop constraint if exists profiles_codigo_vendedor_fkey;

-- B.2 — swap da PK de vendedores
alter table vendedores drop constraint vendedores_pkey;
alter table vendedores add primary key (tenant_id, codigo);

-- B.3 — recria os 14 FKs como compostos
alter table vendas add constraint vendas_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table venda_itens add constraint venda_itens_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table metas add constraint metas_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table metricas_mensais add constraint metricas_mensais_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table atividade_checklist_vendedores add constraint atividade_checklist_vendedores_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table checklist_respostas add constraint checklist_respostas_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table venda_item_complementar add constraint venda_item_complementar_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table venda_complementar_oferta_diaria add constraint venda_complementar_oferta_diaria_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table contatos_clientes add constraint contatos_clientes_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table carteira_clientes add constraint carteira_clientes_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table vendas_vendedor_diario add constraint vendas_vendedor_diario_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table comissao_faixa_alcancada add constraint comissao_faixa_alcancada_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table comissoes_fechadas add constraint comissoes_fechadas_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);
alter table profiles add constraint profiles_codigo_vendedor_fkey
  foreign key (tenant_id, codigo_vendedor) references vendedores (tenant_id, codigo);

-- ============================================================
-- PARTE C — CLIENTES: PK composta + FKs compostas dos 3 dependentes
-- ============================================================

alter table vendas drop constraint if exists vendas_codigo_cliente_fkey;
alter table contatos_clientes drop constraint if exists contatos_clientes_codigo_cliente_fkey;
alter table carteira_clientes drop constraint if exists carteira_clientes_codigo_cliente_fkey;

alter table clientes drop constraint clientes_pkey;
alter table clientes add primary key (tenant_id, codigo);

alter table vendas add constraint vendas_codigo_cliente_fkey
  foreign key (tenant_id, codigo_cliente) references clientes (tenant_id, codigo);
alter table contatos_clientes add constraint contatos_clientes_codigo_cliente_fkey
  foreign key (tenant_id, codigo_cliente) references clientes (tenant_id, codigo);
alter table carteira_clientes add constraint carteira_clientes_codigo_cliente_fkey
  foreign key (tenant_id, codigo_cliente) references clientes (tenant_id, codigo);

-- ============================================================
-- PARTE D — PRODUTO_CATALOGO: PK composta + FKs compostas dos 4 dependentes
-- ============================================================

alter table campanha_produtos drop constraint if exists campanha_produtos_codigo_produto_fkey;
alter table campanha_venda_adicional_produtos drop constraint if exists campanha_venda_adicional_produtos_codigo_produto_fkey;
alter table compras_classificacoes drop constraint if exists compras_classificacoes_codigo_produto_fkey;
alter table produtos_em_falta drop constraint if exists produtos_em_falta_codigo_produto_fkey;

alter table produto_catalogo drop constraint produto_catalogo_pkey;
alter table produto_catalogo add primary key (tenant_id, codigo);

alter table campanha_produtos add constraint campanha_produtos_codigo_produto_fkey
  foreign key (tenant_id, codigo_produto) references produto_catalogo (tenant_id, codigo);
alter table campanha_venda_adicional_produtos add constraint campanha_venda_adicional_produtos_codigo_produto_fkey
  foreign key (tenant_id, codigo_produto) references produto_catalogo (tenant_id, codigo);
alter table compras_classificacoes add constraint compras_classificacoes_codigo_produto_fkey
  foreign key (tenant_id, codigo_produto) references produto_catalogo (tenant_id, codigo);
alter table produtos_em_falta add constraint produtos_em_falta_codigo_produto_fkey
  foreign key (tenant_id, codigo_produto) references produto_catalogo (tenant_id, codigo);

-- ============================================================
-- PARTE E — FORNECEDORES: PK composta + FK composta de compras
-- ============================================================

alter table compras drop constraint if exists compras_codigo_fornecedor_fkey;

alter table fornecedores drop constraint fornecedores_pkey;
alter table fornecedores add primary key (tenant_id, codigo);

alter table compras add constraint compras_codigo_fornecedor_fkey
  foreign key (tenant_id, codigo_fornecedor) references fornecedores (tenant_id, codigo);

-- ============================================================
-- PARTE F — PRODUTOS (curadoria manual): PK composta, sem dependentes
-- ============================================================

alter table produtos drop constraint produtos_pkey;
alter table produtos add primary key (tenant_id, codigo);

-- ============================================================
-- PARTE G — uniques/PKs que colidiriam entre tenants se não corrigidos
-- (todo unique baseado em codigo_* cru precisa de tenant_id — bigserial
-- id interno já é globalmente único e não precisa).
-- ============================================================

-- sync_control: cursor de sync por entidade — sem tenant_id na PK, dois
-- tenants sincronizando 'venda' ao mesmo tempo pisariam no cursor um do
-- outro (crítico pro n8n multi-tenant da Fase 2).
alter table sync_control drop constraint sync_control_pkey;
alter table sync_control add primary key (tenant_id, entity_name);

-- metas: piso/teto por vendedor+ano+mes(+semana) — codigo_vendedor cru
-- colide entre tenants.
drop index metas_mensal_unique;
create unique index metas_mensal_unique on metas (tenant_id, codigo_vendedor, ano, mes) where semana is null;
drop index metas_semanal_unique;
create unique index metas_semanal_unique on metas (tenant_id, codigo_vendedor, ano, mes, semana) where semana is not null;

-- metricas_mensais: chave/valor por mes+vendedor(ou farmácia toda) —
-- coalesce(-1) sentinel colidiria entre tenants sem tenant_id.
drop index metricas_mensais_unique;
create unique index metricas_mensais_unique
  on metricas_mensais (tenant_id, mes_referencia, chave, coalesce(codigo_vendedor, -1));

-- faixas_comissao: régua fica por tenant agora — cada farmácia pode
-- ajustar seus próprios percentuais sem afetar as outras.
drop index faixas_comissao_min_unique;
create unique index faixas_comissao_min_unique on faixas_comissao (tenant_id, percentual_meta_min);

-- carteira_clientes: (codigo_vendedor, codigo_cliente) cru colidiria
-- entre tenants (dois tenants podem ter vendedor 5 + cliente 10 cada).
alter table carteira_clientes drop constraint carteira_clientes_codigo_vendedor_codigo_cliente_key;
alter table carteira_clientes add constraint carteira_clientes_tenant_vendedor_cliente_key
  unique (tenant_id, codigo_vendedor, codigo_cliente);

-- venda_complementar_oferta_diaria: (codigo_vendedor, data) cru.
alter table venda_complementar_oferta_diaria drop constraint venda_complementar_oferta_diaria_codigo_vendedor_data_key;
alter table venda_complementar_oferta_diaria add constraint venda_complementar_oferta_diaria_tenant_vendedor_data_key
  unique (tenant_id, codigo_vendedor, data);

-- compras_classificacoes: codigo_produto cru era globalmente único —
-- agora só único dentro do tenant.
alter table compras_classificacoes drop constraint compras_classificacoes_codigo_produto_key;
alter table compras_classificacoes add constraint compras_classificacoes_tenant_produto_key
  unique (tenant_id, codigo_produto);

-- vendas: numero_nota/cod_filial/ser_nota_fiscal são do Trier, cru —
-- duas farmácias podem ter a mesma combinação por coincidência.
alter table vendas drop constraint vendas_numero_nota_cod_filial_ser_nota_fiscal_key;
alter table vendas add constraint vendas_tenant_nota_filial_serie_key
  unique (tenant_id, numero_nota, cod_filial, ser_nota_fiscal);

-- vendas_vendedor_diario: PK (data_emissao, codigo_vendedor) cru.
alter table vendas_vendedor_diario drop constraint vendas_vendedor_diario_pkey;
alter table vendas_vendedor_diario add primary key (tenant_id, data_emissao, codigo_vendedor);

-- comissao_faixa_alcancada: PK (codigo_vendedor, ano, mes) cru.
alter table comissao_faixa_alcancada drop constraint comissao_faixa_alcancada_pkey;
alter table comissao_faixa_alcancada add primary key (tenant_id, codigo_vendedor, ano, mes);

-- comissoes_fechadas: unique (codigo_vendedor, ano, mes) cru.
alter table comissoes_fechadas drop constraint comissoes_fechadas_codigo_vendedor_ano_mes_key;
alter table comissoes_fechadas add constraint comissoes_fechadas_tenant_vendedor_ano_mes_key
  unique (tenant_id, codigo_vendedor, ano, mes);

-- Nota: checklist_respostas (atividade_id, codigo_vendedor, data),
-- campanha_produtos (campanha_id, codigo_produto),
-- campanha_venda_adicional_produtos (campanha_id, codigo_produto) e
-- venda_item_receitas/venda_item_complementar (venda_item_id) NÃO
-- precisam de tenant_id no unique — a outra metade da chave já é um
-- id bigserial interno (atividade_id/campanha_id/venda_item_id), que é
-- globalmente único e já pertence a exatamente um tenant.

-- ============================================================
-- PARTE H — RLS: toda policy baseada em
-- "exists (select 1 from profiles p where p.id = auth.uid() ...)"
-- ganha "and p.tenant_id = <tabela>.tenant_id". Sem isso, um
-- codigo_vendedor/codigo_cliente igual em dois tenants faria a policy
-- liberar acesso cruzado (ex.: vendedor 5 do tenant A leria dados do
-- vendedor 5 do tenant B, mesmo sendo pessoas diferentes).
-- ============================================================

-- vendedores
drop policy if exists "vendedores: usuarios autenticados leem" on vendedores;
create policy "vendedores: usuarios autenticados leem"
on vendedores for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = vendedores.tenant_id
));

-- clientes
drop policy if exists "clientes: usuarios autenticados leem" on clientes;
create policy "clientes: usuarios autenticados leem"
on clientes for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = clientes.tenant_id
));

-- vendas
drop policy if exists "vendas: usuarios autenticados leem" on vendas;
create policy "vendas: usuarios autenticados leem"
on vendas for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = vendas.tenant_id
));

-- venda_itens
drop policy if exists "venda_itens: usuarios autenticados leem" on venda_itens;
create policy "venda_itens: usuarios autenticados leem"
on venda_itens for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = venda_itens.tenant_id
));

-- vendas_vendedor_diario
drop policy if exists "vvd: usuarios autenticados leem" on vendas_vendedor_diario;
create policy "vvd: usuarios autenticados leem"
on vendas_vendedor_diario for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = vendas_vendedor_diario.tenant_id
));

-- produtos
drop policy if exists "produtos: usuarios autenticados leem" on produtos;
create policy "produtos: usuarios autenticados leem"
on produtos for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = produtos.tenant_id
));

drop policy if exists "produtos: gestor insere" on produtos;
create policy "produtos: gestor insere"
on produtos for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = produtos.tenant_id
));

drop policy if exists "produtos: gestor atualiza" on produtos;
create policy "produtos: gestor atualiza"
on produtos for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = produtos.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = produtos.tenant_id
));

drop policy if exists "produtos: gestor deleta" on produtos;
create policy "produtos: gestor deleta"
on produtos for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = produtos.tenant_id
));

-- venda_item_receitas
drop policy if exists "receitas: usuarios autenticados leem" on venda_item_receitas;
create policy "receitas: usuarios autenticados leem"
on venda_item_receitas for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = venda_item_receitas.tenant_id
));

drop policy if exists "receitas: usuarios autenticados inserem" on venda_item_receitas;
create policy "receitas: usuarios autenticados inserem"
on venda_item_receitas for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = venda_item_receitas.tenant_id
));

drop policy if exists "receitas: usuarios autenticados atualizam" on venda_item_receitas;
create policy "receitas: usuarios autenticados atualizam"
on venda_item_receitas for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = venda_item_receitas.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = venda_item_receitas.tenant_id
));

-- metas
drop policy if exists "metas: usuarios autenticados leem" on metas;
create policy "metas: usuarios autenticados leem"
on metas for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = metas.tenant_id
));

drop policy if exists "metas: gestor insere" on metas;
create policy "metas: gestor insere"
on metas for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = metas.tenant_id
));

drop policy if exists "metas: gestor atualiza" on metas;
create policy "metas: gestor atualiza"
on metas for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = metas.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = metas.tenant_id
));

drop policy if exists "metas: gestor deleta" on metas;
create policy "metas: gestor deleta"
on metas for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = metas.tenant_id
));

-- produto_catalogo
drop policy if exists "produto_catalogo: usuarios autenticados leem" on produto_catalogo;
create policy "produto_catalogo: usuarios autenticados leem"
on produto_catalogo for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = produto_catalogo.tenant_id
));

-- fornecedores / compras / compras_itens
drop policy if exists "fornecedores: usuarios autenticados leem" on fornecedores;
create policy "fornecedores: usuarios autenticados leem"
on fornecedores for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = fornecedores.tenant_id
));

drop policy if exists "compras: usuarios autenticados leem" on compras;
create policy "compras: usuarios autenticados leem"
on compras for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = compras.tenant_id
));

drop policy if exists "compras_itens: usuarios autenticados leem" on compras_itens;
create policy "compras_itens: usuarios autenticados leem"
on compras_itens for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = compras_itens.tenant_id
));

-- campanhas / campanha_produtos
drop policy if exists "campanhas: gestor tudo" on campanhas;
create policy "campanhas: gestor tudo"
on campanhas for all
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanhas.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanhas.tenant_id
));

drop policy if exists "campanha_produtos: gestor tudo" on campanha_produtos;
create policy "campanha_produtos: gestor tudo"
on campanha_produtos for all
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanha_produtos.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanha_produtos.tenant_id
));

-- campanhas_venda_adicional / campanha_venda_adicional_produtos
drop policy if exists "campanhas_venda_adicional: autenticados leem" on campanhas_venda_adicional;
create policy "campanhas_venda_adicional: autenticados leem"
on campanhas_venda_adicional for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = campanhas_venda_adicional.tenant_id
));

drop policy if exists "campanhas_venda_adicional: gestor insere" on campanhas_venda_adicional;
create policy "campanhas_venda_adicional: gestor insere"
on campanhas_venda_adicional for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanhas_venda_adicional.tenant_id
));

drop policy if exists "campanhas_venda_adicional: gestor atualiza" on campanhas_venda_adicional;
create policy "campanhas_venda_adicional: gestor atualiza"
on campanhas_venda_adicional for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanhas_venda_adicional.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanhas_venda_adicional.tenant_id
));

drop policy if exists "campanhas_venda_adicional: gestor apaga" on campanhas_venda_adicional;
create policy "campanhas_venda_adicional: gestor apaga"
on campanhas_venda_adicional for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanhas_venda_adicional.tenant_id
));

drop policy if exists "campanha_venda_adicional_produtos: autenticados leem" on campanha_venda_adicional_produtos;
create policy "campanha_venda_adicional_produtos: autenticados leem"
on campanha_venda_adicional_produtos for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = campanha_venda_adicional_produtos.tenant_id
));

drop policy if exists "campanha_venda_adicional_produtos: gestor insere" on campanha_venda_adicional_produtos;
create policy "campanha_venda_adicional_produtos: gestor insere"
on campanha_venda_adicional_produtos for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanha_venda_adicional_produtos.tenant_id
));

drop policy if exists "campanha_venda_adicional_produtos: gestor apaga" on campanha_venda_adicional_produtos;
create policy "campanha_venda_adicional_produtos: gestor apaga"
on campanha_venda_adicional_produtos for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanha_venda_adicional_produtos.tenant_id
));

-- venda_item_complementar
drop policy if exists "venda_item_complementar: autenticados leem" on venda_item_complementar;
create policy "venda_item_complementar: autenticados leem"
on venda_item_complementar for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = venda_item_complementar.tenant_id
));

drop policy if exists "venda_item_complementar: vendedor marca o proprio ou gestor marca qualquer" on venda_item_complementar;
create policy "venda_item_complementar: vendedor marca o proprio ou gestor marca qualquer"
on venda_item_complementar for insert
with check (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = venda_item_complementar.tenant_id
    and (
      p.role = 'gestor'
      or (p.role = 'vendedor' and p.codigo_vendedor = venda_item_complementar.codigo_vendedor)
    )
));

drop policy if exists "venda_item_complementar: vendedor desmarca o proprio ou gestor desmarca qualquer" on venda_item_complementar;
create policy "venda_item_complementar: vendedor desmarca o proprio ou gestor desmarca qualquer"
on venda_item_complementar for delete
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = venda_item_complementar.tenant_id
    and (
      p.role = 'gestor'
      or (p.role = 'vendedor' and p.codigo_vendedor = venda_item_complementar.codigo_vendedor)
    )
));

-- campanhas_complementares
drop policy if exists "campanhas_complementares: autenticados leem" on campanhas_complementares;
create policy "campanhas_complementares: autenticados leem"
on campanhas_complementares for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = campanhas_complementares.tenant_id
));

drop policy if exists "campanhas_complementares: gestor insere" on campanhas_complementares;
create policy "campanhas_complementares: gestor insere"
on campanhas_complementares for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanhas_complementares.tenant_id
));

drop policy if exists "campanhas_complementares: gestor atualiza" on campanhas_complementares;
create policy "campanhas_complementares: gestor atualiza"
on campanhas_complementares for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanhas_complementares.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanhas_complementares.tenant_id
));

drop policy if exists "campanhas_complementares: gestor apaga" on campanhas_complementares;
create policy "campanhas_complementares: gestor apaga"
on campanhas_complementares for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = campanhas_complementares.tenant_id
));

-- venda_complementar_oferta_diaria
drop policy if exists "venda_complementar_oferta_diaria: autenticados leem" on venda_complementar_oferta_diaria;
create policy "venda_complementar_oferta_diaria: autenticados leem"
on venda_complementar_oferta_diaria for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = venda_complementar_oferta_diaria.tenant_id
));

drop policy if exists "venda_complementar_oferta_diaria: vendedor grava o proprio ou gestor grava qualquer" on venda_complementar_oferta_diaria;
create policy "venda_complementar_oferta_diaria: vendedor grava o proprio ou gestor grava qualquer"
on venda_complementar_oferta_diaria for insert
with check (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = venda_complementar_oferta_diaria.tenant_id
    and (
      p.role = 'gestor'
      or (p.role = 'vendedor' and p.codigo_vendedor = venda_complementar_oferta_diaria.codigo_vendedor)
    )
));

drop policy if exists "venda_complementar_oferta_diaria: vendedor atualiza o proprio ou gestor atualiza qualquer" on venda_complementar_oferta_diaria;
create policy "venda_complementar_oferta_diaria: vendedor atualiza o proprio ou gestor atualiza qualquer"
on venda_complementar_oferta_diaria for update
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = venda_complementar_oferta_diaria.tenant_id
    and (
      p.role = 'gestor'
      or (p.role = 'vendedor' and p.codigo_vendedor = venda_complementar_oferta_diaria.codigo_vendedor)
    )
))
with check (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = venda_complementar_oferta_diaria.tenant_id
    and (
      p.role = 'gestor'
      or (p.role = 'vendedor' and p.codigo_vendedor = venda_complementar_oferta_diaria.codigo_vendedor)
    )
));

-- produtos_em_falta
drop policy if exists "produtos_em_falta: autenticados leem" on produtos_em_falta;
create policy "produtos_em_falta: autenticados leem"
on produtos_em_falta for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = produtos_em_falta.tenant_id
));

drop policy if exists "produtos_em_falta: autenticados inserem" on produtos_em_falta;
create policy "produtos_em_falta: autenticados inserem"
on produtos_em_falta for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = produtos_em_falta.tenant_id
));

drop policy if exists "produtos_em_falta: autenticados atualizam" on produtos_em_falta;
create policy "produtos_em_falta: autenticados atualizam"
on produtos_em_falta for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = produtos_em_falta.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = produtos_em_falta.tenant_id
));

drop policy if exists "produtos_em_falta: autenticados apagam" on produtos_em_falta;
create policy "produtos_em_falta: autenticados apagam"
on produtos_em_falta for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = produtos_em_falta.tenant_id
));

-- compras_classificacoes
drop policy if exists "compras_classificacoes: gestor le" on compras_classificacoes;
create policy "compras_classificacoes: gestor le"
on compras_classificacoes for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = compras_classificacoes.tenant_id
));

drop policy if exists "compras_classificacoes: gestor insere" on compras_classificacoes;
create policy "compras_classificacoes: gestor insere"
on compras_classificacoes for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = compras_classificacoes.tenant_id
));

drop policy if exists "compras_classificacoes: gestor atualiza" on compras_classificacoes;
create policy "compras_classificacoes: gestor atualiza"
on compras_classificacoes for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = compras_classificacoes.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = compras_classificacoes.tenant_id
));

drop policy if exists "compras_classificacoes: gestor deleta" on compras_classificacoes;
create policy "compras_classificacoes: gestor deleta"
on compras_classificacoes for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = compras_classificacoes.tenant_id
));

-- pendencias
drop policy if exists "pendencias: autenticados leem" on pendencias;
create policy "pendencias: autenticados leem"
on pendencias for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = pendencias.tenant_id
));

drop policy if exists "pendencias: autenticados inserem" on pendencias;
create policy "pendencias: autenticados inserem"
on pendencias for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = pendencias.tenant_id
));

drop policy if exists "pendencias: autenticados atualizam" on pendencias;
create policy "pendencias: autenticados atualizam"
on pendencias for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = pendencias.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = pendencias.tenant_id
));

-- atividades_checklist
drop policy if exists "atividades_checklist: gestor le tudo" on atividades_checklist;
create policy "atividades_checklist: gestor le tudo"
on atividades_checklist for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = atividades_checklist.tenant_id
));

drop policy if exists "atividades_checklist: vendedor le as ativas" on atividades_checklist;
create policy "atividades_checklist: vendedor le as ativas"
on atividades_checklist for select
using (
  ativo = true
  and exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role = 'vendedor' and p.tenant_id = atividades_checklist.tenant_id
  )
);

drop policy if exists "atividades_checklist: gestor insere" on atividades_checklist;
create policy "atividades_checklist: gestor insere"
on atividades_checklist for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = atividades_checklist.tenant_id
));

drop policy if exists "atividades_checklist: gestor atualiza" on atividades_checklist;
create policy "atividades_checklist: gestor atualiza"
on atividades_checklist for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = atividades_checklist.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = atividades_checklist.tenant_id
));

drop policy if exists "atividades_checklist: gestor deleta" on atividades_checklist;
create policy "atividades_checklist: gestor deleta"
on atividades_checklist for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = atividades_checklist.tenant_id
));

-- atividade_checklist_vendedores
drop policy if exists "atividade_checklist_vendedores: autenticados leem" on atividade_checklist_vendedores;
create policy "atividade_checklist_vendedores: autenticados leem"
on atividade_checklist_vendedores for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = atividade_checklist_vendedores.tenant_id
));

drop policy if exists "atividade_checklist_vendedores: gestor insere" on atividade_checklist_vendedores;
create policy "atividade_checklist_vendedores: gestor insere"
on atividade_checklist_vendedores for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = atividade_checklist_vendedores.tenant_id
));

drop policy if exists "atividade_checklist_vendedores: gestor deleta" on atividade_checklist_vendedores;
create policy "atividade_checklist_vendedores: gestor deleta"
on atividade_checklist_vendedores for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = atividade_checklist_vendedores.tenant_id
));

-- checklist_respostas
drop policy if exists "checklist_respostas: select proprio ou gestor" on checklist_respostas;
create policy "checklist_respostas: select proprio ou gestor"
on checklist_respostas for select
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = checklist_respostas.tenant_id
    and (p.role = 'gestor' or p.codigo_vendedor = checklist_respostas.codigo_vendedor)
));

drop policy if exists "checklist_respostas: vendedor insere o proprio" on checklist_respostas;
create policy "checklist_respostas: vendedor insere o proprio"
on checklist_respostas for insert
with check (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = checklist_respostas.tenant_id
    and p.role = 'vendedor'
    and p.codigo_vendedor = checklist_respostas.codigo_vendedor
));

drop policy if exists "checklist_respostas: vendedor atualiza o proprio" on checklist_respostas;
create policy "checklist_respostas: vendedor atualiza o proprio"
on checklist_respostas for update
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = checklist_respostas.tenant_id
    and p.role = 'vendedor'
    and p.codigo_vendedor = checklist_respostas.codigo_vendedor
))
with check (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = checklist_respostas.tenant_id
    and p.role = 'vendedor'
    and p.codigo_vendedor = checklist_respostas.codigo_vendedor
));

-- faixas_comissao
drop policy if exists "faixas_comissao: usuarios autenticados leem" on faixas_comissao;
create policy "faixas_comissao: usuarios autenticados leem"
on faixas_comissao for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = faixas_comissao.tenant_id
));

drop policy if exists "faixas_comissao: gestor insere" on faixas_comissao;
create policy "faixas_comissao: gestor insere"
on faixas_comissao for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = faixas_comissao.tenant_id
));

drop policy if exists "faixas_comissao: gestor atualiza" on faixas_comissao;
create policy "faixas_comissao: gestor atualiza"
on faixas_comissao for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = faixas_comissao.tenant_id
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = faixas_comissao.tenant_id
));

drop policy if exists "faixas_comissao: gestor deleta" on faixas_comissao;
create policy "faixas_comissao: gestor deleta"
on faixas_comissao for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = faixas_comissao.tenant_id
));

-- comissao_faixa_alcancada
drop policy if exists "comissao_faixa_alcancada: select proprio ou gestor" on comissao_faixa_alcancada;
create policy "comissao_faixa_alcancada: select proprio ou gestor"
on comissao_faixa_alcancada for select
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = comissao_faixa_alcancada.tenant_id
    and (p.role = 'gestor' or p.codigo_vendedor = comissao_faixa_alcancada.codigo_vendedor)
));

-- carteira_clientes
drop policy if exists "carteira_clientes: select proprio ou gestor" on carteira_clientes;
create policy "carteira_clientes: select proprio ou gestor"
on carteira_clientes for select
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = carteira_clientes.tenant_id
    and (p.role = 'gestor' or p.codigo_vendedor = carteira_clientes.codigo_vendedor)
));

drop policy if exists "carteira_clientes: insere proprio ou gestor" on carteira_clientes;
create policy "carteira_clientes: insere proprio ou gestor"
on carteira_clientes for insert
with check (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = carteira_clientes.tenant_id
    and (p.role = 'gestor' or p.codigo_vendedor = carteira_clientes.codigo_vendedor)
));

drop policy if exists "carteira_clientes: deleta proprio ou gestor" on carteira_clientes;
create policy "carteira_clientes: deleta proprio ou gestor"
on carteira_clientes for delete
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = carteira_clientes.tenant_id
    and (p.role = 'gestor' or p.codigo_vendedor = carteira_clientes.codigo_vendedor)
));

-- sync_control
drop policy if exists "sync_control: usuarios autenticados leem" on sync_control;
create policy "sync_control: usuarios autenticados leem"
on sync_control for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = sync_control.tenant_id
));

-- contatos_clientes
drop policy if exists "contatos_clientes: usuarios autenticados leem" on contatos_clientes;
create policy "contatos_clientes: usuarios autenticados leem"
on contatos_clientes for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = contatos_clientes.tenant_id
));

drop policy if exists "contatos_clientes: usuarios autenticados inserem" on contatos_clientes;
create policy "contatos_clientes: usuarios autenticados inserem"
on contatos_clientes for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.tenant_id = contatos_clientes.tenant_id
));

-- metricas_mensais
drop policy if exists "metricas_mensais: gestor le" on metricas_mensais;
create policy "metricas_mensais: gestor le"
on metricas_mensais for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor' and p.tenant_id = metricas_mensais.tenant_id
));

-- comissoes_fechadas
drop policy if exists "comissoes_fechadas: select proprio ou gestor" on comissoes_fechadas;
create policy "comissoes_fechadas: select proprio ou gestor"
on comissoes_fechadas for select
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.tenant_id = comissoes_fechadas.tenant_id
    and (p.role = 'gestor' or p.codigo_vendedor = comissoes_fechadas.codigo_vendedor)
));
