import {
  AtividadeChecklist,
  Campanha,
  CampanhaComplementar,
  CampanhaVendaAdicional,
  ChecklistItemStatus,
  ClienteBusca,
  ClienteCarteira,
  ClienteDoVendedor,
  ClienteInatividade,
  ComissaoMensal,
  ContatoCliente,
  DesempenhoVendedorDiario,
  DesempenhoVendedorMensal,
  DesempenhoVendedorPeriodo,
  DesempenhoVendedorSemanal,
  DonoCarteira,
  FaixaComissao,
  HistoricoCompraCliente,
  ItemClassificacaoCompra,
  ItemEstoqueZeradoGiroAlto,
  ItemPrecificacao,
  ItemRelatorioFalta,
  ItemVendaComplementar,
  MetaVendedor,
  MetricaMensal,
  MetricasVendedorDiario,
  MetricasVendedorMensal,
  MetricasVendedorPeriodo,
  MetricasVendedorSemanal,
  MotivoClassificacaoCompra,
  OfertaComplementarDia,
  ParametrosCompra,
  Pendencia,
  Profile,
  ProdutoCatalogo,
  ProdutoElegibilidade,
  ProdutoEmFalta,
  ProdutoPromocaoAlerta,
  ProdutoRecorrenteCliente,
  RankingVendedorDia,
  RegistrarContatoInput,
  ResumoClientesInatividade,
  SalvarCampanhaComplementarInput,
  SalvarCampanhaInput,
  SalvarCampanhaVendaAdicionalInput,
  SalvarMetaInput,
  SalvarPendenciaInput,
  SalvarProdutoEmFaltaInput,
  StatusSincronizacao,
  IdentificacaoCompradorVendedor,
  SugestaoCampanhaParams,
  SugestaoCompra,
  SugestaoKitsParams,
  SugestaoParAfinidade,
  TipoReceita,
  VendaAntimicrobianoRecente,
  VendaComplementarMarcada,
  VendaReceitaPendente,
  VendaSemIdentificacaoComprador,
  VendaVendaAdicional,
  VendedorAtivo,
} from '../types/domain';

/**
 * Contrato de acesso a dados do app. A implementação mock replica o
 * comportamento das views + RLS definidas em supabase/schema.sql e
 * supabase/rls_policies.sql (ex.: vendedor só enxerga as próprias vendas,
 * gestor enxerga tudo, clientes é visível para qualquer autenticado).
 *
 * Quando a Frente 2 (integração real) estiver pronta, basta criar
 * SupabaseRepository implementando esta mesma interface e trocar o
 * export em src/data/index.ts — nenhuma tela precisa mudar.
 */
export interface DataRepository {
  login(email: string, senha: string): Promise<Profile>;
  logout(): Promise<void>;
  getSession(): Promise<Profile | null>;

  // Push de verdade (n8n, ex.: subiu de faixa de comissão) — token do
  // Expo Notifications registrado no login (ver lib/notifications.ts
  // obterPushToken). Sem-op silencioso se profile não tiver
  // codigoVendedor (gestor não recebe esse tipo de push por ora).
  salvarPushToken(profile: Profile, token: string): Promise<void>;

