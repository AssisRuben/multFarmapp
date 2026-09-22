-- ============================================================
-- PROFILES — vincula um usuário do Supabase Auth a um vendedor
-- e define seu papel (vendedor vs gestor).
-- Preenchido manualmente (ou por processo administrativo) ao
-- criar cada usuário no Supabase Auth — não é self-signup.
-- Tabela em si criada em schema.sql (entre vendedores e
-- compras_classificacoes, que já referenciam profiles) — aqui só
-- RLS e policies.
-- ============================================================
alter table profiles enable row level security;

create policy "profiles: usuario le o proprio perfil"
on profiles for select
using (id = auth.uid());

-- Sem policies de insert/delete para authenticated: a gestão de
-- profiles (vincular vendedor, definir papel) é feita via service_role
-- (que ignora RLS), não pelo app.
--
-- UPDATE é diferente: liberado, mas só pra coluna expo_push_token — o
-- GRANT abaixo restringe quais colunas a policy de update alcança
-- (mesmo com using/with check permissivos por linha, tentar escrever
-- role/codigo_vendedor nessa mesma chamada falha por falta de
-- privilégio na coluna, não só por RLS).
grant update (expo_push_token) on profiles to authenticated;

create policy "profiles: usuario atualiza o proprio push token"
on profiles for update
using (id = auth.uid())
with check (id = auth.uid());

-- ============================================================
-- Clientes ativos vs inativos (sem compra nos últimos 60 dias), com o
-- vendedor da ÚLTIMA compra — é o que define "cliente do vendedor" na
-- aba Clientes do app (vendedor só vê os seus, gestor vê todos).
-- Definida aqui (não em schema.sql) porque depende de `profiles`.
--
-- Usado pra gerar ação de RESGATE de cliente (mensagem de reativação,
-- ver ClientesScreen.tsx) — por isso cliente que nunca comprou nada
-- não entra aqui (não tem o que "resgatar"): `join lateral` normal em
-- vez de `left join lateral` derruba da view quem não tem nenhuma
-- linha em `vendas`, ao contrário de aparecer com `ultima_compra null`
-- e `inativo false` (que escondia esses clientes dentro do bucket
-- "ativo" sem ser um deles de verdade — achado em 31/07/2026 revisando
-- o tile "Clientes inativos" do Painel).
--
-- Propositalmente SEM security_invoker (mesmo motivo de
-- vw_produtos_promocao_clientes lá embaixo): se rodasse como invoker,
-- a RLS de `vendas` (agora liberada pra todo autenticado — ver
-- migracao_acesso_vendedor.sql) não teria mais esse problema, mas
-- rodar como dono continua correto/mais simples de raciocinar. O
-- controle de acesso aqui é manual (checa profiles/auth.uid()), não
-- via RLS automática.
--
-- [01/08/2026] Vendedor vê todo cliente agora, não só os próprios —
-- "resultado dos outros" (mesma decisão de vendas/metas, ver
-- migracao_acesso_vendedor.sql). codigo_vendedor/nome_vendedor da
-- última compra continuam na view (útil pra saber quem atendeu),
-- só não filtra mais quem pode VER a linha.
-- ============================================================
create or replace view vw_clientes_inatividade as
select
  c.codigo,
  c.nome,
  c.fone as telefone,
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
-- Cadastro morto (última compra há 3000+ dias, ~8 anos) não entra na
-- lista de resgate nem no tile "Clientes inativos" — não tem resgate
-- razoável depois disso, só polui a lista (03/08/2026). Filtro, não
-- DELETE: nenhum dado é perdido, cliente/venda continuam intactos no
-- banco, só somem dessa consulta específica.
and (current_date - ultima_venda.data_emissao) <= 3000;

-- ============================================================
-- RLS nas tabelas de negócio
-- Regra geral: gestor vê tudo; vendedor vê só os próprios dados.
-- Nenhuma policy de insert/update/delete para authenticated —
-- essas tabelas só são escritas pelo coletor via service_role.
-- ============================================================

