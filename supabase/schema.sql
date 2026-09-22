-- ============================================================
-- CONTROLE DE SINCRONIZAÇÃO (usado pelo coletor)
-- ============================================================
create table sync_control (
  entity_name text primary key,       -- ex: 'venda', 'cliente', 'vendedor'
  last_synced_at timestamptz,         -- quando rodou com sucesso
  last_cursor timestamptz             -- valor usado como dataInicial na próxima chamada obter-alterados
);

-- ============================================================
-- VENDEDOR (VendedorIntegracaoDto)
-- ============================================================
create table vendedores (
  codigo integer primary key,
  nome text not null,
  numero_cpf text,
  cep text,
  email text,
  ativo boolean default true,
  updated_at timestamptz default now()
);

-- ============================================================
-- PROFILES — vincula um usuário do Supabase Auth a um vendedor e
-- define seu papel (vendedor vs gestor). Preenchido manualmente (ou
-- por processo administrativo) ao criar cada usuário no Supabase Auth
-- — não é self-signup. Criada aqui (não em rls_policies.sql) porque
-- `compras_classificacoes`/`comissoes_fechadas` mais abaixo já
-- referenciam `profiles`, e `profiles.codigo_vendedor` referencia
-- `vendedores` — precisa ficar entre as duas. RLS e policies de
-- `profiles` continuam em rls_policies.sql.
-- ============================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  codigo_vendedor integer references vendedores(codigo),
  role text not null check (role in ('vendedor', 'gestor')),
  -- Expo push token do dispositivo — gravado pelo próprio app no login
  -- (ver AuthContext/lib/notifications.ts obterPushToken), lido pelo
  -- workflow n8n de notificação de comissão (roda como service_role,
  -- ignora RLS). Não é sensível, mas só o dono deveria escrever nele.
  expo_push_token text,
  created_at timestamptz default now()
);

-- ============================================================
-- CLIENTE (ClienteIntegracaoDto)
-- ============================================================
create table clientes (
  codigo integer primary key,
  nome text,
  numero_cpf_cnpj text,
  codigo_cidade text,
  email text,
  cep text,
  estado text,
  fone text,
  -- [12/08/2026] SEM equivalente na API SGF (ClienteIntegracaoDto só
  -- tem "fone") -- confirmado checando os 3 endpoints de leitura de
  -- cliente, nenhum devolve celular. Só entra por importação manual de
  -- relatório da Trier (ver supabase/importar_celular_clientes.sql) --
  -- a sincronização normal (coletor) nunca escreve nesta coluna, então
  -- fica intacta entre syncs.
  celular text,
  bairro text,
  logradouro text,
  numero_endereco text,
  ativo boolean default true,
  data_nascimento date,      -- dataNascimento da API (date-time; guarda só a data)
  grupo jsonb,              -- objeto "Grupo" retornado pela API, guardado como está
  empresa_convenio jsonb,    -- objeto "EmpresaConvenio" retornado pela API
  updated_at timestamptz default now()
);

-- ============================================================
-- VENDA (VendaIntegracaoDto) — cabeçalho da nota
-- ============================================================
create table vendas (
  id bigserial primary key,
  numero_nota integer not null,
  numero_nota_origem integer,
  tipo_cancelamento text,
  data_emissao date not null,
  hora_emissao time,
  codigo_vendedor integer references vendedores(codigo),
  codigo_cliente integer references clientes(codigo),
  entrega boolean default false,
  pagamento_na_entrega boolean default false,
  condicao_pagamento jsonb,      -- objeto "CondicaoPagamento" da API
  vlr_troco numeric(12,2),
  numero_cupom_fiscal integer,
  numero_nota_fiscal integer,
  xml_nfe text,
  cod_parceiro integer,
  cod_filial integer,
  venda_ifood boolean default false,
  venda_ecommerce boolean default false,
  cod_ecommerce text,
  ser_nota_fiscal text,
  modelo_venda text,
  dados_entrega jsonb,
  updated_at timestamptz default now(),
  unique (numero_nota, cod_filial, ser_nota_fiscal)
);

create index idx_vendas_data_emissao on vendas (data_emissao);
create index idx_vendas_vendedor on vendas (codigo_vendedor);
create index idx_vendas_cliente on vendas (codigo_cliente);

-- ============================================================
-- ITEM DE VENDA (VendaItemIntegracaoDto)
-- ============================================================
create table venda_itens (
  id bigserial primary key,
  venda_id bigint not null references vendas(id) on delete cascade,
  codigo_produto integer not null,
  codigo_vendedor integer references vendedores(codigo),
  quantidade_produtos numeric(12,3),
  valor_total_bruto numeric(12,2),
  valor_total_liquido numeric(12,2),
  valor_total_custo numeric(12,2),
  parceiro text,
  codigo_medico integer,
  cod_barras text,
  num_sequencial integer,
  prc_comissao numeric(6,3),      -- percentual de comissão
  vlr_desconto numeric(12,2),
  vlr_unitario numeric(12,2),
  vlr_custo_aquisicao numeric(12,2),
  vlr_custo_produto numeric(12,2),
  tabela_desconto text,
  prc_desconto numeric(6,3),
  prc_desconto_max numeric(6,3),
  venda_com_desconto boolean default false
);

create index idx_itens_venda on venda_itens (venda_id);
create index idx_itens_vendedor on venda_itens (codigo_vendedor);
create index idx_itens_produto on venda_itens (codigo_produto);

-- ============================================================
-- PRODUTOS — NÃO vem da API SGF (a Trier não expõe catálogo de
-- produtos no escopo integrado). Curadoria manual da farmácia:
-- só entram aqui os produtos que a farmácia quer rastrear pra
-- promoção e/ou controle de receita — não é o catálogo inteiro.
-- `codigo` é o mesmo codigoProduto que aparece em venda_itens,
-- mas SEM foreign key formal: a imensa maioria dos produtos
-- vendidos nunca vai ter linha aqui, e venda_itens é alimentada
-- pelo coletor (API), que não sabe nada sobre essa curadoria.
-- ============================================================
create table produtos (
  codigo integer primary key,
  nome text not null,
  preco_atual numeric(12,2) not null,
  preco_anterior numeric(12,2),
  em_promocao boolean not null default false,
  percentual_desconto numeric(5,2),
  exige_receita boolean not null default false,
  tipo_receita text check (tipo_receita in ('comum', 'controle_especial', 'antimicrobiano')),
  updated_at timestamptz default now(),
  constraint produtos_tipo_receita_coerente check (
    (exige_receita = false and tipo_receita is null) or
    (exige_receita = true and tipo_receita is not null)
  )
);

create index idx_produtos_em_promocao on produtos (em_promocao) where em_promocao = true;
create index idx_produtos_exige_receita on produtos (exige_receita) where exige_receita = true;

-- ============================================================
-- RECEITAS DE PRODUTOS CONTROLADOS — registro de que o
-- vendedor fotografou/anexou a receita de um item vendido que
-- exige. Preenchida pelo próprio app (não pelo coletor). A foto
-- em si fica num bucket do Supabase Storage (ex.: "receitas");
-- aqui guardamos só a referência (path/URL).
-- ============================================================
create table venda_item_receitas (
  id bigserial primary key,
  venda_item_id bigint not null unique references venda_itens(id) on delete cascade,
  tipo_receita text not null check (tipo_receita in ('comum', 'controle_especial', 'antimicrobiano')),
  foto_url text,
  anexado_por uuid references auth.users(id),
  data_anexo timestamptz not null default now()
);

-- ============================================================
-- METAS — mensal + 4 buckets semanais fixos (1–7, 8–14, 15–21,
-- 22–fim do mês), por vendedor. Cadastrada manualmente pelo
-- gestor (aba "Metas" do app) — não vem da API SGF.
-- `semana` null representa a meta do mês inteiro; 1–4 são os
-- buckets semanais. Dois índices únicos parciais porque NULL não
-- é bloqueado por unique constraint comum (cada NULL é distinto).
-- ============================================================
create table metas (
  id bigserial primary key,
  codigo_vendedor integer not null references vendedores(codigo),
  ano integer not null,
  mes integer not null check (mes between 1 and 12),
  semana integer check (semana between 1 and 4),
  valor_meta numeric(12,2) not null check (valor_meta >= 0),
  updated_at timestamptz default now()
);

create unique index metas_mensal_unique on metas (codigo_vendedor, ano, mes) where semana is null;
create unique index metas_semanal_unique on metas (codigo_vendedor, ano, mes, semana) where semana is not null;

-- Meta DIÁRIA propositalmente NÃO tem tabela própria: é sempre a meta
-- mensal dividida pelos dias do mês (ver metaDiaria() em src/lib/metas.ts
-- no app, e a mesma conta replicada em vw_metas_progresso/dashboard). Isso
-- evita um terceiro nível de cadastro que poderia dessincronizar do
-- mensal — decisão tomada de propósito, não pendência.

-- Vendedores "ativos" pra fim de seletor/lançamento em massa (aba Metas
-- do gestor). NÃO usa vendedores.ativo — esse flag vem cru da Trier e
-- inclui muito código antigo/de teste que nunca foi desativado lá. Em
-- vez disso, considera ativo quem teve pelo menos 1 venda nos últimos
-- 60 dias — mesmo critério implícito que já faz o resto do app (Ranking,
-- Desempenho) só mostrar quem realmente está vendendo.
create or replace view vw_vendedores_ativos as
select v.codigo, v.nome
from vendedores v
where exists (
  select 1 from vendas ve
  where ve.codigo_vendedor = v.codigo
    and ve.data_emissao >= (current_date - interval '60 days')
)
order by v.nome;

-- ============================================================
-- METRICAS_MENSAIS (23/08/2026) — relatório mensal de acompanhamento
-- (aba "Relatório mensal", só gestor). Formato chave/valor (não uma
-- coluna fixa por métrica) pra métrica nova não exigir migração de
-- schema. codigo_vendedor NULL = métrica da farmácia inteira (ex.:
-- produtos em falta reportados, pendências dadas baixa — só a
-- quantidade, sem quebrar por vendedor); não-nulo = métrica daquele
-- vendedor (carteira, whatsapp, vendas, etc.). Escrito pelo workflow
-- n8n de fechamento de mês (service_role) + pelo trigger abaixo.
-- ============================================================
create table metricas_mensais (
  id bigserial primary key,
  mes_referencia date not null,
  codigo_vendedor integer references vendedores(codigo),
  chave text not null,
  valor numeric(14,2) not null default 0,
  atualizado_em timestamptz not null default now()
);

-- unique por expressão (coalesce) — unique constraint comum trata cada
-- NULL como distinto, o que quebraria o ON CONFLICT do upsert de
-- fechamento pra métrica da farmácia (codigo_vendedor null).
create unique index metricas_mensais_unique
  on metricas_mensais (mes_referencia, chave, coalesce(codigo_vendedor, -1));

create index idx_metricas_mensais_mes on metricas_mensais (mes_referencia desc);

-- Trigger de contador ao vivo (incrementar_metrica_produtos_em_falta)
-- fica declarado mais abaixo, junto da tabela produtos_em_falta —
-- precisa dela já existir antes de criar o trigger.

-- ============================================================
-- FAIXAS_COMISSAO — régua de comissão sobre margem bruta, por
-- percentual de meta MENSAL atingido (comissão não é calculada por
-- semana nem por dia, só no fechamento do mês). Tabela (não CASE fixo
-- no SQL) pra a farmácia poder ajustar os percentuais sem reaplicar
-- schema. `percentual_meta_min` é o piso da faixa (inclusive); a faixa
-- aplicada é a de maior piso que o percentual atingido alcança — ex.:
-- 95% atingido cai na faixa de piso 90 (8%), não na de 100.
-- ============================================================
create table faixas_comissao (
  id bigserial primary key,
  percentual_meta_min numeric(5,2) not null check (percentual_meta_min >= 0),
  percentual_comissao numeric(5,2) not null check (percentual_comissao >= 0),
  updated_at timestamptz default now()
);