  getDesempenhoVendedorDiario(profile: Profile, dataEmissao: string): Promise<DesempenhoVendedorDiario[]>;
  getMetricasVendedorDiario(profile: Profile, dataEmissao: string): Promise<MetricasVendedorDiario[]>;
  // Mesmas métricas, agregadas pro mês inteiro — usadas pelo card
  // "Desempenho do mês" do Painel.
  getDesempenhoVendedorMensal(profile: Profile, ano: number, mes: number): Promise<DesempenhoVendedorMensal[]>;
  getMetricasVendedorMensal(profile: Profile, ano: number, mes: number): Promise<MetricasVendedorMensal[]>;
  // Mesmas métricas, agregadas por bucket de semana fixo (1-7, 8-14,
  // 15-21, 22-fim do mês) — usadas pelo toggle Dia/Semana/Mês do card
  // "Desempenho" do Painel.
  getDesempenhoVendedorSemanal(profile: Profile, ano: number, mes: number, semana: 1 | 2 | 3 | 4): Promise<DesempenhoVendedorSemanal[]>;
  getMetricasVendedorSemanal(profile: Profile, ano: number, mes: number, semana: 1 | 2 | 3 | 4): Promise<MetricasVendedorSemanal[]>;
  // Mesmas métricas, agregadas por um intervalo de datas livre (11/08/2026)
  // — usadas pelo seletor "Período" (calendário) do card "Desempenho".
  getDesempenhoVendedorPeriodo(profile: Profile, dataInicio: string, dataFim: string): Promise<DesempenhoVendedorPeriodo[]>;
  getMetricasVendedorPeriodo(profile: Profile, dataInicio: string, dataFim: string): Promise<MetricasVendedorPeriodo[]>;
  getRankingVendedoresDia(profile: Profile, dataEmissao: string): Promise<RankingVendedorDia[]>;
  getClientesInatividade(profile: Profile): Promise<ClienteInatividade[]>;
  // Tela "Meus clientes" — clientes distintos que o vendedor logado já
  // atendeu, com busca por nome feita no app (lista pequena por
  // vendedor, não precisa de busca no banco). Gestor (sem
  // codigoVendedor) recebe lista vazia — tela é por vendedor mesmo.
  getClientesDoVendedor(profile: Profile): Promise<ClienteDoVendedor[]>;
  // Mesma base de getClientesDoVendedor, mas valorTotal/ultimaCompra
  // somam QUALQUER vendedor — usada só pelo card "Cliente de alto
  // valor sumindo" em Alertas (oportunidade de contato, não filtrado
  // por vendedor; reaproveitar getClientesDoVendedor ali fazia cliente
  // que comprou recente com OUTRO vendedor entrar como "sumindo").
  getClientesValorGeral(profile: Profile): Promise<ClienteDoVendedor[]>;

  // Carteira de clientes: lista curada manualmente (aba "Carteira de
  // clientes" + card em Alertas). Sem codigoVendedor: vendedor logado
  // vê a própria; gestor vê a soma de TODOS (usado no card de
  // Alertas). Com codigoVendedor: filtra pra esse vendedor específico
  // (usado pelo gestor na aba, com o seletor de vendedor).
  getCarteiraClientes(profile: Profile, codigoVendedor?: number): Promise<ClienteCarteira[]>;
  // Quem é o "dono" de cada cliente já na carteira de ALGUÉM (qualquer
  // vendedor, não só o logado) — diferente de getCarteiraClientes, que
  // é restrito por RLS ao próprio vendedor (ou ao selecionado, se
  // gestor). Usado só pra avisar "já está na carteira de fulano" na
  // busca/lista, sem expor valor de compra nem telefone de quem não é
  // o dono.
  getDonosCarteira(profile: Profile): Promise<DonoCarteira[]>;
  // Busca em `clientes` (aberta a qualquer autenticado) por nome ou
  // CPF, pra escolher quem adicionar na carteira — limitada (não
  // carrega o cadastro inteiro).
  buscarClientesParaCarteira(termo: string): Promise<ClienteBusca[]>;
  adicionarClienteCarteira(profile: Profile, codigoVendedor: number, codigoCliente: number): Promise<void>;
  removerClienteCarteira(id: string): Promise<void>;

  // Histórico de compra do cliente (qualquer vendedor), mostrado ao
  // expandir um cliente na tela "Meus clientes" (limite padrão 5) e na
  // tela "Cliente para resgate" (limite 7, com nome do vendedor por
  // linha).
  getHistoricoComprasCliente(profile: Profile, codigoCliente: number, limite?: number): Promise<HistoricoCompraCliente[]>;
  // Base dos filtros de resgate ("Uso contínuo" + categoria/produto)
  // da tela "Meus clientes" — 1 linha por (cliente, produto), só das
  // vendas do vendedor logado.
  getProdutosRecorrentesDoVendedor(profile: Profile): Promise<ProdutoRecorrenteCliente[]>;
  // Mesma base, mas agregada por cliente somando QUALQUER vendedor —
  // usada pelos mesmos filtros na tela "Cliente para resgate", que
  // mostra todo cliente pra qualquer vendedor agir (não só o próprio).
  getProdutosRecorrentesClientes(profile: Profile): Promise<ProdutoRecorrenteCliente[]>;
  // Contagem agregada (total/inativos) pro tile do Painel — não sofre
  // do limite padrão de 1000 linhas por request que getClientesInatividade
  // tem quando usado só pra contar.
  getResumoClientesInatividade(profile: Profile): Promise<ResumoClientesInatividade>;