alter table vendedores enable row level security;

-- Vendedor vê o cadastro de todo mundo (não só o próprio) — decisão de
-- produto: o Painel deve mostrar "venda geral e resultado dos outros"
-- pra qualquer vendedor, igual ao gestor (01/08/2026). Views com
-- security_invoker=true que fazem join com vendedores (métricas
-- diário/semanal/mensal) dependem disso pra trazer nome_vendedor de
-- todo mundo, não só do usuário logado.
create policy "vendedores: usuarios autenticados leem"
on vendedores for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

-- clientes: qualquer usuário autenticado com profile pode ler
-- (vendedor precisa consultar cliente na hora da venda/atendimento).
alter table clientes enable row level security;

create policy "clientes: usuarios autenticados leem"
on clientes for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

alter table vendas enable row level security;

-- Mesma decisão de vendedores acima: vendedor lê vendas de todo mundo,
-- não só as próprias.
create policy "vendas: usuarios autenticados leem"
on vendas for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

alter table venda_itens enable row level security;

create policy "venda_itens: usuarios autenticados leem"
on venda_itens for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

alter table vendas_vendedor_diario enable row level security;

create policy "vvd: usuarios autenticados leem"
on vendas_vendedor_diario for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

-- produtos: curadoria manual (promoção / exige receita). Qualquer
-- autenticado lê; só gestor escreve (curadoria é responsabilidade
-- da farmácia, não do vendedor nem do coletor).
alter table produtos enable row level security;

create policy "produtos: usuarios autenticados leem"
on produtos for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "produtos: gestor insere"
on produtos for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "produtos: gestor atualiza"
on produtos for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "produtos: gestor deleta"
on produtos for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

-- venda_item_receitas: escrita pelo próprio app (diferente das outras
-- tabelas de negócio, que só o coletor/service_role escreve).
alter table venda_item_receitas enable row level security;

-- [02/08/2026] Leitura E escrita liberadas pra qualquer autenticado —
-- mesma decisão já tomada pra vendas/clientes (todo mundo vê/mexe no
-- resultado de todos). Antes insert/update exigiam ser o vendedor
-- dono da venda (ou gestor), mas isso não faz sentido real: um
-- cliente pode voltar e ser atendido por outro vendedor/farmacêutico
-- de plantão, que precisa poder anexar a receita mesmo não tendo
-- feito a venda original.
create policy "receitas: usuarios autenticados leem"
on venda_item_receitas for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "receitas: usuarios autenticados inserem"
on venda_item_receitas for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "receitas: usuarios autenticados atualizam"
on venda_item_receitas for update
using (exists (
  select 1 from profiles p where p.id = auth.uid()
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid()
));

-- metas: cadastrada pelo gestor na tela "Metas". Vendedor só lê as
-- próprias (pra ver o progresso no Dashboard); só gestor escreve.
-- [01/08/2026] Leitura liberada pra todo mundo ver o ranking completo
-- de metas de todo mundo, não só a própria — mesma decisão de
-- vendas/venda_itens acima. Escrita continua gestor-only.
alter table metas enable row level security;

create policy "metas: usuarios autenticados leem"
on metas for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "metas: gestor insere"
on metas for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "metas: gestor atualiza"
on metas for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "metas: gestor deleta"
on metas for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

-- produto_catalogo: mesmo padrão de vendedores/clientes/vendas — synced
-- pelo coletor (quando existir) via service_role. Nenhuma policy de
-- insert/update/delete para authenticated; leitura liberada pra
-- qualquer autenticado (é dado de catálogo, não sensível).
alter table produto_catalogo enable row level security;

create policy "produto_catalogo: usuarios autenticados leem"
on produto_catalogo for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

-- fornecedores/compras/compras_itens: mesmo padrão de produto_catalogo
-- — synced pelo coletor via service_role, leitura liberada (não é dado
-- mais sensível que custo_medio, que já é público pra autenticado).
alter table fornecedores enable row level security;
alter table compras enable row level security;
alter table compras_itens enable row level security;