create unique index faixas_comissao_min_unique on faixas_comissao (percentual_meta_min);

insert into faixas_comissao (percentual_meta_min, percentual_comissao) values
  (100, 10),
  (90, 8),
  (80, 7),
  (70, 5),
  (0, 3);

-- ============================================================
-- CHECKLIST DIÁRIO — atividades cadastradas pelo gestor (aba "Check
-- list" do app) e marcadas pelo vendedor todo dia. Hoje só existe como
-- mock local (AsyncStorage) no app; estas tabelas são o próximo passo
-- pra ter histórico real de conclusão no backend.
-- `atividade_checklist_vendedores` (join table, não coluna) — SEM
-- linha nenhuma pra uma atividade = vale pra todo mundo; COM linhas =
-- só aparece no checklist desses vendedores específicos (pode ser mais
-- de um). Join table em vez de array/coluna única pra manter FK de
-- verdade com vendedores(codigo), igual campanha_produtos.
-- `dias_semana` usa a mesma numeração do expo-notifications (domingo=1
-- ... sábado=7) pra não precisar converter na hora de agendar o
-- lembrete — default segunda a sábado, igual o comportamento antigo
-- (fixo, sem esse campo).
-- `horario` (HH:00 — só a hora, minuto sempre zero) dispara lembrete
-- push nos dias marcados — ver src/lib/notifications.ts no app.
-- `checklist_respostas` é uma marcação por atividade/vendedor/dia (não
-- por venda), única por dia — evita duplicar/perder a marcação se o
-- vendedor reabrir o app.
-- ============================================================
create table atividades_checklist (
  id bigserial primary key,
  titulo text not null,
  horario time,
  ativo boolean not null default true,
  dias_semana integer[] not null default '{2,3,4,5,6,7}',
  created_at timestamptz default now()
);

create table atividade_checklist_vendedores (
  atividade_id bigint not null references atividades_checklist(id) on delete cascade,
  codigo_vendedor integer not null references vendedores(codigo),
  primary key (atividade_id, codigo_vendedor)
);

create table checklist_respostas (
  id bigserial primary key,
  atividade_id bigint not null references atividades_checklist(id) on delete cascade,
  codigo_vendedor integer not null references vendedores(codigo),
  data date not null,
  concluida boolean not null default false,
  concluida_em timestamptz,
  unique (atividade_id, codigo_vendedor, data)
);

create index idx_checklist_respostas_vendedor_data on checklist_respostas (codigo_vendedor, data);

-- ============================================================
-- PRODUTO_CATALOGO — futuramente sincronizado do ProdutoIntegracaoDto
-- real (Trier: /integracao/produto/obter-*), quando o token for
-- liberado. Diferente de `produtos` (curadoria manual pequena, só
-- promoção/receita): este é o catálogo cheio (nome, custo, estoque,
-- categoria, marca), usado pelo módulo de Campanhas/Cartazetes pra
-- calcular margem e decidir o que promover.
-- ============================================================
create table produto_catalogo (
  codigo integer primary key,
  codigo_barras text,
  nome text not null,
  categoria text,           -- ProdutoIntegracaoDto.nomeCategoria — tipo de uso (ex.: "Uso Adulto"), não é bem uma categoria de produto
  grupo text,                -- ProdutoIntegracaoDto.nomeGrupo — grupo de verdade (ex.: "Analgésicos", "Fraldas") — mais útil pra filtro de produto/categoria
  marca text,
  preco_venda numeric(12,2) not null,
  custo_medio numeric(12,2) not null,
  estoque_atual integer not null default 0,
  -- ProdutoIntegracaoDto.tipoLista — classificação regulatória
  -- (Portaria 344/98): null/vazio = comum, "T" = antimicrobiano
  -- (retenção de receita), qualquer outro valor (A1/A2/A3/B1/B2/
  -- C1..C5) = controle especial (psicotrópico etc.). Confirmado
  -- 02/08/2026 comparando produto comum vs. grupos ETICO/GENERICO
  -- CONTROLADOS e ANTIMICROBIANOS — é a Trier já mandando pronto se
  -- o produto exige receita, sem precisar de curadoria manual.
  tipo_lista text,
  updated_at timestamptz default now()
);

create index idx_produto_catalogo_categoria on produto_catalogo (categoria);
create index idx_produto_catalogo_grupo on produto_catalogo (grupo);
create index idx_produto_catalogo_tipo_lista on produto_catalogo (tipo_lista) where tipo_lista is not null;

-- ============================================================
-- FORNECEDORES / COMPRAS — espelha FornecedorIntegracaoDto e
-- CompraIntegracaoDto/ComprasItemIntegracaoDto (só leitura, igual
-- venda/cliente). Alimenta a "Lista de compras" (Compras/Dose Certa):
-- fornecedor sugerido e fator de compra (conversão de embalagem) de
-- cada produto são INFERIDOS da compra mais recente, não cadastrados
-- à mão — a API não expõe um cadastro "fornecedor preferido por
-- produto" separado. Prazo de entrega e data de última cotação (que
-- aparecem na tela do Dose Certa dentro do Trier) NÃO têm endpoint de
-- leitura na integração — não dá pra trazer isso sem inventar dado.
-- ============================================================
create table fornecedores (
  codigo integer primary key,
  nome_fantasia text not null,
  razao_social text,
  numero_cnpj text,
  nome_cidade text,
  email text,
  ativo boolean default true,
  updated_at timestamptz default now()
);

create table compras (
  id bigserial primary key,
  data_entrada timestamptz not null,
  numero_nota_fiscal integer,
  codigo_fornecedor integer references fornecedores(codigo),
  valor_total_nota numeric(12,2),
  valor_total_produtos numeric(12,2),
  quantidade_itens integer,
  chave_acesso_nfe text,
  updated_at timestamptz default now()
);

create index idx_compras_data_entrada on compras (data_entrada);
create index idx_compras_fornecedor on compras (codigo_fornecedor);

create table compras_itens (
  id bigserial primary key,
  compra_id bigint not null references compras(id) on delete cascade,
  codigo_produto integer not null,
  quantidade_produtos integer,
  fator_compra integer default 1,      -- unidades por caixa/pacote do fornecedor
  valor_unitario numeric(12,2),
  valor_unitario_liquido numeric(12,2),
  valor_custo numeric(12,2),
  valor_st numeric(12,2)
);

create index idx_compras_itens_compra on compras_itens (compra_id);
create index idx_compras_itens_produto on compras_itens (codigo_produto);

-- ============================================================
-- CAMPANHAS — promoção avulsa decidida pela farmácia (margem +
-- estoque + venda recente), FORA do encarte oficial. O Trier NÃO tem
-- endpoint de escrita pra desconto/campanha (só leitura, igual
-- venda/cliente) — por isso "campanha" é uma entidade NOSSA, sem
-- espelho no sistema deles. O preço só vale no caixa depois que o
-- .txt gerado pela tela de Cartazetes é importado manualmente no
-- Trier (ver docs/txt.txt — layout inferido, não documentado
-- oficialmente pela Trier).
-- ============================================================
create table campanhas (
  id bigserial primary key,
  nome text not null,
  data_inicio date not null,
  data_fim date not null,
  criado_por uuid references auth.users(id),
  created_at timestamptz default now(),
  constraint campanhas_datas_coerentes check (data_fim >= data_inicio)
);