  // Alertas de promoção: intencionalmente NÃO filtrado por vendedor — é
  // uma lista de oportunidades de contato, útil pra qualquer atendente.
  // No backend real isso precisará de uma view/RPC própria (security
  // definer) já que a RLS de `vendas`/`clientes` é por vendedor.
  getProdutosEmPromocao(profile: Profile): Promise<ProdutoPromocaoAlerta[]>;

  // Fila de receitas: aqui sim segue a mesma regra de vendedor-vê-só-o-seu.
  getVendasComReceita(profile: Profile): Promise<VendaReceitaPendente[]>;
  anexarReceita(itemId: string, info: { tipo: TipoReceita; fotoUri: string | null }): Promise<void>;

  // Card "Antibiótico vendido" em Alertas: assim como getProdutosEmPromocao,
  // intencionalmente NÃO filtrado por vendedor — é oportunidade de
  // contato (acompanhamento pós-venda), não fila pessoal.
  getVendasAntimicrobianoRecente(profile: Profile): Promise<VendaAntimicrobianoRecente[]>;

  // Compliance: % de venda de controlado sem identificação real do
  // comprador, por vendedor — card "Venda controlada sem comprador" em Alertas.
  // Gestor vê todos, vendedor só a própria linha (dado sensível, ao
  // contrário do resto do app — ver comentário na view).
  getIdentificacaoCompradorPorVendedor(profile: Profile): Promise<IdentificacaoCompradorVendedor[]>;
  // Drill-down: as vendas específicas por trás do número de um vendedor.
  getVendasSemIdentificacaoComprador(
    profile: Profile,
    codigoVendedor: number
  ): Promise<VendaSemIdentificacaoComprador[]>;

  // Contatos (ligação/WhatsApp) — usado pra suprimir das listas de
  // resgate/aniversário/uso contínuo/alto valor sumindo/promoção quem
  // já foi contatado há pouco tempo pelo mesmo motivo (ver
  // lib/contatos.ts pra janela de supressão de cada motivo).
  // getContatosRecentes traz os últimos ~300 dias (cobre a maior
  // janela, de aniversário); cada tela filtra pela janela do seu
  // motivo específico.
  getContatosRecentes(profile: Profile): Promise<ContatoCliente[]>;
  registrarContato(profile: Profile, input: RegistrarContatoInput): Promise<void>;

  // Metas: vendedor só as próprias, gestor todas. `salvarMeta` é usado
  // pela tela de administração (gestor-only na UI).
  getMetas(profile: Profile, ano: number, mes: number): Promise<MetaVendedor[]>;
  salvarMeta(profile: Profile, input: SalvarMetaInput): Promise<void>;

  // Lista de vendedores ativos pra lançamento em massa de meta mensal
  // (tela Metas do gestor) — ao contrário de getMetas, traz todo mundo
  // mesmo quem ainda não tem meta lançada no período selecionado.
  getVendedoresAtivos(profile: Profile): Promise<VendedorAtivo[]>;

  // Comissão: só fechamento MENSAL (semana/dia não geram comissão própria
  // — ver vw_metas_comissao). Vendedor só a própria linha, gestor todas.
  // Faixas hoje são só leitura no app (tabela `faixas_comissao` já é
  // editável no banco, mas ainda sem tela de edição — ajuste é via SQL).
  getComissoesMensal(profile: Profile, ano: number, mes: number): Promise<ComissaoMensal[]>;
  getFaixasComissao(): Promise<FaixaComissao[]>;

  // Checklist diário: `getAtividadesChecklist` traz só as ativas para
  // vendedor, e todas (incl. inativas) para gestor gerenciar.
  getAtividadesChecklist(profile: Profile): Promise<AtividadeChecklist[]>;
  salvarAtividadeChecklist(profile: Profile, input: {
    id?: string;
    titulo: string;
    horario: string | null;
    codigosVendedor: number[];
    diasSemana: number[];
  }): Promise<void>;
  alternarAtividadeChecklist(id: string, ativo: boolean): Promise<void>;
  excluirAtividadeChecklist(id: string): Promise<void>;
  getChecklistHoje(profile: Profile): Promise<ChecklistItemStatus[]>;
  marcarChecklistItem(profile: Profile, atividadeId: string, concluida: boolean): Promise<void>;