create policy "fornecedores: usuarios autenticados leem"
on fornecedores for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "compras: usuarios autenticados leem"
on compras for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "compras_itens: usuarios autenticados leem"
on compras_itens for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

-- campanhas/campanha_produtos: só gestor mexe — é decisão de negócio
-- (margem/estoque/venda), vendedor não precisa ver rascunho de
-- campanha nem tem ação nenhuma aqui.
alter table campanhas enable row level security;
alter table campanha_produtos enable row level security;

create policy "campanhas: gestor tudo"
on campanhas for all
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "campanha_produtos: gestor tudo"
on campanha_produtos for all
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

-- campanhas_venda_adicional/produtos: DIFERENTE de campanhas acima —
-- aqui todo vendedor precisa LER (card em Alertas, pra todo mundo),
-- só o gestor escreve (aba "Venda adicional").
alter table campanhas_venda_adicional enable row level security;
alter table campanha_venda_adicional_produtos enable row level security;

create policy "campanhas_venda_adicional: autenticados leem"
on campanhas_venda_adicional for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "campanhas_venda_adicional: gestor insere"
on campanhas_venda_adicional for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "campanhas_venda_adicional: gestor atualiza"
on campanhas_venda_adicional for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "campanhas_venda_adicional: gestor apaga"
on campanhas_venda_adicional for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "campanha_venda_adicional_produtos: autenticados leem"
on campanha_venda_adicional_produtos for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "campanha_venda_adicional_produtos: gestor insere"
on campanha_venda_adicional_produtos for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "campanha_venda_adicional_produtos: gestor apaga"
on campanha_venda_adicional_produtos for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

-- venda_item_complementar: marcação manual do vendedor (ver
-- schema.sql). Select: qualquer autenticado lê (mesmo critério de
-- campanhas_complementares — já é exposto pra todo mundo via
-- vw_venda_complementar_marcada mesmo). Insert/delete: vendedor só no
-- próprio; gestor em qualquer um (pedido explícito do usuário).
alter table venda_item_complementar enable row level security;

create policy "venda_item_complementar: autenticados leem"
on venda_item_complementar for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "venda_item_complementar: vendedor marca o proprio ou gestor marca qualquer"
on venda_item_complementar for insert
with check (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and (
      p.role = 'gestor'
      or (p.role = 'vendedor' and p.codigo_vendedor = venda_item_complementar.codigo_vendedor)
    )
));

create policy "venda_item_complementar: vendedor desmarca o proprio ou gestor desmarca qualquer"
on venda_item_complementar for delete
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and (
      p.role = 'gestor'
      or (p.role = 'vendedor' and p.codigo_vendedor = venda_item_complementar.codigo_vendedor)
    )
));

-- campanhas_complementares: mesmo critério de campanhas_venda_adicional
-- — todo mundo lê (vendedor precisa ver o próprio ranking/prêmio), só
-- gestor escreve.
alter table campanhas_complementares enable row level security;

create policy "campanhas_complementares: autenticados leem"
on campanhas_complementares for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "campanhas_complementares: gestor insere"
on campanhas_complementares for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "campanhas_complementares: gestor atualiza"
on campanhas_complementares for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "campanhas_complementares: gestor apaga"
on campanhas_complementares for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

-- venda_complementar_oferta_diaria: contagem diária autodeclarada.
-- Select aberto (mesmo critério de campanhas_complementares).
-- Insert/update: vendedor só o próprio, gestor qualquer um — e essa
-- tabela PRECISA de policy de update de verdade (valor muda entre
-- saves, diferente de venda_item_complementar).
create policy "venda_complementar_oferta_diaria: autenticados leem"
on venda_complementar_oferta_diaria for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "venda_complementar_oferta_diaria: vendedor grava o proprio ou gestor grava qualquer"
on venda_complementar_oferta_diaria for insert
with check (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and (
      p.role = 'gestor'
      or (p.role = 'vendedor' and p.codigo_vendedor = venda_complementar_oferta_diaria.codigo_vendedor)
    )
));