create table campanha_produtos (
  id bigserial primary key,
  campanha_id bigint not null references campanhas(id) on delete cascade,
  codigo_produto integer not null references produto_catalogo(codigo),
  preco_promocional numeric(12,2) not null check (preco_promocional > 0),
  percentual_desconto numeric(5,2) not null default 0,
  quantidade_cartazes integer not null default 1 check (quantidade_cartazes > 0),
  -- Override de validade por item (editável em Cartazetes) — null =
  -- sem override, segue a validade da campanha.
  data_inicio date,
  data_fim date,
  -- Promoção "kit" (18/08/2026, ex.: "compre 3 pague 2", "50% no 2º
  -- item") — alternativa ao desconto simples por unidade acima. Quando
  -- 'kit', preco_promocional/percentual_desconto ficam sem uso pro
  -- cartaz/preço (o app ignora, usa os dois campos de kit).
  tipo_promocao text not null default 'unitario' check (tipo_promocao in ('unitario', 'kit')),
  kit_quantidade_minima integer check (kit_quantidade_minima is null or kit_quantidade_minima >= 2),
  kit_percentual_desconto_item numeric(5,2)
    check (kit_percentual_desconto_item is null or kit_percentual_desconto_item between 0 and 100),
  -- Segundo formato de kit (02/09/2026): preço fechado pras
  -- kit_quantidade_minima unidades (ex.: "3 por R$29,99"), em vez de
  -- percentual no último item. Exatamente um dos dois quando é kit —
  -- ver constraint campanha_produtos_kit_precificacao_coerente.
  kit_preco_fixo numeric(12,2) check (kit_preco_fixo is null or kit_preco_fixo > 0),
  unique (campanha_id, codigo_produto),
  constraint campanha_produtos_kit_precificacao_coerente check (
    tipo_promocao <> 'kit'
    or ((kit_percentual_desconto_item is not null) <> (kit_preco_fixo is not null))
  )
);

-- Desempenho de vendas por campanha (26/08/2026) — alimenta a lista em
-- CampanhasScreen, que antes só mostrava quantidade de PRODUTOS
-- cadastrados na campanha (estático), não quantidade VENDIDA nem
-- valor (dado real de performance). Mesmo critério de join usado em
-- calcular_metricas_mes (ia_venda_campanha/agr_venda_campanha) —
-- casa por codigo_produto dentro da janela de validade EFETIVA do
-- item (coalesce com a validade da campanha) — e exclui venda
-- cancelada/devolvida, mesma convenção do resto do app.
create view vw_campanhas_desempenho as
select
  cp.campanha_id,
  sum(vi.quantidade_produtos) as quantidade_vendida,
  sum(vi.valor_total_liquido) as valor_vendido
from campanha_produtos cp
join campanhas c on c.id = cp.campanha_id
join venda_itens vi on vi.codigo_produto = cp.codigo_produto
join vendas v on v.id = vi.venda_id
  and v.data_emissao between coalesce(cp.data_inicio, c.data_inicio) and coalesce(cp.data_fim, c.data_fim)
where v.codigo_vendedor is not null
  and v.tipo_cancelamento is null
group by cp.campanha_id;

-- ============================================================
-- CAMPANHAS DE VENDA ADICIONAL (03/08/2026) — incentivo pontual pra
-- vendedor empurrar produto(s) específico(s) num período (ex.: "venda
-- protetor solar até dia 20, os 3 primeiros ganham prêmio"). DIFERENTE
-- de `campanhas`/`campanha_produtos` acima (aquilo é decisão de PREÇO
-- pra cartazete impresso) — aqui não mexe em preço nenhum, é só
-- incentivo/premiação de venda. Gestor cadastra (aba "Venda
-- adicional"), todo vendedor vê e acompanha (card em Alertas).
--
-- tipo_premiacao:
--   'ranking'         — os N primeiros por quantidade vendida ganham,
--                        valor por posição em premiacao_ranking (jsonb,
--                        ex.: [{"posicao":1,"valor":200}, ...]) — array
--                        em vez de tabela à parte, só pra exibir, não
--                        precisa de query relacional.
--   'meta_individual'  — todo vendedor que bater meta_quantidade ganha
--                        premiacao_meta_valor (mesmo prêmio pra todo
--                        mundo que bater, sem ranking).
--
-- horario_lembrete (HH:mm, opcional) — preparado pra reaproveitar o
-- mesmo mecanismo de notificação local do Checklist
-- (sincronizarNotificacoesChecklist em app/src/lib/notifications.ts),
-- ainda não implementado pra venda adicional.
--
-- Prêmio é só informativo — não entra no fechamento de comissão
-- (regra própria, mais delicada, não foi pedido misturar).
-- ============================================================
create table campanhas_venda_adicional (
  id bigserial primary key,
  nome text not null,
  data_inicio date not null,
  data_fim date not null,
  tipo_premiacao text not null check (tipo_premiacao in ('ranking', 'meta_individual')),
  meta_quantidade integer check (meta_quantidade > 0),
  premiacao_meta_valor numeric(12,2) check (premiacao_meta_valor > 0),
  premiacao_ranking jsonb,
  -- Só pro tipo 'ranking': piso mínimo pra entrar na disputa (ex.:
  -- "concorre a partir de 5" — vendedor que vendeu menos que isso nem
  -- aparece no ranking, mesmo tendo vendido alguma coisa). Editável na
  -- aba do gestor. Null = sem piso, todo mundo que vendeu 1+ concorre
  -- (03/08/2026).
  minimo_para_concorrer integer check (minimo_para_concorrer > 0),
  -- 'acumulado_periodo': soma tudo que o vendedor vendeu no período
  -- inteiro (padrão).
  -- 'mesma_venda': só conta o MAIOR cupom individual de cada vendedor
  -- — pra premiar "vendeu 2 [do mesmo produto] juntas na mesma venda"
  -- (campanha de produto único, tipo "compre 2").
  -- 'venda_com_outros_itens': só conta a venda se ela tiver OUTRO item
  -- além do(s) produto(s) da campanha (qtd_itens_na_venda > 1 na view)
  -- — pra campanha de vários produtos tipo "adicional bebê" (pomada,
  -- lenço, chupeta): conta como venda adicional só se não veio
  -- SOZINHO na nota, senão é venda normal, não upsell. Diferente de
  -- 'mesma_venda': aqui não importa quantidade do mesmo produto, e sim
  -- se tinha ALGO MAIS na venda (03/08/2026).
  criterio_quantidade text not null default 'acumulado_periodo'
    check (criterio_quantidade in ('acumulado_periodo', 'mesma_venda', 'venda_com_outros_itens')),
  horario_lembrete text,
  criado_por uuid references auth.users(id),
  criada_em timestamptz not null default now(),
  constraint venda_adicional_datas_coerentes check (data_fim >= data_inicio)
);

create table campanha_venda_adicional_produtos (
  id bigserial primary key,
  campanha_id bigint not null references campanhas_venda_adicional(id) on delete cascade,
  codigo_produto integer not null references produto_catalogo(codigo),
  unique (campanha_id, codigo_produto)
);

create index idx_cva_produtos_campanha on campanha_venda_adicional_produtos (campanha_id);

-- Vendas dos produtos de cada campanha, já filtradas pelo período
-- dela — alimenta a lista do card em Alertas (produto, cliente, data,
-- horário) e o cálculo de ranking/meta batida (feito no app, em cima
-- dessas linhas).
create view vw_venda_adicional_vendas as
select
  cvap.campanha_id,
  vi.id as venda_item_id,
  v.data_emissao,
  v.hora_emissao,
  vi.codigo_produto,
  pc.nome as nome_produto,
  vi.quantidade_produtos as quantidade,
  v.codigo_vendedor,
  vd.nome as nome_vendedor,
  v.codigo_cliente,
  c.nome as nome_cliente,
  v.id as venda_id,
  v.numero_nota,
  -- Total de LINHAS (produtos distintos) na nota inteira, não só dos
  -- produtos da campanha — precisa pro critério
  -- 'venda_com_outros_itens' saber se veio sozinho ou junto com algo
  -- mais. Subquery, não join direto: contar teria que somar depois de
  -- juntar com vi (linha da campanha), o que dobraria a contagem se a
  -- nota tivesse mais de 1 produto da campanha.
  (select count(*) from venda_itens vi2 where vi2.venda_id = vi.venda_id) as qtd_itens_na_venda,
  -- Nomes dos OUTROS produtos na mesma nota (excluindo esse mesmo
  -- item) — pra mostrar na lista "com o que ele veio junto", já que
  -- 'venda_com_outros_itens' não rastreia esses outros produtos como
  -- parte da campanha, só precisa saber que existem (03/08/2026).
  (
    select string_agg(distinct coalesce(pc2.nome, 'Produto ' || vi2.codigo_produto), ', ')
    from venda_itens vi2
    left join produto_catalogo pc2 on pc2.codigo = vi2.codigo_produto
    where vi2.venda_id = vi.venda_id and vi2.id <> vi.id
  ) as outros_produtos_na_venda,
  vi.valor_total_liquido as valor
from campanha_venda_adicional_produtos cvap
join campanhas_venda_adicional camp on camp.id = cvap.campanha_id
join venda_itens vi on vi.codigo_produto = cvap.codigo_produto
join vendas v on v.id = vi.venda_id and v.data_emissao between camp.data_inicio and camp.data_fim
left join produto_catalogo pc on pc.codigo = vi.codigo_produto
left join vendedores vd on vd.codigo = v.codigo_vendedor
left join clientes c on c.codigo = v.codigo_cliente;

-- ============================================================
-- VENDAS COMPLEMENTARES (13/08/2026) — vendedor marca manualmente quais
-- itens da própria venda do dia foram venda complementar (upsell, "e
-- mais uma coisa"). DIFERENTE de Venda Adicional acima (automática,
-- por produto pré-escolhido em campanha) — aqui é o vendedor quem
-- decide e marca, item por item, sem produto pré-definido. Só edita o
-- dia de hoje (regra da tela, não do banco).
-- ============================================================
create table venda_item_complementar (
  id bigserial primary key,
  venda_item_id bigint not null unique references venda_itens(id) on delete cascade,
  codigo_vendedor integer not null references vendedores(codigo),
  marcado_por uuid references auth.users(id),
  marcado_em timestamptz not null default now()
);

create index idx_venda_item_complementar_vendedor on venda_item_complementar (codigo_vendedor);

-- Config do ranking/premiação (gestor decide período) — valor_minimo é
-- em REAIS (soma vendida em complementares pra concorrer), diferente
-- do minimo_para_concorrer de venda_adicional (que é quantidade).
create table campanhas_complementares (
  id bigserial primary key,
  data_inicio date not null,
  data_fim date not null,
  valor_minimo numeric(12,2) check (valor_minimo > 0),
  quantidade_minima integer check (quantidade_minima > 0),
  -- Meta de referência (não gate de premiação, só informativa) de
  -- quantos clientes o vendedor deve oferecer o complementar por dia.
  meta_clientes_ofertados_dia integer check (meta_clientes_ofertados_dia > 0),
  premiacao_ranking jsonb not null,
  criado_por uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Contagem diária autodeclarada de quantos clientes o vendedor
-- ofereceu o complementar — não dá pra verificar, é informativo. Ao
-- contrário de venda_item_complementar, o VALOR muda entre saves do
-- mesmo dia, então precisa de policy de UPDATE de verdade (ver
-- rls_policies.sql).
create table venda_complementar_oferta_diaria (
  id bigserial primary key,
  codigo_vendedor integer not null references vendedores(codigo),
  data date not null,
  clientes_ofertados integer not null default 0 check (clientes_ofertados >= 0),
  atualizado_por uuid references auth.users(id),
  atualizado_em timestamptz not null default now(),
  unique (codigo_vendedor, data)
);

-- Vendas marcadas, já com valor e vendedor — matéria-prima do ranking.
-- Propositalmente SEM security_invoker (mesma família de
-- vw_ranking_vendedores_dia): todo vendedor precisa ver a linha de
-- TODOS pra saber sua posição, não só a própria.
create view vw_venda_complementar_marcada as
select
  vic.venda_item_id,
  vic.codigo_vendedor,
  vd.nome as nome_vendedor,
  v.data_emissao,
  vi.valor_total_liquido as valor,
  vi.codigo_produto,
  -- por último de propósito (create or replace view só deixa
  -- ACRESCENTAR coluna no fim) — venda_id agrupa itens da MESMA nota,
  -- pra distinguir "quantidade de itens marcados" de "quantidade de
  -- atendimentos" (uma nota pode ter 2+ itens marcados como
  -- complementar, um vendedor pode ter mais itens que atendimentos).
  v.id as venda_id
from venda_item_complementar vic
join venda_itens vi on vi.id = vic.venda_item_id
join vendas v on v.id = vi.venda_id
left join vendedores vd on vd.codigo = vic.codigo_vendedor;

alter view vw_venda_complementar_marcada set (security_invoker = false);

-- ============================================================
-- PRODUTOS EM FALTA (03/08/2026) — registro manual e rápido de "esse
-- produto está em falta hoje", feito por qualquer vendedor no balcão.
-- DIFERENTE de Compras/Dose Certa (sugestão automática por demanda e
-- estoque, calculada) — aqui é o vendedor reportando na hora que
-- percebeu que faltou, sem cálculo nenhum por trás. Lista
-- compartilhada (não é log de auditoria): todo mundo lê, edita e
-- apaga, inclusive registro de outra pessoa — o objetivo é o time
-- inteiro manter a lista do mês limpa e atualizada.
--
-- nome_produto é texto livre, de propósito (03/08/2026, achado com
-- caso real: produto novo no mercado que ainda não está no catálogo
-- não tinha como ser reportado) — codigo_produto é OPCIONAL, só
-- preenchido quando o nome bate com algo já cadastrado em
-- produto_catalogo (busca assistida na tela, não obrigatória).
-- ============================================================
create table produtos_em_falta (
  id bigserial primary key,
  nome_produto text not null,
  codigo_produto integer references produto_catalogo(codigo),
  data date not null,
  -- "O produto tem saldo no estoque?" (17/08/2026) — distingue ruptura
  -- de gôndola (sistema mostra saldo, mas não acha o produto) de falta
  -- real (saldo zerado).
  tem_saldo_estoque boolean not null default false,
  registrado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

create index idx_produtos_em_falta_data on produtos_em_falta (data desc);

-- Contador ao vivo de produtos em falta reportados, pro relatório
-- mensal (ver metricas_mensais acima) — produtos_em_falta é lista de
-- trabalho compartilhada (qualquer um apaga ao resolver), não log de
-- auditoria, então snapshot no fechamento do mês SUBESTIMARIA a
-- contagem real (item reportado E resolvido no mesmo mês nunca seria
-- contado). Trigger incrementa na hora do INSERT, sobrevivendo ao
-- DELETE. SECURITY DEFINER pra funcionar mesmo quando quem reporta é
-- vendedor comum (sem permissão de escrita direta em metricas_mensais).
create or replace function incrementar_metrica_produtos_em_falta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into metricas_mensais (mes_referencia, codigo_vendedor, chave, valor)
  values (date_trunc('month', new.data)::date, null, 'produtos_em_falta_reportados', 1)
  on conflict (mes_referencia, chave, coalesce(codigo_vendedor, -1))
  do update set valor = metricas_mensais.valor + 1, atualizado_em = now();
  return new;
end;
$$;

create trigger trg_incrementar_produtos_em_falta
after insert on produtos_em_falta
for each row
execute function incrementar_metrica_produtos_em_falta();

-- ============================================================
-- COMPRAS_CLASSIFICACOES (18/08/2026) — classificação em lote de itens
-- da sugestão de compras (aba Compras, gestor-only): "não vou comprar
-- esse produto específico porque já resolvi de outro jeito" (pediu de
-- outro laboratório, já comprou por fora, etc.), sem mexer no cálculo
-- de demanda/estoque. Uma linha ATIVA por produto (unique) — não
-- expira sozinho, some da sugestão até alguém remover a classificação.
-- ============================================================
create table compras_classificacoes (
  id bigserial primary key,
  codigo_produto integer not null unique references produto_catalogo(codigo),
  motivo text not null check (motivo in ('outro_laboratorio', 'ja_comprado', 'outros')),
  observacao text,
  classificado_em timestamptz not null default now(),
  classificado_por uuid references profiles(id)
);
-- vw_compras_classificacoes fica só em rls_policies.sql (mesmo padrão
-- de vw_produtos_em_falta) — a view depende de auth.uid() por dentro
-- pro gate de acesso, então mora junto do resto da RLS.

-- ============================================================
-- PENDÊNCIAS (06/08/2026) — vendedor registra que separou/reservou
-- produto(s) pra um cliente buscar depois (foto de comprovante,
-- produtos, cliente, data automática). Lista compartilhada como
-- produtos_em_falta — todo mundo lê e registra, mas aqui NÃO tem
-- apagar: "dar baixa" marca resolvida (baixada=true) em vez de
-- excluir, pra manter histórico de quem entregou o quê.
-- foto_url é só o path dentro do bucket "pendencias" (privado — ver
-- storage_setup.sql), igual venda_item_receitas.foto_url.
-- ============================================================
create table pendencias (
  id bigserial primary key,
  nome_cliente text not null,
  produtos text not null,
  foto_url text,
  data date not null default current_date,
  registrado_por uuid references auth.users(id),
  baixada boolean not null default false,
  baixada_em timestamptz,
  baixada_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

create index idx_pendencias_baixada on pendencias (baixada);

-- ============================================================
-- ATENDIMENTOS DIÁRIOS POR VENDEDOR (VendasVendedorIntegracaoDto)
-- ============================================================
create table vendas_vendedor_diario (
  data_emissao date not null,
  codigo_vendedor integer not null references vendedores(codigo),
  quantidade_itens integer,
  quantidade_atendimentos integer,
  primary key (data_emissao, codigo_vendedor)
);

-- ============================================================
-- CONTATOS_CLIENTES — registro de tentativa de contato (ligação ou
-- WhatsApp) feita a partir do app pelos botões de Ligar/WhatsApp nas
-- telas de Clientes/Alertas (03/08/2026). Usado só pra suprimir um
-- cliente das listas de resgate/aniversário/uso contínuo/alto valor
-- sumindo/promoção por um tempo depois de contatado, evitando insistir
-- toda vez que a lista recarrega — ver app/src/lib/contatos.ts pra
-- janela de supressão de cada motivo.
--
-- "Tentativa": sabemos que o discador/WhatsApp abriu, não que a
-- ligação foi atendida nem que a mensagem foi lida — não dá pra saber
-- isso de dentro do app.
--
-- codigo_produto só é preenchido pra 'uso_continuo'/'promocao'/
-- 'antibiotico' (qual produto motivou o contato) — sem foreign key de
-- propósito, mesmo motivo de venda_itens.codigo_produto (nem todo
-- produto vendido tem linha em produto_catalogo).
--
-- tipo_contato = 'nao_contatado' (03/08/2026): não é um contato de
-- verdade, é gravado sozinho pelo app (card "Antibiótico vendido" em
-- Alertas) quando passa 1 semana da venda de um antimicrobiano sem
-- ninguém ligar/mandar WhatsApp — fecha o item da lista e deixa
-- registrado que a farmácia NÃO conseguiu fazer o acompanhamento.
-- ============================================================
create table contatos_clientes (
  id bigserial primary key,
  codigo_cliente integer not null references clientes(codigo),
  motivo text not null check (motivo in ('resgate', 'aniversario', 'uso_continuo', 'alto_valor_sumindo', 'promocao', 'antibiotico', 'carteira')),
  tipo_contato text not null check (tipo_contato in ('whatsapp', 'ligacao', 'nao_contatado')),
  codigo_produto integer,
  codigo_vendedor integer references vendedores(codigo),
  contatado_em timestamptz not null default now()
);

create index idx_contatos_clientes_busca on contatos_clientes (codigo_cliente, motivo, contatado_em desc);

-- ============================================================
-- VIEWS ANALÍTICAS (o app consome estas, não as tabelas cruas)
-- ============================================================

-- Ticket médio e itens por atendimento, por vendedor/dia
create view vw_desempenho_vendedor_diario as
select
  vvd.data_emissao,
  vvd.codigo_vendedor,
  v.nome as nome_vendedor,
  vvd.quantidade_atendimentos,
  vvd.quantidade_itens,
  round(vvd.quantidade_itens::numeric / nullif(vvd.quantidade_atendimentos,0), 2) as itens_por_atendimento
from vendas_vendedor_diario vvd
join vendedores v on v.codigo = vvd.codigo_vendedor;

-- Ticket médio, desconto, comissão e margem calculados a partir dos
-- itens de venda. Margem bruta = valor de venda (faturamento líquido,
-- já com desconto) menos custo de aquisição — usa vlr_custo_produto
-- (confirmado com a farmácia; venda_itens tem outros dois campos de
-- custo — valor_total_custo e vlr_custo_aquisicao — que NÃO são esse).
-- nome_vendedor entra por último (não no meio) porque essa view usa
-- `create or replace` — Postgres só deixa ACRESCENTAR coluna no fim,
-- não realocar; ver supabase/migracao_frente2.sql pra aplicar isso no
-- projeto já existente sem precisar recriar a view do zero.
-- taxa_desconto_pct e total_custo/margem_bruta_pct calculados com
-- fallback: vlr_desconto/vlr_custo_produto vêm NULL da API pra venda
-- recente (confirmado comparando com relatório real da Trier em
-- 31/07/2026 — 132 de 132 vendas do dia sem esses campos, não é bug de
-- parsing nosso). Desconto: como bruto e líquido continuam vindo
-- certos, (bruto - líquido) já É o desconto total, sem depender do
-- campo problemático. Custo: sem um "bruto menos líquido" equivalente,
-- cai pra coalesce entre os 3 campos de custo que a tabela tem — se
-- nenhum vier preenchido, total_custo continua NULL (não inventa 0).
-- FATOR_CORRECAO_CUSTO: correção empírica temporária — pra venda
-- recente, vlr_custo_produto/vlr_custo_aquisicao vêm 100% nulos da API
-- (só valor_total_custo é preenchido), e esse campo sozinho soma ~8%
-- acima da coluna "Valor Custo" do relatório real "Vendas por
-- Vendedor" da Trier (achado 31/07/2026, ver coletor/README.md e
-- pendência "Custo/comissão/desconto/hora vindo NULL"). Causa raiz
-- confirmada em 01/08/2026: valor_total_custo bate com o critério
-- PADRÃO de custo da tela de relatório da Trier (Custo do Cadastro de
-- Produtos), não com "Custo de Aquisição" (o que a farmácia usa pra
-- margem) — e o campo certo (vlr_custo_aquisicao) é o que vem NULL.
-- A proporção varia por período (~6,5-8%) — 0.92 é aproximação, não
-- fixo. Remover/ajustar esse fator se a Trier confirmar um jeito de
-- pegar Custo de Aquisição direto pra venda recente.
-- [12/08/2026] where vd.tipo_cancelamento is null — vendas
-- estornadas/canceladas não contam como venda no Painel (decisão do
-- usuário; substitui a escolha anterior de propositalmente não
-- filtrar, documentada em migracao_metricas_periodo_customizado.sql).
-- Ver migracao_exclui_estorno_desempenho.sql.
-- [12/08/2026] total_custo/margem_bruta_pct agora vêm de
-- produto_catalogo.custo_medio × quantidade (join por codigo_produto)
-- em vez de venda_itens.valor_total_custo × 0.92 — confirmado direto
-- na tela da Trier que custo_medio (valorCustoMedio da API) bate exato
-- com o campo "Custo Aquisição" do cadastro do produto; o fator -8%
-- era aproximação em cima do campo errado. Ver
-- migracao_custo_aquisicao_desempenho.sql. Ressalva: custo_medio é o
-- custo de aquisição ATUAL, não o vigente na data da venda antiga.
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
  vend.nome as nome_vendedor
from venda_itens vi
join vendas vd on vd.id = vi.venda_id
join vendedores vend on vend.codigo = vi.codigo_vendedor
left join produto_catalogo pc on pc.codigo = vi.codigo_produto
where vd.tipo_cancelamento is null
group by vd.data_emissao, vi.codigo_vendedor, vend.nome;

-- Mesmas contas de vw_metricas_vendedor_diario, só que agrupado por
-- mês inteiro em vez de dia exato — usado pelo card "Desempenho do
-- mês" do Painel (faturamento/comissão acumulados, os demais já são
-- proporção/média por natureza).
create or replace view vw_metricas_vendedor_mensal as
select
  extract(year from vd.data_emissao)::int as ano,
  extract(month from vd.data_emissao)::int as mes,
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
  vend.nome as nome_vendedor
from venda_itens vi
join vendas vd on vd.id = vi.venda_id
join vendedores vend on vend.codigo = vi.codigo_vendedor
left join produto_catalogo pc on pc.codigo = vi.codigo_produto
where vd.tipo_cancelamento is null
group by extract(year from vd.data_emissao), extract(month from vd.data_emissao), vi.codigo_vendedor, vend.nome;

-- Mesma conta de vw_desempenho_vendedor_diario, agrupado por mês.
create view vw_desempenho_vendedor_mensal as
select
  extract(year from vvd.data_emissao)::int as ano,
  extract(month from vvd.data_emissao)::int as mes,
  vvd.codigo_vendedor,
  v.nome as nome_vendedor,
  sum(vvd.quantidade_atendimentos) as quantidade_atendimentos,
  sum(vvd.quantidade_itens) as quantidade_itens,
  round(sum(vvd.quantidade_itens)::numeric / nullif(sum(vvd.quantidade_atendimentos),0), 2) as itens_por_atendimento
from vendas_vendedor_diario vvd
join vendedores v on v.codigo = vvd.codigo_vendedor
group by extract(year from vvd.data_emissao), extract(month from vvd.data_emissao), vvd.codigo_vendedor, v.nome;

-- [11/08/2026] Suporte ao seletor "Período" do card Desempenho no
-- Painel (calendário com dia único ou intervalo arrastando). Nenhuma
-- view de dia/semana/mês aceita intervalo livre — por isso função, não
-- view. Mesma fórmula de custo/margem de vw_metricas_vendedor_mensal
-- (ver migracao_metricas_periodo_customizado.sql).
-- [12/08/2026] tipo_cancelamento is null — ver nota em
-- vw_metricas_vendedor_diario acima; migracao_exclui_estorno_desempenho.sql.
create or replace function fn_metricas_vendedor_periodo(data_inicio date, data_fim date)
returns table (
  codigo_vendedor integer,
  nome_vendedor text,
  qtd_notas bigint,
  faturamento_liquido numeric,
  faturamento_bruto numeric,
  total_desconto numeric,
  taxa_desconto_pct numeric,
  ticket_medio numeric,
  total_custo numeric,
  margem_bruta_pct numeric
)
language sql stable as $$
  select
    vi.codigo_vendedor,
    vend.nome as nome_vendedor,
    count(distinct vd.id) as qtd_notas,
    sum(vi.valor_total_liquido) as faturamento_liquido,
    sum(vi.valor_total_bruto) as faturamento_bruto,
    sum(vi.valor_total_bruto) - sum(vi.valor_total_liquido) as total_desconto,
    round((sum(vi.valor_total_bruto) - sum(vi.valor_total_liquido)) / nullif(sum(vi.valor_total_bruto), 0) * 100, 2) as taxa_desconto_pct,
    round(sum(vi.valor_total_liquido) / nullif(count(distinct vd.id), 0), 2) as ticket_medio,
    sum(vi.quantidade_produtos * coalesce(pc.custo_medio, 0)) as total_custo,
    round(
      (sum(vi.valor_total_liquido) - sum(vi.quantidade_produtos * coalesce(pc.custo_medio, 0)))
      / nullif(sum(vi.valor_total_liquido), 0) * 100,
    2) as margem_bruta_pct
  from venda_itens vi
  join vendas vd on vd.id = vi.venda_id
  join vendedores vend on vend.codigo = vi.codigo_vendedor
  left join produto_catalogo pc on pc.codigo = vi.codigo_produto
  where vd.data_emissao between data_inicio and data_fim
    and vd.tipo_cancelamento is null
  group by vi.codigo_vendedor, vend.nome;
$$;

-- Mesma conta de vw_desempenho_vendedor_diario, agregada por
-- intervalo de datas livre.
create or replace function fn_desempenho_vendedor_periodo(data_inicio date, data_fim date)
returns table (
  codigo_vendedor integer,
  nome_vendedor text,
  quantidade_atendimentos bigint,
  quantidade_itens bigint,
  itens_por_atendimento numeric
)
language sql stable as $$
  select
    vvd.codigo_vendedor,
    v.nome as nome_vendedor,
    sum(vvd.quantidade_atendimentos) as quantidade_atendimentos,
    sum(vvd.quantidade_itens) as quantidade_itens,
    round(sum(vvd.quantidade_itens)::numeric / nullif(sum(vvd.quantidade_atendimentos), 0), 2) as itens_por_atendimento
  from vendas_vendedor_diario vvd
  join vendedores v on v.codigo = vvd.codigo_vendedor
  where vvd.data_emissao between data_inicio and data_fim
  group by vvd.codigo_vendedor, v.nome;
$$;

-- Mesmas contas de vw_metricas_vendedor_diario/vw_desempenho_vendedor_diario,
-- agrupadas por bucket de semana FIXO (1-7, 8-14, 15-21, 22-fim do mês
-- — mesma definição de semanaDoDia() em app/src/lib/metas.ts, NÃO é
-- janela móvel de 7 dias). Usadas pelo toggle Dia/Semana/Mês do card
-- "Desempenho" do Painel.
create or replace view vw_metricas_vendedor_semanal as
select
  extract(year from vd.data_emissao)::int as ano,
  extract(month from vd.data_emissao)::int as mes,
  (case
    when extract(day from vd.data_emissao) <= 7 then 1
    when extract(day from vd.data_emissao) <= 14 then 2
    when extract(day from vd.data_emissao) <= 21 then 3
    else 4
  end) as semana,
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
  vend.nome as nome_vendedor
from venda_itens vi
join vendas vd on vd.id = vi.venda_id
join vendedores vend on vend.codigo = vi.codigo_vendedor
left join produto_catalogo pc on pc.codigo = vi.codigo_produto
where vd.tipo_cancelamento is null
group by
  extract(year from vd.data_emissao),
  extract(month from vd.data_emissao),
  (case
    when extract(day from vd.data_emissao) <= 7 then 1
    when extract(day from vd.data_emissao) <= 14 then 2
    when extract(day from vd.data_emissao) <= 21 then 3
    else 4
  end),
  vi.codigo_vendedor, vend.nome;

create view vw_desempenho_vendedor_semanal as
select
  extract(year from vvd.data_emissao)::int as ano,
  extract(month from vvd.data_emissao)::int as mes,
  (case
    when extract(day from vvd.data_emissao) <= 7 then 1
    when extract(day from vvd.data_emissao) <= 14 then 2
    when extract(day from vvd.data_emissao) <= 21 then 3
    else 4
  end) as semana,
  vvd.codigo_vendedor,
  v.nome as nome_vendedor,
  sum(vvd.quantidade_atendimentos) as quantidade_atendimentos,
  sum(vvd.quantidade_itens) as quantidade_itens,
  round(sum(vvd.quantidade_itens)::numeric / nullif(sum(vvd.quantidade_atendimentos),0), 2) as itens_por_atendimento
from vendas_vendedor_diario vvd
join vendedores v on v.codigo = vvd.codigo_vendedor
group by
  extract(year from vvd.data_emissao),
  extract(month from vvd.data_emissao),
  (case
    when extract(day from vvd.data_emissao) <= 7 then 1
    when extract(day from vvd.data_emissao) <= 14 then 2
    when extract(day from vvd.data_emissao) <= 21 then 3
    else 4
  end),
  vvd.codigo_vendedor, v.nome;

-- Ranking diário de vendedores (por faturamento líquido). Propositalmente
-- SEM security_invoker (ver rls_policies.sql) — mesma família de
-- vw_produtos_promocao_clientes: a tela "Ranking" do app é gamificação,
-- todo vendedor precisa ver a linha de todo mundo, não só a própria.
-- Rodando como dono, bypassa a RLS de vendas/venda_itens de propósito;
-- só expõe faturamento_liquido/posicao (não margem, desconto, custo).
create or replace view vw_ranking_vendedores_dia as
select
  data_emissao,
  codigo_vendedor,
  faturamento_liquido,
  rank() over (partition by data_emissao order by faturamento_liquido desc) as posicao,
  nome_vendedor
from vw_metricas_vendedor_diario;

-- Clientes distintos que cada vendedor já atendeu (pelo menos 1 venda
-- com esse codigo_vendedor), com total gasto COM ESSE vendedor
-- especificamente (não é a última compra do cliente com qualquer um,
-- é o histórico dele com o vendedor da tela "Meus clientes" do app).
-- Inclui email/data_nascimento pro card da tela mostrar direto, sem
-- precisar de outra consulta. Usada pra listar + buscar cliente
-- (01/08/2026).
-- [12/08/2026] coalesce(celular, fone) — celular, quando existe, é
-- número real de mobile (bem mais provável de ter WhatsApp); fone
-- sozinho às vezes é fixo antigo sem DDD. Ver coluna celular acima.
create view vw_clientes_por_vendedor as
select
  v.codigo_vendedor,
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
join clientes c on c.codigo = v.codigo_cliente
where v.codigo_vendedor is not null and v.codigo_cliente is not null
group by v.codigo_vendedor, c.codigo, c.nome, c.fone, c.celular, c.email, c.data_nascimento;

-- Mesma conta de vw_clientes_por_vendedor, mas somando QUALQUER
-- vendedor — usada só pelo card "Cliente de alto valor sumindo" em
-- Alertas (08/08/2026). Achado: reaproveitar vw_clientes_por_vendedor
-- ali fazia um cliente que comprou recentemente com OUTRO vendedor
-- entrar como "sumindo" na lista de quem não é o vendedor da última
-- compra — porque ultima_compra/valor_total daquela view já vêm
-- recortados pra 1 vendedor só. Aqui não recorta por vendedor de
-- propósito: é oportunidade de contato pra qualquer atendente, mesma
-- família de vw_produtos_promocao_clientes — por isso fica SEM
-- security_invoker (ver alter view mais abaixo/rls_policies.sql):
-- com security_invoker=true, a RLS de vendas/venda_itens ainda
-- recortaria pro vendedor logado por baixo dos panos mesmo sem filtro
-- explícito na view, e o corte "sumiu" voltaria a ficar errado.
create view vw_clientes_valor_geral as
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
join clientes c on c.codigo = v.codigo_cliente
where v.codigo_cliente is not null
group by c.codigo, c.nome, c.fone, c.celular, c.email, c.data_nascimento;

-- ============================================================
-- CARTEIRA DE CLIENTES (09/08/2026) — lista curada manualmente pelo
-- vendedor (aba "Carteira de clientes" do app), substitui o antigo
-- card de aniversário em Alertas. Diferente das outras listas de
-- cliente do app (todas derivadas de histórico de compra), aqui é o
-- vendedor quem decide manualmente quem entra/sai.
-- ============================================================
create table carteira_clientes (
  id bigserial primary key,
  codigo_vendedor integer not null references vendedores(codigo),
  codigo_cliente integer not null references clientes(codigo),
  adicionado_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  unique (codigo_vendedor, codigo_cliente)
);

create index idx_carteira_clientes_vendedor on carteira_clientes (codigo_vendedor);

-- valor_6_meses/comprado_este_mes somam QUALQUER vendedor (mesmo
-- raciocínio de vw_clientes_valor_geral — mede o engajamento real do
-- cliente, não só o que comprou com o vendedor dono da carteira); só o
-- VÍNCULO à carteira é que é por vendedor. Por isso o controle de
-- acesso é feito no WHERE (checando profiles/auth.uid()), não por
-- security_invoker — com security_invoker=true a RLS de vendas/
-- venda_itens recortaria as subqueries pro vendedor logado por baixo
-- dos panos, dando o mesmo problema já corrigido em
-- vw_clientes_valor_geral (ver comentário lá).
create view vw_carteira_clientes as
select
  cc.id,
  cc.codigo_vendedor,
  c.codigo as codigo_cliente,
  c.nome,
  coalesce(c.celular, c.fone) as telefone,
  cc.criado_em,
  coalesce(v6m.valor_total, 0) as valor_6_meses,
  coalesce(vm.qtd_compras_mes, 0) > 0 as comprado_este_mes,
  -- Valor comprado NO MÊS CORRENTE (não confundir com valor_6_meses,
  -- que é janela móvel de 6 meses) — card de Alertas usa isso pra
  -- estatística "Comprado este mês" (10/08/2026). Mesma regra de soma
  -- QUALQUER vendedor das outras colunas daqui.
  coalesce(vm.valor_mes, 0) as valor_mes_atual
from carteira_clientes cc
join clientes c on c.codigo = cc.codigo_cliente
left join lateral (
  select sum(vi.valor_total_liquido) as valor_total
  from vendas v
  join venda_itens vi on vi.venda_id = v.id
  where v.codigo_cliente = c.codigo
    and v.data_emissao >= (current_date - interval '6 months')
) v6m on true
left join lateral (
  select count(distinct v.id) as qtd_compras_mes, sum(vi.valor_total_liquido) as valor_mes
  from vendas v
  join venda_itens vi on vi.venda_id = v.id
  where v.codigo_cliente = c.codigo
    and date_trunc('month', v.data_emissao) = date_trunc('month', current_date)
) vm on true
where exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and (p.role = 'gestor' or p.codigo_vendedor = cc.codigo_vendedor)
);

-- [NOTA 12/08/2026] Este bloco documenta vw_clientes_inatividade, que
-- na prática só existia em migracao_clientes_inativos_3000_dias.sql
-- (schema.sql estava desatualizado nesse ponto — corrigido agora,
-- junto da mudança de coalesce(celular, fone)). Cliente pra "resgate"
-- (tela Clientes) — limite de 3000 dias sem comprar pra não trazer
-- cadastro morto de anos atrás sem fim.
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
  where v.codigo_cliente = c.codigo
  order by v.data_emissao desc, v.id desc
  limit 1
) ultima_venda on true
left join vendedores vd on vd.codigo = ultima_venda.codigo_vendedor
where exists (
  select 1 from profiles p where p.id = auth.uid()
)
and (current_date - ultima_venda.data_emissao) <= 3000;