  // Não vem da API SGF — é o coletor que escreve isso a cada rodada de
  // sync (ver supabase/schema.sql, tabela sync_control). Sem filtro por
  // papel: não é dado sensível, qualquer autenticado pode ler.
  getStatusSincronizacao(): Promise<StatusSincronizacao[]>;

  // Campanhas/Cartazetes — gestor-only na UI. `produto_catalogo` no
  // real seria sincronizado do ProdutoIntegracaoDto (Trier); não tem
  // API de escrita pra desconto/campanha, então "campanha" é uma
  // entidade nossa (não existe no Trier).
  // Mapa codigo_cliente -> tem_whatsapp, só das linhas já checadas
  // (código ausente do mapa = "ainda não checado", chamador decide o
  // fallback). Ver migracao_whatsapp_status.sql e
  // coletor/evolution_verificar_whatsapp.n8n.json.
  getStatusWhatsApp(profile: Profile): Promise<Record<number, boolean>>;
  getCatalogoProdutos(profile: Profile): Promise<ProdutoCatalogo[]>;
  sugerirProdutosCampanha(profile: Profile, params: SugestaoCampanhaParams): Promise<ProdutoElegibilidade[]>;
  // Kit multi-produto por afinidade de compra (02/09/2026) — pares de
  // produtos DIFERENTES que co-ocorrem muito na mesma venda, dentro da
  // categoria escolhida. Precisa do catálogo já carregado pra resolver
  // os códigos-semente (ver lib/afinidadeKits.ts:resolverCodigosSeed).
  sugerirParesAfinidade(profile: Profile, params: SugestaoKitsParams): Promise<SugestaoParAfinidade[]>;
  getCampanhas(profile: Profile): Promise<Campanha[]>;
  // Fetch dedicado de UMA campanha (edição) — resolve nome/código de
  // barras de verdade, diferente de getCampanhas (lista, mais leve).
  getCampanha(profile: Profile, id: string): Promise<Campanha | null>;
  salvarCampanha(profile: Profile, input: SalvarCampanhaInput): Promise<Campanha>;
  excluirCampanha(id: string): Promise<void>;

  // Venda adicional — gestor cria/edita (aba "Venda adicional"), todo
  // vendedor lê (card em Alertas). Prêmio é só informativo, não entra
  // no fechamento de comissão.
  getCampanhasVendaAdicional(profile: Profile): Promise<CampanhaVendaAdicional[]>;
  salvarCampanhaVendaAdicional(profile: Profile, input: SalvarCampanhaVendaAdicionalInput): Promise<void>;
  excluirCampanhaVendaAdicional(id: string): Promise<void>;
  getVendasVendaAdicional(profile: Profile, campanhaId: string): Promise<VendaVendaAdicional[]>;

  // Vendas complementares — vendedor marca item por item na própria
  // venda de HOJE (codigoVendedor sempre o do próprio, exceto quando
  // chamado pelo gestor revisando outro vendedor). data é sempre
  // passada pra tela também servir de consulta somente-leitura de dias
  // passados (marcação real só é aceita pra hoje, mas isso é regra da
  // tela/RLS, o método em si não recusa).
  getItensVendaComplementarDia(profile: Profile, data: string, codigoVendedor: number): Promise<ItemVendaComplementar[]>;
  salvarVendasComplementaresDia(
    profile: Profile,
    data: string,
    codigoVendedor: number,
    itemIdsMarcados: string[]
  ): Promise<void>;
  getCampanhasComplementares(profile: Profile): Promise<CampanhaComplementar[]>;
  salvarCampanhaComplementar(profile: Profile, input: SalvarCampanhaComplementarInput): Promise<void>;
  excluirCampanhaComplementar(id: string): Promise<void>;
  getVendasComplementaresCampanha(profile: Profile, campanhaId: string): Promise<VendaComplementarMarcada[]>;
  // Contagem autodeclarada de clientes ofertados no dia — mesma lógica
  // de "só hoje é editável pro vendedor" da tela, não do método em si.
  getOfertaComplementarDia(profile: Profile, data: string, codigoVendedor: number): Promise<number>;
  salvarOfertaComplementarDia(profile: Profile, data: string, codigoVendedor: number, clientesOfertados: number): Promise<void>;
  // De TODOS os vendedores no período (não só o logado) — usado no
  // card de resumo da campanha pra mostrar o resultado diário de cada
  // um, independente de ter batido o piso de premiação ou não.
  getOfertaComplementarPeriodo(profile: Profile, dataInicio: string, dataFim: string): Promise<OfertaComplementarDia[]>;