create policy "venda_complementar_oferta_diaria: vendedor atualiza o proprio ou gestor atualiza qualquer"
on venda_complementar_oferta_diaria for update
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and (
      p.role = 'gestor'
      or (p.role = 'vendedor' and p.codigo_vendedor = venda_complementar_oferta_diaria.codigo_vendedor)
    )
))
with check (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and (
      p.role = 'gestor'
      or (p.role = 'vendedor' and p.codigo_vendedor = venda_complementar_oferta_diaria.codigo_vendedor)
    )
));

-- produtos_em_falta: lista compartilhada, não é log de auditoria — CRUD
-- aberto pra qualquer autenticado, inclusive editar/apagar registro de
-- outra pessoa (o objetivo é o time manter a lista do mês limpa).
alter table produtos_em_falta enable row level security;

create policy "produtos_em_falta: autenticados leem"
on produtos_em_falta for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "produtos_em_falta: autenticados inserem"
on produtos_em_falta for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "produtos_em_falta: autenticados atualizam"
on produtos_em_falta for update
using (exists (
  select 1 from profiles p where p.id = auth.uid()
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "produtos_em_falta: autenticados apagam"
on produtos_em_falta for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

-- vw_produtos_em_falta (03/08/2026) — resolve quem registrou cada
-- falta, mas só devolve o nome pra quem está logado como GESTOR;
-- vendedor recebe null nessa coluna, mesmo lendo a mesma view (pedido
-- explícito: "apenas na aba do gestor"). Precisa ser SEM
-- security_invoker de propósito — profiles só deixa cada um ler o
-- PRÓPRIO perfil (RLS restritiva), então rodando como invoker o
-- vendedor não conseguiria nem resolver o nome de quem quer que seja;
-- a view roda com privilégio de dono e decide sozinha o que devolver,
-- checando auth.uid() por dentro (mesmo padrão de
-- vw_receita_identificacao_comprador acima).
create view vw_produtos_em_falta as
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
left join vendedores vd on vd.codigo = perfil_registro.codigo_vendedor;

-- compras_classificacoes (18/08/2026): só gestor, mesmo acesso da aba
-- Compras inteira (RootNavigator.tsx só mostra "Compras" no menu do
-- gestor).
alter table compras_classificacoes enable row level security;

create policy "compras_classificacoes: gestor le"
on compras_classificacoes for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "compras_classificacoes: gestor insere"
on compras_classificacoes for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "compras_classificacoes: gestor atualiza"
on compras_classificacoes for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "compras_classificacoes: gestor deleta"
on compras_classificacoes for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

-- vw_compras_classificacoes (18/08/2026) — resolve nome do produto e
-- de quem classificou. SEM security_invoker de propósito (mesmo motivo
-- de vw_produtos_em_falta acima): RLS de `profiles` só deixa cada um
-- ler o PRÓPRIO perfil, então em modo invoker o join pra resolver nome
-- de QUALQUER OUTRO gestor voltaria nulo. Roda com privilégio de dono;
-- o gate de acesso (só gestor) fica embutido na própria query.
create view vw_compras_classificacoes as
select
  cc.id,
  cc.codigo_produto,
  pc.nome as nome_produto,
  cc.motivo,
  cc.observacao,
  cc.classificado_em,
  coalesce(vd2.nome, 'Gestor(a) da Farmácia') as nome_classificado_por
from compras_classificacoes cc
join produto_catalogo pc on pc.codigo = cc.codigo_produto
left join profiles perfil_classificacao on perfil_classificacao.id = cc.classificado_por
left join vendedores vd2 on vd2.codigo = perfil_classificacao.codigo_vendedor
where exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor');

-- pendencias: lista compartilhada, "dar baixa" é UPDATE (marca
-- baixada=true), não DELETE — sem policy de delete de propósito, pra
-- não perder o histórico de quem entregou o quê.
alter table pendencias enable row level security;

create policy "pendencias: autenticados leem"
on pendencias for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "pendencias: autenticados inserem"
on pendencias for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "pendencias: autenticados atualizam"
on pendencias for update
using (exists (
  select 1 from profiles p where p.id = auth.uid()
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid()
));

-- vw_pendencias: resolve quem registrou pra QUALQUER UM (sem máscara de
-- gestor, diferente de vw_produtos_em_falta — pedido é "todo mundo tem
-- acesso", sem nuance de visibilidade). Mesmo motivo de SEM
-- security_invoker: profiles só deixa cada um ler o próprio perfil.
create view vw_pendencias as
select
  p.id,
  p.nome_cliente,
  p.produtos,
  p.foto_url,
  p.data,
  p.baixada,
  p.baixada_em,
  coalesce(vd.nome, 'Gestor(a) da Farmácia') as nome_registrado_por
from pendencias p
left join profiles perfil_registro on perfil_registro.id = p.registrado_por
left join vendedores vd on vd.codigo = perfil_registro.codigo_vendedor;

-- atividades_checklist: cadastrada pelo gestor (aba "Check list" do
-- app). Vendedor só lê as ATIVAS (é o que aparece no checklist diário
-- dele, filtrado no app por atividade_checklist_vendedores/dias_semana);
-- gestor lê todas (incl. inativas, pra gerenciar). Só gestor escreve.
alter table atividades_checklist enable row level security;

create policy "atividades_checklist: gestor le tudo"
on atividades_checklist for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "atividades_checklist: vendedor le as ativas"
on atividades_checklist for select
using (
  ativo = true
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'vendedor')
);

create policy "atividades_checklist: gestor insere"
on atividades_checklist for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "atividades_checklist: gestor atualiza"
on atividades_checklist for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "atividades_checklist: gestor deleta"
on atividades_checklist for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

-- atividade_checklist_vendedores: quem a atividade vale (join table —
-- ver comentário em schema.sql). Leitura liberada pra autenticado (não
-- é dado sensível, mesma sensibilidade de atividades_checklist); só
-- gestor escreve. Sem policy de update: edição sempre é
-- apaga-tudo-e-reinsere (mesmo padrão de campanha_produtos), não precisa.
alter table atividade_checklist_vendedores enable row level security;

create policy "atividade_checklist_vendedores: autenticados leem"
on atividade_checklist_vendedores for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "atividade_checklist_vendedores: gestor insere"
on atividade_checklist_vendedores for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "atividade_checklist_vendedores: gestor deleta"
on atividade_checklist_vendedores for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

-- checklist_respostas: marcação diária escrita pelo PRÓPRIO vendedor
-- (não pelo coletor, igual venda_item_receitas). Vendedor só mexe nas
-- próprias respostas; gestor lê tudo (acompanhamento) mas não edita em
-- nome do vendedor.
alter table checklist_respostas enable row level security;

create policy "checklist_respostas: select proprio ou gestor"
on checklist_respostas for select
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and (p.role = 'gestor' or p.codigo_vendedor = checklist_respostas.codigo_vendedor)
));