alter view vw_clientes_inatividade set (security_invoker = false);

-- Histórico de compra por PRODUTO (não por nota) — 1 linha por item
-- vendido, com nome do produto (produto_catalogo, sincronizado da
-- Trier; sem FK formal com venda_itens.codigo_produto, daí o left
-- join) e data. Usado quando o vendedor expande um cliente na tela
-- "Meus clientes" (mostra os últimos 5, filtro de LIMIT fica no app).
-- Histórico INTEIRO do cliente (qualquer vendedor que atendeu), não só
-- com quem está vendo a tela, pra dar contexto completo.
-- codigo_vendedor/nome_vendedor incluídos pra tela "Cliente para
-- resgate" mostrar quem atendeu cada compra do histórico, ao lado da
-- data (03/08/2026) — left join em vendedores porque venda pode não
-- ter vendedor atribuído (mesma inconsistência proposital documentada
-- em seed_data.sql).
create view vw_historico_compras_cliente as
select
  v.codigo_cliente,
  vi.id as item_id,
  v.id as venda_id,
  v.data_emissao,
  vi.codigo_produto,
  coalesce(pc.nome, 'Produto ' || vi.codigo_produto) as nome_produto,
  vi.quantidade_produtos,
  vi.valor_total_liquido,
  v.codigo_vendedor,
  vd.nome as nome_vendedor