  // Produto em falta — lista compartilhada, qualquer autenticado
  // reporta/edita/apaga (não é gestor-only, é registro rápido de
  // balcão). getProdutosEmFalta traz tudo, a tela filtra pro mês.
  getProdutosEmFalta(profile: Profile): Promise<ProdutoEmFalta[]>;
  salvarProdutoEmFalta(profile: Profile, input: SalvarProdutoEmFaltaInput): Promise<void>;
  excluirProdutoEmFalta(id: string): Promise<void>;
  // Relatório de compra a partir das faltas registradas (aba Compras,
  // 18/08/2026) — enriquece com custo/fornecedor quando dá. Gerar o
  // XLSX já limpa a lista (limparProdutosEmFalta) — mesmo padrão de
  // exclusão definitiva que excluirProdutoEmFalta já usa, só em lote;
  // o próprio arquivo exportado vira o registro histórico do pedido.
  gerarRelatorioFaltas(profile: Profile): Promise<ItemRelatorioFalta[]>;
  limparProdutosEmFalta(ids: string[]): Promise<void>;

  // Pendências — lista compartilhada (todo mundo lê/registra), igual
  // Produto em falta. getPendencias traz só as ATIVAS (baixada=false);
  // darBaixaPendencia marca resolvida, não apaga.
  getPendencias(profile: Profile): Promise<Pendencia[]>;
  salvarPendencia(profile: Profile, input: SalvarPendenciaInput): Promise<void>;
  darBaixaPendencia(id: string): Promise<void>;

  // Compras (Dose Certa) — gestor-only na UI. Fornecedor sugerido e
  // fator de compra vêm da compra mais recente de cada produto
  // (vw_produto_fornecedor_recente no real), não de cadastro manual.
  gerarSugestaoCompras(profile: Profile, params: ParametrosCompra): Promise<SugestaoCompra[]>;
  // Classificação em lote (18/08/2026) — "não vou comprar esse produto
  // porque já resolvi de outro jeito". gerarSugestaoCompras já filtra
  // fora quem está classificado; getClassificacoesCompra alimenta a
  // lista "Classificados" (com opção de reincluir).
  classificarItensCompra(
    profile: Profile,
    codigosProduto: number[],
    motivo: MotivoClassificacaoCompra,
    observacao?: string
  ): Promise<void>;
  getClassificacoesCompra(profile: Profile): Promise<ItemClassificacaoCompra[]>;
  removerClassificacaoCompra(codigoProduto: number): Promise<void>;
  // Mesmo critério do zap diário de "estoque zerado — giro alto"
  // (coletor/whatsapp_estoque_giro_alto_zerado.n8n.json), pra dar
  // destaque a isso também dentro do app. Também já filtrado por
  // compras_classificacoes — classificar aqui ou na Sugestão de
  // compras tem o mesmo efeito.
  getEstoqueZeradoGiroAlto(profile: Profile): Promise<ItemEstoqueZeradoGiroAlto[]>;

  // Precificação — gestor-only na UI. Diagnóstico (quem merece atenção
  // e por quê), diferente de Campanhas (decide quanto descontar).
  getRelatorioPrecificacao(profile: Profile): Promise<ItemPrecificacao[]>;

  // Relatório mensal (23/08/2026) — gestor-only. mesReferencia sempre
  // dia 1 do mês (ex.: "2026-08-01"). Devolve a lista crua daquele mês
  // (farmácia + cada vendedor) — a tela decide como agrupar.
  // ateData (opcional, "YYYY-MM-DD"): recorta o período até esse dia
  // em vez do mês inteiro — usado pra comparar o mês em andamento com
  // o "mesmo período" do mês anterior (dia 1 até hoje dos dois lados),
  // em vez de mês parcial vs mês fechado inteiro (comparação injusta).
  getMetricasMensais(profile: Profile, mesReferencia: string, ateData?: string): Promise<MetricaMensal[]>;
}