create policy "checklist_respostas: vendedor insere o proprio"
on checklist_respostas for insert
with check (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.role = 'vendedor'
    and p.codigo_vendedor = checklist_respostas.codigo_vendedor
));

create policy "checklist_respostas: vendedor atualiza o proprio"
on checklist_respostas for update
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.role = 'vendedor'
    and p.codigo_vendedor = checklist_respostas.codigo_vendedor
))
with check (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and p.role = 'vendedor'
    and p.codigo_vendedor = checklist_respostas.codigo_vendedor
));

-- faixas_comissao: régua de comissão. Qualquer autenticado lê (vendedor
-- precisa ver em qual faixa está); só gestor edita as faixas.
alter table faixas_comissao enable row level security;

create policy "faixas_comissao: usuarios autenticados leem"
on faixas_comissao for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "faixas_comissao: gestor insere"
on faixas_comissao for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "faixas_comissao: gestor atualiza"
on faixas_comissao for update
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
))
with check (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

create policy "faixas_comissao: gestor deleta"
on faixas_comissao for delete
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));

-- comissao_faixa_alcancada: escrita exclusiva do workflow n8n via
-- service_role (nenhuma policy de insert/update/delete para
-- authenticated) — vendedor só lê a própria, gestor lê todas. Mesmo
-- padrão de sync_control/vendedores (dado sincronizado por fora, não
-- editável pelo app).
alter table comissao_faixa_alcancada enable row level security;