from vendas v
join venda_itens vi on vi.venda_id = v.id
left join produto_catalogo pc on pc.codigo = vi.codigo_produto
left join vendedores vd on vd.codigo = v.codigo_vendedor
where v.codigo_cliente is not null;

-- Base pros filtros de resgate da tela "Meus clientes" (01/08/2026):
-- 1 linha por (vendedor, cliente, produto) que o vendedor já vendeu
-- pra esse cliente, com sinal de recompra:
--   recorrente: comprou o mesmo produto 2+ vezes com esse vendedor.
--   intervalo_medio_dias: média de dias entre as compras (só faz
--     sentido quando recorrente).
--   atrasado: já passou o intervalo médio + 25 dias de folga fixa desde
--     a última compra — heurística de "já devia ter voltado a comprar"
--     (ex.: compra a cada 30 dias, se passar de 55 sem comprar de novo,
--     entra aqui). Sinal mais forte pra lista de resgate do que só
--     "comprou uma vez uma categoria". [10/08/2026] Era intervalo médio
--     × 1.3 (30% de tolerância) — trocado por folga fixa de 25 dias.
create view vw_clientes_produtos_vendedor as
with compras as (
  select
    v.codigo_vendedor,
    v.codigo_cliente,
    vi.codigo_produto,
    coalesce(pc.nome, 'Produto ' || vi.codigo_produto) as nome_produto,
    pc.categoria,
    pc.grupo,
    v.id as venda_id,
    v.data_emissao
  from vendas v
  join venda_itens vi on vi.venda_id = v.id
  left join produto_catalogo pc on pc.codigo = vi.codigo_produto
  where v.codigo_vendedor is not null and v.codigo_cliente is not null
    -- taxa de entrega/frete não é produto que o cliente "recompra" —
    -- some entrar como recorrente/atrasado do jeito errado (é cobrada
    -- em toda venda com entrega, não por hábito de consumo). grupo é
    -- inconsistente pra isso (LINHA GERAL, CONVENIENCIA, USO OU
    -- CONSUMO... também têm produto de verdade), então filtra por
    -- categoria SERVICOS + nome — coalesce evita excluir produto sem
    -- match em produto_catalogo (pc.nome/categoria viriam null).
    and coalesce(pc.categoria, '') <> 'SERVICOS'
    and coalesce(pc.nome, '') !~* 'entrega|delivery|frete'
),
agregado as (
  select
    codigo_vendedor,
    codigo_cliente,
    codigo_produto,
    nome_produto,
    categoria,
    grupo,
    -- distinct venda_id: uma nota com o mesmo produto em 2+ linhas
    -- (bonificação, lote diferente etc.) não pode contar como 2 compras.
    count(distinct venda_id) as qtd_compras,
    max(data_emissao) as ultima_compra,
    (max(data_emissao) - min(data_emissao))::numeric / nullif(count(distinct venda_id) - 1, 0) as intervalo_medio_dias
  from compras
  group by codigo_vendedor, codigo_cliente, codigo_produto, nome_produto, categoria, grupo
)
select
  codigo_vendedor,
  codigo_cliente,
  codigo_produto,
  nome_produto,
  categoria,
  grupo,
  qtd_compras,
  ultima_compra,
  round(intervalo_medio_dias, 1) as intervalo_medio_dias,
  (current_date - ultima_compra) as dias_desde_ultima_compra,
  (qtd_compras >= 2) as recorrente,
  (
    qtd_compras >= 2
    and intervalo_medio_dias is not null
    and (current_date - ultima_compra) > intervalo_medio_dias + 25
  ) as atrasado
from agregado;

-- Mesma base de vw_clientes_produtos_vendedor, mas agregada por
-- CLIENTE (não por vendedor) — usada pelos filtros da tela "Cliente
-- para resgate" (03/08/2026), que mostra todo cliente pra qualquer
-- vendedor agir, então "recorrente"/"atrasado" precisam somar a compra
-- do cliente com QUALQUER vendedor, não só a de quem está logado.
create view vw_clientes_produtos as
with compras as (
  select
    v.codigo_cliente,
    vi.codigo_produto,
    coalesce(pc.nome, 'Produto ' || vi.codigo_produto) as nome_produto,
    pc.categoria,
    pc.grupo,
    v.id as venda_id,
    v.data_emissao
  from vendas v
  join venda_itens vi on vi.venda_id = v.id
  left join produto_catalogo pc on pc.codigo = vi.codigo_produto
  where v.codigo_cliente is not null
    and coalesce(pc.categoria, '') <> 'SERVICOS'
    and coalesce(pc.nome, '') !~* 'entrega|delivery|frete'
),
agregado as (
  select
    codigo_cliente,
    codigo_produto,
    nome_produto,
    categoria,
    grupo,
    count(distinct venda_id) as qtd_compras,
    max(data_emissao) as ultima_compra,
    (max(data_emissao) - min(data_emissao))::numeric / nullif(count(distinct venda_id) - 1, 0) as intervalo_medio_dias
  from compras
  group by codigo_cliente, codigo_produto, nome_produto, categoria, grupo
)
select
  codigo_cliente,
  codigo_produto,
  nome_produto,
  categoria,
  grupo,
  qtd_compras,
  ultima_compra,
  round(intervalo_medio_dias, 1) as intervalo_medio_dias,
  (current_date - ultima_compra) as dias_desde_ultima_compra,
  (qtd_compras >= 2) as recorrente,
  (
    qtd_compras >= 2
    and intervalo_medio_dias is not null
    and (current_date - ultima_compra) > intervalo_medio_dias + 25
  ) as atrasado
from agregado;

-- Vendas por canal (presencial vs ecommerce vs ifood)
create view vw_vendas_por_canal as
select
  data_emissao,
  case
    when venda_ifood then 'ifood'
    when venda_ecommerce then 'ecommerce'
    else 'presencial'
  end as canal,
  count(*) as qtd_vendas,
  sum(vlr_troco) as vlr_troco_total
from vendas
group by data_emissao, canal;

-- Fornecedor e fator de compra (conversão de embalagem) mais recentes
-- de cada produto — usado pela Lista de compras pra sugerir "de quem
-- comprar" e arredondar a quantidade pra caixa fechada, sem precisar
-- de um cadastro manual de "fornecedor preferido por produto" (a API
-- não expõe isso; a compra mais recente é a melhor aproximação).
create view vw_produto_fornecedor_recente as
select distinct on (ci.codigo_produto)
  ci.codigo_produto,
  c.codigo_fornecedor,
  f.nome_fantasia as nome_fornecedor,
  ci.fator_compra,
  c.data_entrada
from compras_itens ci
join compras c on c.id = ci.compra_id
join fornecedores f on f.codigo = c.codigo_fornecedor
order by ci.codigo_produto, c.data_entrada desc;

-- Fornecedor com o MENOR valor_custo pago por produto nos últimos 12
-- meses — complementa vw_produto_fornecedor_recente (que é sempre o
-- fornecedor da compra mais recente, não o mais barato). valor_custo
-- (não valor_unitario/valor_unitario_liquido) porque é o custo efetivo
-- já com ST, o mesmo campo que embasa produto_catalogo.custo_medio —
-- mantém a comparação de preço consistente com o resto do app. É o
-- menor preço HISTÓRICO pago, não uma cotação atual (a API da Trier não
-- expõe cotação em tempo real — mesma limitação de
-- vw_produto_fornecedor_recente). Janela de 12 meses pra não sugerir um
-- preço velho demais pra ser confiável.
create view vw_produto_fornecedor_mais_barato as
select distinct on (ci.codigo_produto)
  ci.codigo_produto,
  c.codigo_fornecedor,
  f.nome_fantasia as nome_fornecedor,
  ci.valor_custo,
  c.data_entrada
from compras_itens ci
join compras c on c.id = ci.compra_id
join fornecedores f on f.codigo = c.codigo_fornecedor
where c.data_entrada >= now() - interval '12 months'
  and ci.valor_custo is not null
  and ci.valor_custo > 0
order by ci.codigo_produto, ci.valor_custo asc, c.data_entrada desc;

-- Venda recente por produto (30 dias) — dá o giro e "dias sem venda"
-- usados por Campanhas/Compras/Precificação (lib/campanhas.ts,
-- lib/doseCerta.ts, lib/precificacao.ts). Só telas gestor-only
-- consomem isso, e a RLS de venda_itens já garante que gestor vê
-- tudo — não precisa bypassar RLS aqui (diferente de Ranking/Alertas,
-- que precisam que QUALQUER vendedor veja dado cross-vendedor).
create view vw_venda_recente_produto as
select
  vi.codigo_produto,
  coalesce(sum(vi.quantidade_produtos) filter (where v.data_emissao >= current_date - interval '30 days'), 0) as quantidade_vendida_30d,
  (current_date - max(v.data_emissao))::int as dias_sem_venda
from venda_itens vi
join vendas v on v.id = vi.venda_id
group by vi.codigo_produto;

-- [10/08/2026] Mesma ideia de vw_venda_recente_produto, mas com janela
-- PARAMETRIZADA — usada só pela geração de sugestão de compras
-- (gerarSugestaoCompras), cujo campo "Base de vendas p/ cálculo (dias)"
-- antes só mudava o divisor da média diária mantendo o total sempre
-- de 30 dias (vw_venda_recente_produto), dando demanda/quantidade
-- sugerida erradas pra qualquer valor diferente de 30. Campanhas e
-- Precificação continuam na view fixa, sem mudança.
create or replace function fn_venda_periodo_produto(dias integer)
returns table (codigo_produto integer, quantidade_vendida numeric)
language sql
stable
as $$
  select
    vi.codigo_produto,
    sum(vi.quantidade_produtos) as quantidade_vendida
  from venda_itens vi
  join vendas v on v.id = vi.venda_id
  where v.data_emissao >= current_date - make_interval(days => dias)
  group by vi.codigo_produto;
$$;

-- vw_clientes_inatividade fica definida em rls_policies.sql, não aqui
-- — ela depende da tabela `profiles` (criada lá) pro próprio controle
-- de acesso embutido (vendedor só vê os clientes dele, gestor vê
-- todos). Rodar esse script sozinho, sem o rls_policies.sql em
-- seguida, deixa essa view faltando.

-- Status de receita dos produtos controlados vendidos (tela "Receitas"
-- do app). security_invoker=true (ver rls_policies.sql): respeita a
-- RLS de vendas/venda_itens, então vendedor só vê os próprios itens.
--
-- [02/08/2026] Antes dependia de curadoria manual (tabela `produtos`,
-- que nunca foi preenchida — "Receita pendente" sempre dava 0). Agora
-- deriva de produto_catalogo.tipo_lista, que a Trier já manda pronto
-- pra CADA produto do catálogo — ver comentário na criação da coluna.
--
-- Corte em 01/07/2026: controle de receita passa a valer a partir
-- desse mês, continuando pra frente — histórico anterior é perdoado
-- (a funcionalidade nunca funcionou de verdade antes, então cobrar
-- retroativo geraria milhares de "pendência" que não são de verdade
-- uma falha do vendedor).
create view vw_vendas_receita_status as
select
  vi.id as venda_item_id,
  v.data_emissao as data_venda,
  pc.codigo as codigo_produto,
  pc.nome as nome_produto,
  case when trim(pc.tipo_lista) = 'T' then 'antimicrobiano' else 'controle_especial' end as tipo_receita,
  v.codigo_cliente,
  c.nome as nome_cliente,
  v.codigo_vendedor,
  vd.nome as nome_vendedor,
  (r.id is not null) as receita_anexada,
  r.data_anexo,
  r.foto_url