create policy "comissao_faixa_alcancada: select proprio ou gestor"
on comissao_faixa_alcancada for select
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and (p.role = 'gestor' or p.codigo_vendedor = comissao_faixa_alcancada.codigo_vendedor)
));

-- carteira_clientes: vendedor gerencia (lê/adiciona/remove) só a
-- própria carteira; gestor gerencia a de qualquer vendedor (seletor de
-- vendedor na aba "Carteira de clientes"). A leitura enriquecida
-- (valor_6_meses/comprado_este_mes) é feita via vw_carteira_clientes,
-- que já tem seu próprio controle de acesso embutido no WHERE — essas
-- policies aqui cobrem a tabela crua (usada por insert/delete direto).
alter table carteira_clientes enable row level security;

create policy "carteira_clientes: select proprio ou gestor"
on carteira_clientes for select
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and (p.role = 'gestor' or p.codigo_vendedor = carteira_clientes.codigo_vendedor)
));

create policy "carteira_clientes: insere proprio ou gestor"
on carteira_clientes for insert
with check (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and (p.role = 'gestor' or p.codigo_vendedor = carteira_clientes.codigo_vendedor)
));

create policy "carteira_clientes: deleta proprio ou gestor"
on carteira_clientes for delete
using (exists (
  select 1 from profiles p
  where p.id = auth.uid()
    and (p.role = 'gestor' or p.codigo_vendedor = carteira_clientes.codigo_vendedor)
));

-- vw_cliente_dono_carteira (21/08/2026) — resolve só "quem é o dono
-- desse cliente na carteira", sem o resto de vw_carteira_clientes
-- (valor comprado, telefone). A RLS de carteira_clientes restringe
-- cada vendedor a ver só a PRÓPRIA carteira, então sem essa view
-- ninguém percebe quando um cliente já está na carteira de outro
-- vendedor (achado 21/08/2026: 2 clientes cadastrados em 2 carteiras
-- cada). Expõe só o mínimo pra qualquer autenticado — SEM
-- security_invoker de propósito, mesmo padrão de vw_carteira_clientes
-- acima, pra furar a RLS por-vendedor e decidir sozinha (via
-- auth.uid()) que qualquer autenticado pode ler esse recorte.
create view vw_cliente_dono_carteira as
select
  cc.codigo_cliente,
  cc.codigo_vendedor,
  vd.nome as nome_vendedor
from carteira_clientes cc
join vendedores vd on vd.codigo = cc.codigo_vendedor
where exists (
  select 1 from profiles p where p.id = auth.uid()
);

-- sync_control: escrita continua exclusiva do coletor via service_role
-- (nenhuma policy de insert/update/delete para authenticated). Leitura
-- liberada pra qualquer autenticado — usada pelo app pra mostrar "dados
-- sincronizados pela última vez em..." no Dashboard. Não é dado sensível
-- (só nome da entidade + timestamp), então não precisa de filtro por
-- vendedor/gestor.
alter table sync_control enable row level security;

create policy "sync_control: usuarios autenticados leem"
on sync_control for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

-- contatos_clientes: escrito pelo próprio app quando o vendedor clica
-- Ligar/WhatsApp (não pelo coletor). Igual a venda_item_receitas —
-- qualquer autenticado lê e insere (qualquer vendedor pode contatar
-- qualquer cliente, mesma decisão de escopo do resto do app). Sem
-- policy de update/delete: é um log de tentativa de contato, não deve
-- ser editado depois de criado.
alter table contatos_clientes enable row level security;