from venda_itens vi
join vendas v on v.id = vi.venda_id
join produto_catalogo pc on pc.codigo = vi.codigo_produto and nullif(trim(pc.tipo_lista), '') is not null
left join clientes c on c.codigo = v.codigo_cliente
left join vendedores vd on vd.codigo = v.codigo_vendedor
left join venda_item_receitas r on r.venda_item_id = vi.id
where v.data_emissao >= '2026-07-01';

-- Vendas de antimicrobiano pra alimentar o card "Antibiótico vendido"
-- em Alertas (03/08/2026) — acompanhamento pós-venda (ligar/WhatsApp
-- perguntando como está o tratamento), NÃO é sobre retenção de
-- receita. DIFERENTE de vw_vendas_receita_status de propósito:
-- tipo_lista='T' sozinho tem gap de cadastro real (conferido com dado
-- de produção 03/08/2026 — produto duplicado no Trier, uma entrada
-- bem cadastrada e outra sem nada preenchido, e é a mal cadastrada que
-- aparece na venda). categoria/grupo cobrem parte do buraco, mas não
-- tudo: existem códigos duplicados sem categoria, grupo NEM tipo_lista
-- preenchidos (ex.: "AZITROMICINA 500MG 5CP REV" cód. 10004 — o
-- "irmão" cód. 7282 tem tudo certo, mas quem vende usa o 10004).
--
-- Por isso tem um 4º critério: nome do princípio ativo (ilike), lista
-- MANUAL de stopgap enquanto o cadastro duplicado não é corrigido no
-- Trier. Precisa ser mantida à mão — se aparecer produto novo mal
-- cadastrado que não bater com nenhum destes nomes, ele continua
-- invisível pro card até alguém adicionar aqui (ou corrigir na
-- origem, que é o fix de verdade).
create view vw_vendas_antimicrobiano_recente as
select
  vi.id as venda_item_id,
  v.data_emissao as data_venda,
  pc.codigo as codigo_produto,
  pc.nome as nome_produto,
  v.codigo_cliente,
  c.nome as nome_cliente
from venda_itens vi
join vendas v on v.id = vi.venda_id
join produto_catalogo pc on pc.codigo = vi.codigo_produto
left join clientes c on c.codigo = v.codigo_cliente
where v.data_emissao >= current_date - interval '30 days'
  and (
    pc.categoria = 'ANTIMICROBIANOS'
    or pc.grupo ilike '%ANTIMICROBIANOS%'
    or nullif(trim(pc.tipo_lista), '') = 'T'
    or pc.nome ilike '%amoxicilina%' or pc.nome ilike '%azitromicina%' or pc.nome ilike '%cefalexina%'
    or pc.nome ilike '%ciprofloxacino%' or pc.nome ilike '%doxiciclina%' or pc.nome ilike '%claritromicina%'
    or pc.nome ilike '%penicilina%' or pc.nome ilike '%sulfametoxazol%' or pc.nome ilike '%norfloxacino%'
    or pc.nome ilike '%metronidazol%' or pc.nome ilike '%levofloxacino%' or pc.nome ilike '%fluconazol%'
    or pc.nome ilike '%cefadroxila%' or pc.nome ilike '%eritromicina%' or pc.nome ilike '%ampicilina%'
    or pc.nome ilike '%cefaclor%'
  );

-- Compliance: por vendedor, quantas vendas não têm identificação real
-- do comprador — sem cliente na venda, OU cliente cadastrado é o
-- PRÓPRIO vendedor (mesmo CPF, comparado sem pontuação). Achado
-- analisando os dados reais 02/08/2026: alguns vendedores usam o
-- próprio CPF como atalho em vez de pedir o do cliente.
-- [06/08/2026] Ampliado de "só produto controlado" (a partir de
-- 01/07/2026, mesmo corte de vw_vendas_receita_status) pra TODO tipo
-- de venda — pedido explícito do usuário, o hábito de usar o próprio
-- CPF não é exclusivo de controlado. total_vendas_controladas/
-- vendas_sem_identificacao continuam com o MESMO significado de antes
-- (só controlado) pra não quebrar create-or-replace (coluna existente
-- não pode mudar de posição/sentido); total_vendas/
-- vendas_todas_sem_identificacao são as novas, com todo tipo de venda
-- — a tela usa esse par como padrão e o par antigo só quando o filtro
-- "só controlados" está ativo.
--
-- DIFERENTE do resto do app (que abre RLS pra todo mundo ver o
-- resultado de todos): aqui é dado de desempenho/compliance
-- individual, sensível — gestor vê todo mundo, vendedor só a própria
-- linha. Por isso o controle de acesso é no próprio WHERE (checando
-- profiles/auth.uid()), não confia na RLS aberta das tabelas base.
create view vw_receita_identificacao_comprador as
select
  v.codigo_vendedor,
  vd.nome as nome_vendedor,
  count(*) filter (where nullif(trim(pc.tipo_lista), '') is not null) as total_vendas_controladas,
  count(*) filter (
    where nullif(trim(pc.tipo_lista), '') is not null
      and (
        v.codigo_cliente is null
        or (
          vd.numero_cpf is not null
          and c.numero_cpf_cnpj is not null
          and regexp_replace(c.numero_cpf_cnpj, '\D', '', 'g') = regexp_replace(vd.numero_cpf, '\D', '', 'g')
        )
      )
  ) as vendas_sem_identificacao,
  count(*) as total_vendas,
  count(*) filter (
    where v.codigo_cliente is null
      or (
        vd.numero_cpf is not null
        and c.numero_cpf_cnpj is not null
        and regexp_replace(c.numero_cpf_cnpj, '\D', '', 'g') = regexp_replace(vd.numero_cpf, '\D', '', 'g')
      )
  ) as vendas_todas_sem_identificacao,
  -- [06/08/2026] Motivo "próprio CPF" isolado de "sem cliente" — dado
  -- real (05834 vendas desde 01/07, 38,3% não-controlado vs 27,0%
  -- controlado) confirmou com o usuário que TODA venda deveria ter
  -- cliente cadastrado (não só controlado), então "sem cliente" sozinho
  -- já é um sinal válido em qualquer produto. Ainda assim vale destacar
  -- "próprio CPF" à parte porque é o padrão mais claramente suspeito
  -- (vendedor usando o CPF dele mesmo), pra filtrar sem misturar com
  -- "só esqueceu de cadastrar o cliente".
  count(*) filter (
    where v.codigo_cliente is not null
      and vd.numero_cpf is not null
      and c.numero_cpf_cnpj is not null
      and regexp_replace(c.numero_cpf_cnpj, '\D', '', 'g') = regexp_replace(vd.numero_cpf, '\D', '', 'g')
  ) as vendas_proprio_cpf
from venda_itens vi
join vendas v on v.id = vi.venda_id
join produto_catalogo pc on pc.codigo = vi.codigo_produto
left join clientes c on c.codigo = v.codigo_cliente
left join vendedores vd on vd.codigo = v.codigo_vendedor
where v.data_emissao >= '2026-07-01'
  and v.codigo_vendedor is not null
  and exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and (p.role = 'gestor' or p.codigo_vendedor = v.codigo_vendedor)
  )
group by v.codigo_vendedor, vd.nome;

-- Detalhe item a item por trás da view acima (drill-down do card em
-- Alertas: clicar no vendedor mostra a lista de vendas específicas —
-- nota, data, produto, motivo). Mesmo controle de acesso no WHERE.
-- [06/08/2026] Ampliado pra todo tipo de venda (mesmo motivo da view
-- acima); `controlado` no fim (append-only, ver create-or-replace) diz
-- se aquela venda específica é de produto controlado, pra tela poder
-- filtrar a lista já carregada sem precisar buscar de novo.
create view vw_vendas_sem_identificacao_comprador as
select
  vi.id as venda_item_id,
  v.data_emissao as data_venda,
  v.numero_nota,
  pc.nome as nome_produto,
  v.codigo_vendedor,
  case when v.codigo_cliente is null then 'sem_cliente' else 'proprio_cpf' end as motivo,
  v.hora_emissao,
  (nullif(trim(pc.tipo_lista), '') is not null) as controlado
from venda_itens vi
join vendas v on v.id = vi.venda_id
join produto_catalogo pc on pc.codigo = vi.codigo_produto
left join clientes c on c.codigo = v.codigo_cliente
left join vendedores vd on vd.codigo = v.codigo_vendedor
where v.data_emissao >= '2026-07-01'
  and v.codigo_vendedor is not null
  and (
    v.codigo_cliente is null
    or (
      vd.numero_cpf is not null
      and c.numero_cpf_cnpj is not null
      and regexp_replace(c.numero_cpf_cnpj, '\D', '', 'g') = regexp_replace(vd.numero_cpf, '\D', '', 'g')
    )
  )
  and exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and (p.role = 'gestor' or p.codigo_vendedor = v.codigo_vendedor)
  )
order by v.data_emissao desc;