create policy "contatos_clientes: usuarios autenticados leem"
on contatos_clientes for select
using (exists (
  select 1 from profiles p where p.id = auth.uid()
));

create policy "contatos_clientes: usuarios autenticados inserem"
on contatos_clientes for insert
with check (exists (
  select 1 from profiles p where p.id = auth.uid()
));

-- ============================================================
-- VIEWS: por padrão, views no Postgres rodam com o privilégio do
-- dono (postgres), o que IGNORARIA a RLS das tabelas base. Forçar
-- security_invoker faz a view respeitar a RLS de quem está
-- consultando (o usuário logado no app), igual às tabelas.
-- ============================================================
alter view vw_desempenho_vendedor_diario set (security_invoker = true);
alter view vw_metricas_vendedor_diario set (security_invoker = true);
alter view vw_vendas_por_canal set (security_invoker = true);
alter view vw_vendas_receita_status set (security_invoker = true);
alter view vw_vendas_antimicrobiano_recente set (security_invoker = true);
alter view vw_venda_adicional_vendas set (security_invoker = true);
alter view vw_campanhas_desempenho set (security_invoker = true);
alter view vw_receita_identificacao_comprador set (security_invoker = true);
alter view vw_vendas_sem_identificacao_comprador set (security_invoker = true);
alter view vw_metas_progresso set (security_invoker = true);
alter view vw_metas_comissao set (security_invoker = true);
alter view vw_faixa_comissao_atual set (security_invoker = true);
alter view vw_produto_fornecedor_recente set (security_invoker = true);
alter view vw_produto_fornecedor_mais_barato set (security_invoker = true);
alter view vw_venda_recente_produto set (security_invoker = true);
alter view vw_metricas_vendedor_mensal set (security_invoker = true);
alter view vw_desempenho_vendedor_mensal set (security_invoker = true);
alter view vw_metricas_vendedor_semanal set (security_invoker = true);
alter view vw_desempenho_vendedor_semanal set (security_invoker = true);
alter view vw_clientes_por_vendedor set (security_invoker = true);
alter view vw_historico_compras_cliente set (security_invoker = true);
alter view vw_clientes_produtos_vendedor set (security_invoker = true);
alter view vw_clientes_produtos set (security_invoker = true);
alter view vw_vendedores_ativos set (security_invoker = true);
-- vw_produtos_promocao_clientes, vw_clientes_inatividade,
-- vw_ranking_vendedores_dia, vw_clientes_valor_geral e
-- vw_carteira_clientes ficam de propósito SEM security_invoker (ver
-- comentário de cada uma em schema.sql) — não é esquecimento. Gap
-- corrigido nesta rodada: vw_ranking_vendedores_dia tinha
-- security_invoker=true aqui antes, o que fazia um vendedor real só ver
-- a própria linha do ranking (sempre em 1º, sozinho), diferente da tela
-- "Ranking" do app, que mostra todo mundo de propósito (gamificação).
-- vw_produtos_promocao_clientes/vw_clientes_inatividade/
-- vw_carteira_clientes fazem o próprio controle de acesso no WHERE
-- (checando profiles/auth.uid()) em vez de confiar na RLS automática
-- das tabelas base; ranking e clientes_valor_geral não precisam nem
-- disso, rodam liberadas.

-- metricas_mensais (23/08/2026) — relatório mensal, só gestor lê (ver
-- comentário completo em schema.sql). Escrita só via service_role
-- (workflow n8n de fechamento de mês) + trigger SECURITY DEFINER de
-- produtos_em_falta — sem policy de insert/update/delete pra
-- authenticated de propósito.
alter table metricas_mensais enable row level security;

create policy "metricas_mensais: gestor le"
on metricas_mensais for select
using (exists (
  select 1 from profiles p where p.id = auth.uid() and p.role = 'gestor'
));