-- Alertas de promoção (tela "Alertas" do app): produtos em promoção e,
-- pra cada um, os clientes que já compraram antes. Propositalmente SEM
-- security_invoker — roda com o privilégio do dono (bypassa a RLS de
-- vendas/venda_itens/clientes/campanhas/campanha_produtos), porque aqui
-- a regra de negócio é "todo vendedor pode ver oportunidades de contato
-- de qualquer cliente", ao contrário das outras views que restringem
-- vendedor aos próprios dados.
-- Duas fontes de "produto em promoção", unidas na CTE: `produtos`
-- (curadoria manual separada, flag em_promocao) e campanhas ATIVAS
-- HOJE criadas na aba Campanhas do app (campanhas/campanha_produtos) —
-- antes só a primeira entrava aqui, então campanha criada pelo
-- gestor nunca aparecia no card de Alertas (achado 06/08/2026).
-- exige_receita/tipo_receita do lado de campanha vêm de
-- produto_catalogo.tipo_lista, mesmo critério de
-- vw_vendas_antimicrobiano_recente (tipo_lista='T' = antimicrobiano,
-- preenchido e diferente disso = controle_especial).
-- exige_receita/tipo_receita entram no fim (não junto de preco_atual)
-- pra manter create-or-replace válido — ver migracao_frente2.sql.
-- [26/08/2026, corrigido no mesmo dia] Tentativa inicial escopou o
-- join de DESCOBERTA de cliente (quem já comprou antes) pelo período
-- da ação — errado: produto cuja última venda foi ANTES da promoção
-- começar sumia da lista inteira (achado: card foi de "todos os
-- produtos em campanha" pra só 16, com produto de verdade faltando).
-- "já comprou antes" tem que continuar sendo o histórico INTEIRO (é
-- o propósito do card — reencontrar cliente antigo agora que o
-- produto tá mais barato), sem isso não sobra ninguém pra contatar
-- num produto que nunca vendeu desde que a promoção começou.
--
-- quantidade_vendida_periodo é uma métrica À PARTE, por PRODUTO (não
-- por cliente) — quantidade vendida só DENTRO do período da ação,
-- pra mostrar no card sem afetar quem aparece na lista de clientes.
-- Mesma lógica de período por fonte de antes: campanha usa
-- data_inicio de verdade; `produtos` (curadoria manual, sem coluna de
-- data) usa `updated_at` como aproximação.
create or replace view vw_produtos_promocao_clientes as
with produtos_em_promocao as (
  select
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
    cp.codigo_produto,
    pc.nome as nome_produto,
    cp.preco_promocional as preco_atual,
    -- mesmo cálculo que o app usa pra mostrar "preço regular" de uma
    -- campanha salva (ver carregarCampanhas em supabaseRepository.ts).
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
  join campanhas camp on camp.id = cp.campanha_id
  join produto_catalogo pc on pc.codigo = cp.codigo_produto
  where current_date between camp.data_inicio and camp.data_fim
),
vendido_no_periodo as (
  select pp.codigo_produto, sum(vi.quantidade_produtos) as quantidade_vendida_periodo
  from produtos_em_promocao pp
  join venda_itens vi on vi.codigo_produto = pp.codigo_produto
  join vendas v on v.id = vi.venda_id
    and v.data_emissao >= pp.periodo_inicio
    and v.tipo_cancelamento is null
  group by pp.codigo_produto
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
  -- por último de propósito: create or replace view só deixa
  -- ACRESCENTAR coluna no fim, não inserir no meio (ver
  -- migracao_frente2.sql pro mesmo motivo com exige_receita/tipo_receita).
  coalesce(vp.quantidade_vendida_periodo, 0) as quantidade_vendida_periodo
from produtos_em_promocao pp
join venda_itens vi on vi.codigo_produto = pp.codigo_produto
join vendas v on v.id = vi.venda_id and v.tipo_cancelamento is null
join clientes c on c.codigo = v.codigo_cliente
left join vendido_no_periodo vp on vp.codigo_produto = pp.codigo_produto
group by pp.codigo_produto, pp.nome_produto, pp.preco_atual, pp.preco_anterior, pp.percentual_desconto,
  c.codigo, c.nome, c.fone, c.celular, pp.exige_receita, pp.tipo_receita, vp.quantidade_vendida_periodo;

-- Progresso de metas (mensal e semanal) — tela "Metas" (gestor) e o
-- bloco de metas no Dashboard (todos). O "realizado" é calculado na
-- hora, a partir de vendas/venda_itens reais — diferente do mock do
-- app, aqui não precisa de dado ilustrativo. security_invoker=true:
-- respeita a RLS de `metas` (vendedor só as próprias) e, por tabela,
-- de vendas/venda_itens também.
--
-- [01/08/2026] "realizado" é MARGEM BRUTA em R$, não faturamento
-- líquido — a meta cadastrada pela farmácia é de margem, não de
-- venda (confirmado pelo usuário; antes comparava valor_meta contra
-- faturamento, o que não fazia sentido).
--
-- [26/08/2026] Custo trocado de `coalesce(vlr_custo_produto,
-- valor_total_custo, vlr_custo_aquisicao) * 0.92` pra
-- `quantidade_produtos * produto_catalogo.custo_medio` — essa view
-- tinha ficado pra trás da correção aplicada em
-- vw_metricas_vendedor_diario/mensal/semanal em 12/08 (custo_medio
-- bate exato com "Custo Aquisição" da Trier; o fator -8% era só
-- aproximação em cima do campo errado). Achado comparando o valor de
-- meta no app com o cálculo direto: batia com a fórmula ANTIGA, não a
-- corrigida — Metas/Ranking/Comissão ficaram meses calculando margem
-- (e, por consequência, comissão) com a fórmula desatualizada.
create view vw_metas_progresso as
select
  m.id as meta_id,
  m.codigo_vendedor,
  vd.nome as nome_vendedor,
  m.ano,
  m.mes,
  m.semana,
  m.valor_meta,
  coalesce(realizado.valor, 0) as valor_realizado
from metas m
join vendedores vd on vd.codigo = m.codigo_vendedor
left join lateral (
  select
    sum(vi.valor_total_liquido) - sum(vi.quantidade_produtos * coalesce(pc.custo_medio, 0)) as valor
  from vendas v
  join venda_itens vi on vi.venda_id = v.id
  left join produto_catalogo pc on pc.codigo = vi.codigo_produto
  where v.codigo_vendedor = m.codigo_vendedor
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

-- Comissão do mês (estimativa "ao vivo", enquanto o mês não fecha) —
-- SÓ meta mensal (semana is null). security_invoker=true: respeita a
-- RLS de `metas` (via vw_metas_progresso) e de vendas/venda_itens.
--
-- [01/08/2026] Regra confirmada com a farmácia — NÃO é mais "1 faixa
-- pro mês inteiro":
--   - Se a margem bruta do mês bate ≥100% da meta MENSAL, a comissão é
--     10% FLAT sobre a margem bruta do mês inteiro (regra_aplicada =
--     'flat_10_mensal').
--   - Senão, cada SEMANA (1-4) é avaliada por conta própria contra a
--     própria meta semanal, acha a faixa em faixas_comissao (100%→10%,
--     90%→8%, 80%→7%, 70%→5%, abaixo de 70%→3%) e aplica a taxa sobre
--     a margem bruta DAQUELA semana; a comissão do mês é a SOMA das 4
--     comissões semanais (regra_aplicada = 'soma_semanal').
-- percentual_comissao aqui é a taxa EFETIVA (comissao_valor dividido
-- pela margem do mês) — só faz sentido como número único no caso
-- flat_10_mensal; no soma_semanal é uma média ponderada pra dar uma
-- noção, não uma "faixa" real (a real está em detalhe_semanas).
-- detalhe_semanas fica NULL no caso flat_10_mensal (não teve soma).
create view vw_metas_comissao as
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
  calc.detalhe_semanas
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
        where percentual_meta_min <= coalesce(round(mps.valor_realizado / nullif(mps.valor_meta, 0) * 100, 2), 0)
        order by percentual_meta_min desc
        limit 1
      ) faixa_sem on true
      where mps.codigo_vendedor = mp.codigo_vendedor
        and mps.ano = mp.ano
        and mps.mes = mp.mes
        and mps.semana is not null
    ) s
  ) semanal
) calc on true
where mp.semana is null;

-- Faixa de comissão "se fechasse agora" (3/5/7/8/10%, direto de
-- faixas_comissao pelo % da meta MENSAL batido até aqui) — mais simples
-- que vw_metas_comissao.percentual_comissao de propósito: aquela é uma
-- MÉDIA ponderada das 4 semanas (só vira número limpo quando bate
-- 100% e cai no flat), essa aqui é sempre uma das 5 faixas exatas.
-- Usada só pra gamificação (medalha 🔰🥉🥈🥇🏆 no app + push de "subiu
-- de faixa" via n8n) — ver comissao_faixa_alcancada logo abaixo.
-- security_invoker=true: respeita a RLS de `metas` (via
-- vw_metas_progresso), mesmo padrão de vw_metas_comissao.
create view vw_faixa_comissao_atual as
select
  mp.codigo_vendedor,
  mp.nome_vendedor,
  mp.ano,
  mp.mes,
  mp.valor_meta,
  mp.valor_realizado,
  round(mp.valor_realizado / nullif(mp.valor_meta, 0) * 100, 2) as percentual_atingido,
  faixa.percentual_comissao as faixa_atual
from vw_metas_progresso mp
join lateral (
  select percentual_comissao
  from faixas_comissao
  where percentual_meta_min <= coalesce(round(mp.valor_realizado / nullif(mp.valor_meta, 0) * 100, 2), 0)
  order by percentual_meta_min desc
  limit 1
) faixa on true
where mp.semana is null;

-- Maior faixa de comissão já alcançada no mês, por vendedor —
-- registro em RATCHET (só sobe, nunca desce; nunca guarda a faixa
-- mínima de 3%, que é o piso — não é "alcançar" nada) escrito pelo
-- workflow n8n coletor/notificacao_comissao.n8n.json toda vez que
-- vw_faixa_comissao_atual mostra uma faixa maior que a última
-- registrada aqui. Serve pra DUAS coisas: (1) medalha 🔰🥉🥈🥇🏆
-- mostrada no app (Meta/Metas) — não regride mesmo se o vendedor tiver
-- uma semana fraca depois de já ter alcançado uma faixa alta; (2)
-- evita mandar o mesmo push de novo (o workflow só notifica quando
-- este registro muda).
create table comissao_faixa_alcancada (
  codigo_vendedor integer not null references vendedores(codigo),
  ano integer not null,
  mes integer not null check (mes between 1 and 12),
  faixa_percentual numeric(5,2) not null,
  alcancada_em timestamptz not null default now(),
  primary key (codigo_vendedor, ano, mes)
);

-- Comissão FECHADA (snapshot congelado, usado pra folha de pagamento)
-- — preenchida só pela função fechar_comissoes_mes() abaixo, chamada
-- pelo workflow n8n coletor/fechamento_comissao.n8n.json todo dia às
-- 22:30 (só age de verdade se for o último dia do mês — farmácia já
-- fechou e o último sync do dia já rodou). Depois de fechado, o valor
-- não muda mais mesmo que role algum ajuste de sync depois — é o
-- número oficial pra pagar o vendedor.
create table comissoes_fechadas (
  id bigserial primary key,
  codigo_vendedor integer not null references vendedores(codigo),
  ano integer not null,
  mes integer not null check (mes between 1 and 12),
  valor_comissao numeric(12,2) not null,
  margem_bruta_mes numeric(12,2) not null,
  meta_mensal numeric(12,2) not null,
  percentual_atingido_mensal numeric(6,2),
  regra_aplicada text not null check (regra_aplicada in ('flat_10_mensal', 'soma_semanal')),
  detalhe_semanas jsonb,
  fechado_em timestamptz not null default now(),
  unique (codigo_vendedor, ano, mes)
);

alter table comissoes_fechadas enable row level security;

-- Mais restrito que o resto do app de propósito — é dado de
-- remuneração, não "resultado de venda" (diferente de vendas/metas,
-- que foram liberadas pra todo mundo ver o resultado de todos em
-- 01/08/2026). Vendedor só vê a própria comissão fechada; gestor vê
-- de todos. Sem policy de insert/update/delete pra authenticated —
-- só a função de fechamento escreve aqui, via conexão direta do n8n
-- (mesmo padrão do coletor, que já ignora RLS assim).
create policy "comissoes_fechadas: select proprio ou gestor"
on comissoes_fechadas for select
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and (p.role = 'gestor' or p.codigo_vendedor = comissoes_fechadas.codigo_vendedor)
));

-- Congela a comissão de todo mundo pro (ano, mes) dado, lendo direto
-- de vw_metas_comissao (mesma lógica da estimativa "ao vivo" — evita
-- duplicar a regra em dois lugares). Idempotente (ON CONFLICT).
create or replace function fechar_comissoes_mes(p_ano integer, p_mes integer)
returns integer as $$
declare
  v_total integer;
begin
  insert into comissoes_fechadas (
    codigo_vendedor, ano, mes, valor_comissao, margem_bruta_mes,
    meta_mensal, percentual_atingido_mensal, regra_aplicada, detalhe_semanas
  )
  select
    codigo_vendedor, ano, mes, comissao_valor, margem_bruta_valor,
    valor_meta, percentual_atingido, regra_aplicada, detalhe_semanas
  from vw_metas_comissao
  where ano = p_ano and mes = p_mes
  on conflict (codigo_vendedor, ano, mes) do update set
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

-- Guarda chamada pelo n8n TODO DIA às 22:30 — só executa o fechamento
-- de verdade se hoje for o último dia do mês corrente (cron comum não
-- sabe expressar "último dia do mês" direto, meses têm 28 a 31 dias;
-- rodar isso toda noite e deixar o SQL decidir é a forma confiável).
create or replace function fechar_comissoes_se_ultimo_dia_do_mes()
returns void as $$
declare
  v_hoje date := current_date;
  v_ultimo_dia date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
begin
  if v_hoje = v_ultimo_dia then
    perform fechar_comissoes_mes(extract(year from v_hoje)::int, extract(month from v_hoje)::int);
  end if;
end;
$$ language plpgsql;
