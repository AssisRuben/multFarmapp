export type Role = 'vendedor' | 'gestor';

export interface Profile {
  id: string;
  tenantId: string;
  nome: string;
  email: string;
  role: Role;
  codigoVendedor: number | null;
}

// Espelha sync_control — controle de última sincronização do coletor
// com a API SGF. NÃO vem da API (a API não informa quando os dados
// foram puxados); é escrito pelo próprio coletor a cada rodada.
export interface StatusSincronizacao {
  entityName: string;
  ultimaSincronizacao: string | null;
}

// Espelha vw_desempenho_vendedor_diario
export interface DesempenhoVendedorDiario {
  dataEmissao: string;
  codigoVendedor: number;
  nomeVendedor: string;
  quantidadeAtendimentos: number;
  quantidadeItens: number;
  itensPorAtendimento: number;
}

// Espelha vw_metricas_vendedor_diario
export interface MetricasVendedorDiario {
  dataEmissao: string;
  codigoVendedor: number;
  nomeVendedor: string;
  qtdNotas: number;
  faturamentoLiquido: number;
  faturamentoBruto: number;
  totalDesconto: number;
  taxaDescontoPct: number;
  comissaoEstimada: number;
  ticketMedio: number;
  // Custo de aquisição total (venda_itens.vlr_custo_produto) — margem
  // bruta = faturamentoLiquido - totalCusto.
  totalCusto: number;
  margemBrutaPct: number;
}

// Espelha vw_desempenho_vendedor_mensal — mesma conta de
// DesempenhoVendedorDiario, agregada pro mês inteiro.
export interface DesempenhoVendedorMensal {
  ano: number;
  mes: number;
  codigoVendedor: number;
  nomeVendedor: string;
  quantidadeAtendimentos: number;
  quantidadeItens: number;
  itensPorAtendimento: number;
}

// Espelha vw_metricas_vendedor_mensal — mesma conta de
// MetricasVendedorDiario, agregada pro mês inteiro.
export interface MetricasVendedorMensal {
  ano: number;
  mes: number;
  codigoVendedor: number;
  nomeVendedor: string;
  qtdNotas: number;
  faturamentoLiquido: number;
  faturamentoBruto: number;
  totalDesconto: number;
  taxaDescontoPct: number;
  comissaoEstimada: number;
  ticketMedio: number;
  totalCusto: number;
  margemBrutaPct: number;
}

// Espelha vw_desempenho_vendedor_semanal — mesma conta de
// DesempenhoVendedorDiario, agregada por bucket de semana fixo
// (1-7, 8-14, 15-21, 22-fim do mês — ver semanaDoDia() em lib/metas.ts).
export interface DesempenhoVendedorSemanal {
  ano: number;
  mes: number;
  semana: 1 | 2 | 3 | 4;
  codigoVendedor: number;
  nomeVendedor: string;
  quantidadeAtendimentos: number;
  quantidadeItens: number;
  itensPorAtendimento: number;
}

// Espelha vw_metricas_vendedor_semanal — mesma conta de
// MetricasVendedorDiario, agregada por bucket de semana fixo.
export interface MetricasVendedorSemanal {
  ano: number;
  mes: number;
  semana: 1 | 2 | 3 | 4;
  codigoVendedor: number;
  nomeVendedor: string;
  qtdNotas: number;
  faturamentoLiquido: number;
  faturamentoBruto: number;
  totalDesconto: number;
  taxaDescontoPct: number;
  comissaoEstimada: number;
  ticketMedio: number;
  totalCusto: number;
  margemBrutaPct: number;
}

// Espelha fn_desempenho_vendedor_periodo — mesma conta de
// DesempenhoVendedorDiario, agregada por um intervalo de datas
// arbitrário (o seletor "Período" do Painel, 11/08/2026).
export interface DesempenhoVendedorPeriodo {
  dataInicio: string;
  dataFim: string;
  codigoVendedor: number;
  nomeVendedor: string;
  quantidadeAtendimentos: number;
  quantidadeItens: number;
  itensPorAtendimento: number;
}

// Espelha fn_metricas_vendedor_periodo — mesma conta de
// MetricasVendedorDiario, agregada por um intervalo de datas
// arbitrário. Sem comissaoEstimada: comissão só existe pra bucket de
// semana/mês fixo (regra real de negócio), não faz sentido pra um
// período livre — ver comentário no card "Desempenho" do Painel.
export interface MetricasVendedorPeriodo {
  dataInicio: string;
  dataFim: string;
  codigoVendedor: number;
  nomeVendedor: string;
  qtdNotas: number;
  faturamentoLiquido: number;
  faturamentoBruto: number;
  totalDesconto: number;
  taxaDescontoPct: number;
  ticketMedio: number;
  totalCusto: number;
  margemBrutaPct: number;
}

// Espelha vw_clientes_por_vendedor — clientes distintos que o
// vendedor já atendeu, com total gasto COM ELE especificamente (tela
// "Meus clientes").
export interface ClienteDoVendedor {
  codigo: number;
  nome: string;
  telefone: string | null;
  email: string | null;
  dataNascimento: string | null;
  valorTotal: number;
  ultimaCompra: string | null;
}

// ============================================================
// CARTEIRA DE CLIENTES — lista curada manualmente pelo vendedor
// (aba "Carteira de clientes"), substitui o antigo card de aniversário
// em Alertas. valor6Meses/compradoEsteMes somam QUALQUER vendedor (ver
// comentário de vw_carteira_clientes em schema.sql) — só o VÍNCULO à
// carteira é que é por vendedor.
// ============================================================
export interface ClienteCarteira {
  id: string;
  codigoVendedor: number;
  codigoCliente: number;
  nome: string;
  telefone: string | null;
  valor6Meses: number;
  compradoEsteMes: boolean;
  valorMesAtual: number;
}

// Resultado da busca por nome/CPF pra adicionar cliente na carteira —
// espelha um subconjunto de `clientes` (tabela aberta pra leitura a
// qualquer autenticado).
export interface ClienteBusca {
  codigo: number;
  nome: string;
  numeroCpfCnpj: string | null;
  telefone: string | null;
}

// Espelha vw_cliente_dono_carteira (21/08/2026) — quem já é "dono" de
// cada cliente na carteira, SEM o resto dos dados de vw_carteira_clientes
// (valor comprado, telefone): só o suficiente pra avisar "esse cliente já
// está na carteira de fulano" na hora de buscar/adicionar, evitando
// duplicidade entre carteiras de vendedores diferentes — achado
// 21/08/2026 revisando os dados reais (2 clientes em 2 carteiras cada).
export interface DonoCarteira {
  codigoCliente: number;
  codigoVendedor: number;
  nomeVendedor: string;
}

// Espelha vw_historico_compras_cliente — histórico de compra por
// PRODUTO (não por nota) do cliente inteiro (qualquer vendedor),
// mostrado ao expandir um cliente na tela "Meus clientes" (só os
// últimos 5, filtro no app).
export interface HistoricoCompraCliente {
  itemId: number;
  vendaId: number;
  dataEmissao: string;
  codigoProduto: number;
  nomeProduto: string;
  quantidade: number;
  valorTotal: number;
  codigoVendedor: number | null;
  nomeVendedor: string | null;
}

// Espelha vw_clientes_produtos_vendedor — base dos filtros de resgate
// da tela "Meus clientes": 1 linha por (cliente, produto) que o
// vendedor já vendeu. "atrasado" é o sinal mais forte pra resgate —
// cliente que compra esse produto com regularidade e já passou do
// prazo esperado pra comprar de novo.
export interface ProdutoRecorrenteCliente {
  codigoCliente: number;
  codigoProduto: number;
  nomeProduto: string;
  categoria: string | null;
  grupo: string | null;
  qtdCompras: number;
  ultimaCompra: string;
  intervaloMedioDias: number | null;
  diasDesdeUltimaCompra: number;
  recorrente: boolean;
  atrasado: boolean;
}

// Espelha vw_ranking_vendedores_dia
export interface RankingVendedorDia {
  dataEmissao: string;
  codigoVendedor: number;
  nomeVendedor: string;
  faturamentoLiquido: number;
  posicao: number;
}

// Espelha vw_clientes_inatividade. codigoVendedor/nomeVendedor são do
// vendedor da ÚLTIMA compra do cliente — é o que define "cliente do
// vendedor" pra filtro da aba Clientes (vendedor só vê os seus,
// gestor vê todos).
export interface ClienteInatividade {
  codigo: number;
  nome: string;
  telefone: string | null;
  ultimaCompra: string | null;
  diasSemComprar: number | null;
  inativo: boolean;
  codigoVendedor: number | null;
  nomeVendedor: string | null;
}

// Resumo agregado pro tile "Clientes inativos" do Painel — contagem
// feita no banco (não conta linhas trazidas pro app, que ficaria
// sujeita ao limite padrão de 1000 linhas por request do PostgREST).
export interface ResumoClientesInatividade {
  total: number;
  inativos: number;
}

export type TipoReceita = 'comum' | 'controle_especial' | 'antimicrobiano';

export interface Produto {
  codigo: number;
  nome: string;
  precoAtual: number;
  precoAnterior: number | null;
  emPromocao: boolean;
  percentualDesconto: number | null;
  exigeReceita: boolean;
  tipoReceita: TipoReceita | null;
}

export interface ClienteCompradorPromocao {
  codigoCliente: number;
  nomeCliente: string;
  telefone: string | null;
  ultimaCompraProduto: string;
  quantidade: number;
}

export interface ProdutoPromocaoAlerta {
  produto: Produto;
  clientes: ClienteCompradorPromocao[];
  // Quantidade vendida SÓ dentro do período da ação (por produto, não
  // por cliente) — diferente de clientes[].quantidade, que é o
  // histórico inteiro de cada cliente (usado pra decidir quem mostrar
  // na lista de "já comprou antes", não pra essa métrica).
  quantidadeVendidaAcao: number;
}

export interface VendaReceitaPendente {
  itemId: string;
  dataVenda: string;
  codigoProduto: number;
  nomeProduto: string;
  tipoReceita: TipoReceita;
  codigoCliente: number | null;
  nomeCliente: string;
  codigoVendedor: number;
  nomeVendedor: string;
  receitaAnexada: boolean;
  receitaDataAnexo: string | null;
  receitaFotoUri: string | null;
}

// Espelha vw_vendas_antimicrobiano_recente — vendas de produto
// classificado como antimicrobiano por categoria/grupo do catálogo
// (mais abrangente que tipo_lista='T' de VendaReceitaPendente, que
// tem gap de cadastro real — ver comentário na view). Usado só pro
// card "Antibiótico vendido" em Alertas (acompanhamento pós-venda),
// NÃO é sobre retenção de receita.
export interface VendaAntimicrobianoRecente {
  itemId: string;
  dataVenda: string;
  codigoProduto: number;
  nomeProduto: string;
  codigoCliente: number | null;
  nomeCliente: string;
}

// Compliance: venda sem identificação real do comprador — sem cliente
// na venda, OU cliente = o próprio vendedor (usado como atalho pra não
// pedir o CPF de quem comprou de verdade). Alimenta o card "Venda sem
// comprador" em Alertas (02/08/2026, achado analisando os dados reais
// com o usuário). [06/08/2026] Ampliado de "só produto controlado" pra
// todo tipo de venda — os campos *Controladas continuam existindo pro
// filtro "só controlados" da tela, os sem sufixo são o total geral.
export interface IdentificacaoCompradorVendedor {
  codigoVendedor: number;
  nomeVendedor: string;
  totalVendas: number;
  vendasSemIdentificacao: number;
  percentualSemIdentificacao: number;
  totalVendasControladas: number;
  vendasControladasSemIdentificacao: number;
  percentualControladasSemIdentificacao: number;
  // Subconjunto de vendasSemIdentificacao onde o cliente cadastrado é o
  // próprio vendedor (padrão mais suspeito que só "esqueceu de
  // cadastrar" — filtro à parte na tela).
  vendasProprioCpf: number;
  percentualProprioCpf: number;
}

// Drill-down de IdentificacaoCompradorVendedor: a venda específica
// por trás do número (clicar no vendedor no card de Alertas mostra
// essa lista — nota, data, produto, motivo). `controlado` deixa a tela
// filtrar a lista já carregada sem buscar de novo.
export interface VendaSemIdentificacaoComprador {
  itemId: string;
  dataVenda: string;
  horaVenda: string | null;
  numeroNota: number;
  nomeProduto: string;
  motivo: 'sem_cliente' | 'proprio_cpf';
  controlado: boolean;
}

// ============================================================
// CONTATOS — registro de tentativa de contato (ligação/WhatsApp) feita
// a partir do app, pra não insistir com o mesmo cliente pelo mesmo
// motivo toda vez que a lista recarrega (03/08/2026). "Tentativa": o
// app só sabe que o discador/WhatsApp abriu, não que a ligação foi
// atendida nem que a mensagem foi lida.
// ============================================================
export type MotivoContato = 'resgate' | 'aniversario' | 'uso_continuo' | 'alto_valor_sumindo' | 'promocao' | 'antibiotico' | 'carteira';
// 'nao_contatado': não é um jeito de contato de verdade, é o registro
// automático de "passou 1 semana e ninguém ligou/mandou msg" (só usado
// no motivo 'antibiotico' — ver antibioticosExpirados em AlertasScreen).
export type TipoContato = 'whatsapp' | 'ligacao' | 'nao_contatado';

export interface ContatoCliente {
  codigoCliente: number;
  motivo: MotivoContato;
  codigoProduto: number | null;
  contatadoEm: string;
}

export interface RegistrarContatoInput {
  codigoCliente: number;
  motivo: MotivoContato;
  tipoContato: TipoContato;
  codigoProduto?: number | null;
  codigoVendedor: number | null;
}

// ============================================================
// METAS — mensal + 4 buckets semanais fixos (1–7, 8–14, 15–21,
// 22–fim do mês).
// ============================================================
export interface MetaSemana {
  semana: 1 | 2 | 3 | 4;
  rotulo: string;
  valorMeta: number;
  valorRealizado: number;
}

export interface MetaVendedor {
  codigoVendedor: number;
  nomeVendedor: string;
  ano: number;
  mes: number;
  valorMetaMensal: number;
  valorRealizadoMensal: number;
  semanas: MetaSemana[];
}

export interface SalvarMetaInput {
  codigoVendedor: number;
  ano: number;
  mes: number;
  valorMetaMensal: number;
  valoresMetaSemanal: [number, number, number, number];
}

// Lista enxuta de vendedores ativos (código + nome), pra seletores e
// telas de lançamento em massa — diferente de MetaVendedor, não
// depende de já existir meta lançada pro período.
export interface VendedorAtivo {
  codigo: number;
  nome: string;
}

// ============================================================
// COMISSÃO — sobre margem bruta. Se a margem do mês bater 100% da
// meta MENSAL, comissão = 10% flat sobre o mês inteiro. Senão, soma
// a comissão de cada semana (cada semana na sua própria faixa,
// contra a própria meta semanal). Espelha
// vw_metas_comissao/faixas_comissao no Supabase real.
// ============================================================
export interface FaixaComissao {
  percentualMetaMin: number;
  percentualComissao: number;
}

export interface DetalheSemanaComissao {
  semana: number;
  margem: number;
  meta: number;
  percentual: number;
  taxa: number;
  comissao: number;
}

export interface ComissaoMensal {
  codigoVendedor: number;
  nomeVendedor: string;
  ano: number;
  mes: number;
  valorMeta: number;
  valorRealizado: number;
  percentualAtingido: number;
  margemBrutaValor: number;
  percentualComissao: number;
  comissaoValor: number;
  regraAplicada: 'flat_10_mensal' | 'soma_semanal';
  detalheSemanas: DetalheSemanaComissao[] | null;
  // Maior faixa (3/5/7/8/10) já alcançada no mês — ratchet, só sobe
  // (ver comissao_faixa_alcancada) — usada pra medalha de gamificação
  // 🔰🥉🥈🥇🏆. null = ainda não saiu do piso de 3% nenhuma vez.
  faixaAlcancada: number | null;
}

// ============================================================
// CHECKLIST DIÁRIO — atividades cadastradas pelo gestor, marcadas
// pelo vendedor todo dia. `horario` (HH:00 — só a hora, minuto sempre
// zero) dispara um lembrete push nos dias marcados em `diasSemana`.
// `diasSemana` usa a numeração do expo-notifications (domingo=1 ...
// sábado=7). `codigosVendedor` vazio = atividade vale pra todo mundo;
// preenchido = só aparece no checklist desses vendedores específicos
// (pode ser mais de um).
// ============================================================
export interface AtividadeChecklist {
  id: string;
  titulo: string;
  horario: string | null;
  ativo: boolean;
  codigosVendedor: number[];
  nomesVendedores: string[];
  diasSemana: number[];
}

export interface ChecklistItemStatus {
  atividade: AtividadeChecklist;
  concluida: boolean;
}

// ============================================================
// CAMPANHAS / CARTAZETES
//
// O Trier NÃO tem endpoint de escrita pra desconto/campanha — só
// leitura (obter-todos/obter-alterados/obter-movimentados, igual
// venda/cliente). Quem decide preço de encarte é a rede, digitado
// direto no Trier. O que este módulo resolve é a decisão que a
// farmácia NÃO faz em lugar nenhum hoje: promoção avulsa baseada em
// margem/estoque/venda. Por isso "campanha" aqui é uma entidade
// NOSSA (Supabase), não um espelho de algo do Trier — e o preço só
// vale de verdade no caixa depois que o .txt gerado é importado
// manualmente no Trier (não existe API pra isso).
// ============================================================

// Espelha produto_catalogo — futuramente sincronizado do
// ProdutoIntegracaoDto real (Trier); por ora, mock.
export interface ProdutoCatalogo {
  codigo: number;
  codigoBarras: string;
  nome: string;
  // categoria = nomeCategoria do Trier ("tipo de uso", ex. "Uso Adulto") —
  // inconsistente e com muito null no catálogo real. grupo = nomeGrupo,
  // a categoria de produto de fato (ex. "ETICO", "PERFUMARIA") — é o
  // campo confiável pra qualquer classificação de negócio. Opcional
  // porque o seed mock não tem essa distinção.
  categoria: string;
  grupo?: string;
  marca: string;
  precoVenda: number;
  custoMedio: number;
  estoqueAtual: number;
  // ProdutoIntegracaoDto.tipoLista — null/vazio = não exige receita,
  // 'T' = antimicrobiano, outro valor = controle especial (mesmo
  // campo usado em vw_vendas_antimicrobiano_recente/produto_catalogo.
  // Usado pra aproximar "MIPS" no modelo de campanha (18/08/2026):
  // medicamento (éticos/genéricos/similares) que NÃO exige receita.
  tipoLista?: string | null;
}

export interface ProdutoElegibilidade {
  produto: ProdutoCatalogo;
  margemAtualPct: number;
  quantidadeVendida30d: number;
  diasSemVenda: number | null;
  percentualDescontoSugerido: number;
  precoSugerido: number;
  margemResultantePct: number;
}

export type ModoSugestaoCampanha = 'popularidade' | 'liquidacao';

// Campanhas recorrentes fixas (18/08/2026, espelhando as campanhas já
// usadas hoje via FarmaUP) — cada uma tem regra própria de seleção de
// produto, ver lib/campanhas.ts:
//   'estoque_parado_60'  — sem venda há 60+ dias, ainda em estoque.
//   'mips'                — medicamento (éticos/genéricos/similares)
//                            que não exige receita (aproximação via
//                            tipoLista nulo).
//   'nao_medicamentos'    — fora de éticos/genéricos/similares/administrativo.
//   'desodorantes'        — nome do produto contém "desodorante".
//   'bebe_idoso'          — infantil&puericultura (cobre fralda infantil
//                            E geriátrica, que caem no mesmo grupo bruto).
export type ModeloCampanha = 'estoque_parado_60' | 'mips' | 'nao_medicamentos' | 'desodorantes' | 'bebe_idoso';

export interface SugestaoCampanhaParams {
  margemMinimaPct: number;
  descontoAlvoPct: number;
  quantidadeMaxima: number;
  // 'popularidade' (padrão, se omitido): prioriza quem já vende bem.
  // 'liquidacao': busca estoque parado (sem venda recente, ainda em
  // estoque) pra desencalhar, priorizando quem tem mais capital parado.
  // Ignorado quando `modelo` está presente (modelo decide o próprio modo).
  modo?: ModoSugestaoCampanha;
  // id de MacroGrupo (lib/macroGrupo.ts, ex. "genericos") — filtra a
  // sugestão só pra essa macro-categoria (campanha temática, ex. "Dia
  // do Genérico"). String (não o tipo MacroGrupo) porque domain.ts não
  // importa de lib/ — validado no lado de quem consome (lib/campanhas.ts).
  // Ignorado quando `modelo` está presente.
  macroGrupo?: string;
  // Modelo de campanha fixo (18/08/2026) — quando presente, sobrepõe
  // modo/macroGrupo com a regra própria daquele modelo.
  modelo?: ModeloCampanha;
}

// Promoção "kit" (18/08/2026, ex.: "compre 3 pague 2", "50% no 2º
// item") — alternativa ao desconto simples por unidade. Aplicada por
// PRODUTO (CampanhaProduto), não por campanha inteira.
export interface KitPromocao {
  // Quantas unidades precisa levar pra ativar o desconto (ex.: 2 ou 3).
  quantidadeMinima: number;
  // Dois formatos (02/09/2026, mesmo padrão de KitMultiProduto mais
  // abaixo): 'percentual' usa percentualDescontoItem (100 = grátis,
  // vira "compre N pague N-1"; 50/25 = desconto parcial no item);
  // 'preco_fixo' usa precoFixo — preço fechado pras quantidadeMinima
  // unidades (ex.: "3 por R$29,90"), que não existia antes. Exatamente
  // um dos dois campos é não-nulo, conforme tipoPrecificacao.
  tipoPrecificacao: TipoPrecificacaoKit;
  percentualDescontoItem: number | null;
  precoFixo: number | null;
}

export type TipoPromocaoProduto = 'unitario' | 'kit';

export interface CampanhaProduto {
  codigoProduto: number;
  codigoBarras: string;
  nomeProduto: string;
  precoRegular: number;
  // Preço de compra/custo médio do produto (02/09/2026) — resolvido do
  // catálogo igual codigoBarras/nomeProduto (0 quando ainda não
  // resolvido, ex.: lista leve de campanhas). Usado pra mostrar margem
  // real no painel de kit (Cartazetes).
  custoMedio: number;
  precoPromocional: number;
  percentualDesconto: number;
  quantidadeCartazes: number;
  // Validade por item — começa igual à da campanha, mas é editável
  // por produto na tela de Cartazetes (ex.: estender a validade de um
  // item específico). Persiste em campanha_produtos (null = sem
  // override, segue a campanha) — resolvido 18/08/2026.
  dataInicio: string;
  dataFim: string;
  // Promoção "kit" (18/08/2026) — 'unitario' (padrão) usa
  // precoPromocional/percentualDesconto normalmente; 'kit' ignora esses
  // dois pro cartaz/preço e usa `kit` em vez disso (ver KitPromocao).
  tipoPromocao: TipoPromocaoProduto;
  kit: KitPromocao | null;
}

// Kit multi-produto por afinidade de compra (02/09/2026) — DIFERENTE
// de KitPromocao acima (que é "leve mais unidades do MESMO produto").
// Aqui o kit junta produtos DIFERENTES que os clientes já compram
// juntos na prática (ex.: fralda + lenço umedecido), sugerido a partir
// de venda real (ver lib/afinidadeKits.ts). Sem desempenho de venda
// tracked ainda (vw_campanhas_desempenho só soma por codigo_produto
// único — um kit multi-produto não tem um único código pra juntar).
export type TipoPrecificacaoKit = 'percentual' | 'preco_fixo';

export interface KitMultiProdutoItem {
  codigoProduto: number;
  nomeProduto: string;
  quantidade: number;
  precoRegular: number;
  custoMedio: number;
}

export interface KitMultiProduto {
  id: string;
  nome: string | null;
  tipoPrecificacao: TipoPrecificacaoKit;
  // Exatamente um dos dois é não-nulo, conforme tipoPrecificacao.
  percentualDescontoItem: number | null;
  precoFixo: number | null;
  quantidadeCartazes: number;
  dataInicio: string;
  dataFim: string;
  produtos: KitMultiProdutoItem[];
}

// Par de produtos sugerido por co-ocorrência de venda (market basket
// analysis via fn_sugerir_pares_afinidade) — ainda não é um kit
// salvo, é a matéria-prima que a tela de sugestão mostra pro gestor
// escolher/editar antes de virar KitMultiProduto de verdade.
export interface SugestaoParAfinidade {
  codigoProdutoSeed: number;
  nomeProdutoSeed: string;
  precoRegularSeed: number;
  custoMedioSeed: number;
  codigoProdutoParceiro: number;
  nomeProdutoParceiro: string;
  precoRegularParceiro: number;
  custoMedioParceiro: number;
  coOcorrencias: number;
  vendasSeed: number;
  vendasParceiro: number;
  lift: number;
}

export interface SugestaoKitsParams {
  // Obrigatório (diferente de SugestaoCampanhaParams.macroGrupo) —
  // sem categoria, o código-semente viraria o catálogo inteiro.
  macroGrupo: string;
  diasJanela?: number;
  minCoOcorrencias?: number;
  liftMinimo?: number;
}

export interface Campanha {
  id: string;
  nome: string;
  dataInicio: string;
  dataFim: string;
  criadaEm: string;
  produtos: CampanhaProduto[];
  kits: KitMultiProduto[];
  // Desempenho real de venda no período da campanha (26/08/2026) —
  // diferente de produtos.length (quantidade de produtos CADASTRADOS),
  // isso é quantidade VENDIDA de fato. 0 quando ninguém vendeu ainda.
  quantidadeVendida: number;
  valorVendido: number;
}

export interface SalvarCampanhaInput {
  id?: string;
  nome: string;
  dataInicio: string;
  dataFim: string;
  produtos: CampanhaProduto[];
  kits: KitMultiProduto[];
}

// Um cartaz por grupo (mesmo nome-base + preço + validade) — o
// mesmo produto em tamanhos/variações diferentes vira UM cartaz
// listando as variantes, não um cartaz por código de barras.
export interface GrupoCartazete {
  chave: string;
  nomeBase: string;
  variantes: string[];
  precoPromocional: number;
  percentualDesconto: number;
  dataInicio: string;
  dataFim: string;
  quantidadeCartazes: number;
  produtos: CampanhaProduto[];
}

// ============================================================
// VENDA ADICIONAL — incentivo pontual pra vendedor empurrar produto(s)
// específico(s) num período (03/08/2026). DIFERENTE de Campanha acima
// (aquilo é preço de cartazete impresso) — aqui não mexe em preço,
// é só premiação de venda. Prêmio é informativo (não entra no
// fechamento de comissão). Gestor cadastra na aba "Venda adicional",
// todo vendedor vê no card de Alertas.
// ============================================================
export type TipoPremiacaoVendaAdicional = 'ranking' | 'meta_individual';
// 'acumulado_periodo': soma tudo que o vendedor vendeu no período
// inteiro (padrão).
// 'mesma_venda': só conta o MAIOR cupom individual de cada vendedor —
// pra campanha de produto único tipo "compre 2" (vendeu 2 do MESMO
// produto juntas na mesma venda).
// 'venda_com_outros_itens': só conta a venda se ela tiver outro item
// além do(s) produto(s) da campanha — pra campanha de vários produtos
// tipo "adicional bebê" (pomada, lenço, chupeta): quem levou só a
// chupeta sozinha não conta, quem já estava comprando outra coisa e
// levou junto conta. Não olha quantidade do produto da campanha, só
// se veio acompanhado de algo mais na nota (03/08/2026).
export type CriterioQuantidadeVendaAdicional = 'acumulado_periodo' | 'mesma_venda' | 'venda_com_outros_itens';

export interface PremiacaoRankingItem {
  posicao: number;
  valor: number;
}

export interface CampanhaVendaAdicional {
  id: string;
  nome: string;
  dataInicio: string;
  dataFim: string;
  tipoPremiacao: TipoPremiacaoVendaAdicional;
  criterioQuantidade: CriterioQuantidadeVendaAdicional;
  // Só preenchido pro tipo 'meta_individual'.
  metaQuantidade: number | null;
  premiacaoMetaValor: number | null;
  // Só preenchido pro tipo 'ranking' — ex.: [{posicao:1,valor:200}, ...].
  premiacaoRanking: PremiacaoRankingItem[] | null;
  // Só faz sentido pro tipo 'ranking': piso mínimo pra entrar na
  // disputa (ex.: "concorre a partir de 5") — vendedor abaixo disso
  // nem aparece no ranking, mesmo tendo vendido algo. Null = sem piso.
  minimoParaConcorrer: number | null;
  // HH:mm opcional — preparado pra reaproveitar o mecanismo de
  // notificação local do Checklist (lib/notifications.ts), ainda não
  // implementado pra venda adicional.
  horarioLembrete: string | null;
  produtos: { codigoProduto: number; nomeProduto: string }[];
}

export interface SalvarCampanhaVendaAdicionalInput {
  id?: string;
  nome: string;
  dataInicio: string;
  dataFim: string;
  tipoPremiacao: TipoPremiacaoVendaAdicional;
  criterioQuantidade: CriterioQuantidadeVendaAdicional;
  metaQuantidade: number | null;
  premiacaoMetaValor: number | null;
  premiacaoRanking: PremiacaoRankingItem[] | null;
  minimoParaConcorrer: number | null;
  horarioLembrete: string | null;
  codigosProduto: number[];
}

// Espelha vw_venda_adicional_vendas — uma linha por venda de produto
// de uma campanha, já dentro do período dela. Alimenta a lista do card
// em Alertas (produto, cliente, data, horário) e o cálculo de
// ranking/meta batida (feito no app, agrupando por vendedor). vendaId
// (não confundir com itemId) é o que agrupa "mesmo cupom" no critério
// 'mesma_venda' — duas linhas de produtos diferentes na mesma nota têm
// itemId diferente mas vendaId igual.
export interface VendaVendaAdicional {
  itemId: string;
  vendaId: string;
  numeroNota: number | null;
  campanhaId: string;
  dataVenda: string;
  horaVenda: string | null;
  codigoProduto: number;
  nomeProduto: string;
  quantidade: number;
  codigoVendedor: number | null;
  nomeVendedor: string | null;
  codigoCliente: number | null;
  nomeCliente: string | null;
  // Total de itens (linhas) na nota inteira, não só os da campanha —
  // usado pelo critério 'venda_com_outros_itens' pra saber se o
  // produto veio sozinho na venda ou acompanhado de algo mais.
  qtdItensNaVenda: number;
  // Nomes dos outros produtos que vieram na mesma nota (fora os da
  // campanha), separados por vírgula — null se veio sozinho. Mostra
  // "com o que" a venda contou no critério 'venda_com_outros_itens'.
  outrosProdutosNaVenda: string | null;
  // Valor líquido dessa linha (21/08/2026) — Venda Adicional só
  // rastreava quantidade até então; usado no resumo por vendedor
  // (Alertas e na própria aba) pra mostrar quanto em R$, não só quantas
  // unidades.
  valor: number;
}

// ============================================================
// VENDAS COMPLEMENTARES (13/08/2026) — vendedor marca manualmente quais
// itens da própria venda de HOJE foram venda complementar (upsell).
// Diferente de Venda Adicional acima (automática, por produto
// pré-escolhido em campanha) — aqui não tem produto pré-definido, é o
// vendedor quem decide item por item. Ranking/premiação por período,
// configurado pelo gestor, calculado no app em cima da soma de valor
// (reaproveita PremiacaoRankingItem de Venda Adicional).
// ============================================================

// Um item de venda do dia (de um vendedor específico), pra tela de
// marcação — vem TODO item do dia, marcado ou não, o checkbox decide.
export interface ItemVendaComplementar {
  itemId: string;
  vendaId: string;
  numeroNota: number | null;
  dataVenda: string;
  codigoProduto: number;
  nomeProduto: string;
  valor: number;
  codigoCliente: number | null;
  nomeCliente: string | null;
  codigoVendedor: number;
  nomeVendedor: string;
  marcado: boolean;
}

// Espelha campanhas_complementares.
export interface CampanhaComplementar {
  id: string;
  dataInicio: string;
  dataFim: string;
  // Em REAIS (soma de valor complementar no período pra concorrer) —
  // diferente de minimoParaConcorrer de Venda Adicional, que é
  // quantidade. Null = sem piso.
  valorMinimo: number | null;
  // Quantidade de itens marcados como complementar no período — os
  // dois pisos (valor e quantidade) são independentes, quem tem os
  // dois precisa bater ambos. Null = sem piso de quantidade.
  quantidadeMinima: number | null;
  // Meta de referência (não é gate de premiação, só informa o alvo pro
  // vendedor) de quantos clientes ele deve oferecer o complementar por
  // dia — pedido explícito do usuário ("pelo menos 10"). Null = sem meta.
  metaClientesOfertadosDia: number | null;
  premiacaoRanking: PremiacaoRankingItem[];
}

export interface SalvarCampanhaComplementarInput {
  id?: string;
  dataInicio: string;
  dataFim: string;
  valorMinimo: number | null;
  quantidadeMinima: number | null;
  metaClientesOfertadosDia: number | null;
  premiacaoRanking: PremiacaoRankingItem[];
}

// Uma linha marcada como complementar, já dentro do período de uma
// campanha — matéria-prima pro cálculo de ranking (soma de valor por
// vendedor), feito no app, mesmo padrão de VendaVendaAdicional.
export interface VendaComplementarMarcada {
  itemId: string;
  vendaId: string;
  dataVenda: string;
  valor: number;
  codigoVendedor: number;
  nomeVendedor: string;
  nomeProduto: string;
}

// Contagem diária autodeclarada de quantos clientes o vendedor
// ofereceu o complementar — não dá pra verificar/controlar, é só
// informativo (espelha venda_complementar_oferta_diaria).
export interface OfertaComplementarDia {
  codigoVendedor: number;
  data: string;
  clientesOfertados: number;
}

// ============================================================
// PRODUTOS EM FALTA (03/08/2026) — registro manual e rápido de "esse
// produto está em falta hoje", feito por qualquer vendedor no balcão.
// DIFERENTE de SugestaoCompra (calculada por demanda/estoque) — aqui
// não tem cálculo nenhum, é só o vendedor reportando na hora. Lista
// compartilhada do mês, editável/apagável por qualquer um.
// ============================================================
export interface ProdutoEmFalta {
  id: string;
  // Texto livre — não precisa existir em produto_catalogo (pode ser
  // produto novo no mercado). codigoProduto só vem preenchido quando
  // o nome bateu com um item já cadastrado (busca assistida na tela).
  nomeProduto: string;
  codigoProduto: number | null;
  data: string;
  // "O produto tem saldo no estoque?" (17/08/2026) — distingue ruptura
  // de gôndola (sistema mostra saldo, mas não acha o produto) de falta
  // real (saldo zerado). Reportado pelo vendedor junto do resto.
  temSaldoEstoque: boolean;
  // Resolvido no banco (vw_produtos_em_falta) — só vem preenchido pra
  // quem está logado como gestor; vendedor sempre recebe null aqui,
  // mesmo sendo o mesmo registro (não é filtro de UI, é a própria view
  // que decide o que devolver).
  nomeRegistradoPor: string | null;
}

export interface SalvarProdutoEmFaltaInput {
  id?: string;
  nomeProduto: string;
  codigoProduto: number | null;
  data: string;
  temSaldoEstoque: boolean;
}

// Item do relatório de compras gerado a partir de produtos_em_falta
// (aba Compras, 18/08/2026) — enriquece ProdutoEmFalta com dado do
// catálogo (custo, código de barras) e fornecedor mais recente, quando
// o item tem codigoProduto vinculado. Sem isso (produto novo/texto
// livre), os três campos ficam null e o comprador preenche na mão.
export interface ItemRelatorioFalta {
  id: string;
  nomeProduto: string;
  codigoProduto: number | null;
  codigoBarras: string | null;
  custoMedio: number | null;
  fornecedorSugerido: string | null;
  data: string;
  nomeRegistradoPor: string | null;
  temSaldoEstoque: boolean;
}

// ============================================================
// RELATÓRIO MENSAL (23/08/2026) — espelha metricas_mensais: formato
// chave/valor (não uma interface por métrica), fechado mês a mês pelo
// workflow n8n de fechamento + o contador ao vivo de produtos em
// falta. codigoVendedor null = métrica da farmácia inteira (ex.:
// produtos em falta reportados, pendências dadas baixa); não-nulo =
// daquele vendedor específico. A tela (RelatorioMensalScreen) decide
// como agrupar/rotular cada chave — o repositório só entrega a lista
// crua de um mês.
// ============================================================
export interface MetricaMensal {
  // Sempre o dia 1 do mês, ex. "2026-08-01".
  mesReferencia: string;
  codigoVendedor: number | null;
  chave: string;
  valor: number;
}

// ============================================================
// PENDÊNCIAS (06/08/2026) — vendedor separa/reserva produto(s) pra um
// cliente buscar depois: foto de comprovante, produtos (texto livre),
// nome do cliente, data automática (hoje). Lista compartilhada — todo
// mundo lê e registra. "Dar baixa" marca resolvida (não apaga, mantém
// histórico) e some da lista ativa.
// ============================================================
export interface Pendencia {
  id: string;
  nomeCliente: string;
  produtos: string;
  fotoUrl: string | null;
  data: string;
  baixada: boolean;
  baixadaEm: string | null;
  nomeRegistradoPor: string | null;
}

export interface SalvarPendenciaInput {
  nomeCliente: string;
  produtos: string;
  fotoUri: string;
}

// ============================================================
// COMPRAS (Dose Certa) — lista de compras sugerida por
// demanda/estoque. Estratégia "estoque de segurança": calcula a
// demanda média diária a partir da venda recente (mesma janela usada
// em Campanhas) e sugere repor até um alvo de dias de cobertura.
// Fornecedor sugerido e fator de compra (conversão de embalagem) vêm
// da compra mais recente do produto (vw_produto_fornecedor_recente) —
// a API da Trier não expõe um cadastro de "fornecedor preferido por
// produto" à parte. Prazo de entrega e última cotação (que existem na
// tela do Dose Certa dentro do Trier) NÃO têm endpoint de leitura —
// por isso não aparecem aqui.
// ============================================================
export interface ParametrosCompra {
  diasSeguranca: number;
  diasCobertura: number;
  // Janela de venda usada pra calcular a demanda média diária (padrão
  // 30 — mesmo recorte histórico de Campanhas/Precificação, que
  // continuam fixas em 30 dias). [10/08/2026] Implementado de verdade
  // no real via fn_venda_periodo_produto(dias) — antes só mudava o
  // divisor da média mantendo o total sempre de 30 dias, dando
  // demanda/quantidade sugerida erradas pra qualquer valor diferente
  // de 30. No mock continua sendo uma aproximação (quantidadeVendida30d
  // fixo, só o divisor muda) — sem dado transacional pra agregar por
  // período no seed.
  diasBaseVenda: number;
  // [10/08/2026] Filtra por MACRO-grupo (valores de MacroGrupo em
  // lib/macroGrupo.ts — "genericos", "similares" etc.), não pelo grupo
  // bruto do catálogo — dá pra marcar mais de um (ex.: só genérico, ou
  // genérico + similar). Vazio/undefined = todos os grupos.
  macroGrupos?: string[];
}

// ============================================================
// PRECIFICAÇÃO — sinais que ajudam decisão de preço, calculados a
// partir do que já existe (giro, margem, categoria, campanha ativa).
// "Parado" e "elasticidade" são heurísticas de v1 (ver
// src/lib/precificacao.ts pros limites usados) — margem por categoria
// ao longo do tempo fica de fora por enquanto: precisaria de série
// histórica que hoje não existe (só temos o "hoje").
// ============================================================
export type TagPrecificacao = 'candidato_reajuste' | 'parado_avaliar_preco' | 'baixa_elasticidade' | 'alta_elasticidade';

export interface ItemPrecificacao {
  produto: ProdutoCatalogo;
  quantidadeVendida30d: number;
  diasSemVenda: number | null;
  margemAtualPct: number;
  temDescontoAtivo: boolean;
  tags: TagPrecificacao[];
}

// Mesmo critério do workflow n8n "WhatsApp - Estoque zerado de produto
// de giro alto" (coletor/whatsapp_estoque_giro_alto_zerado.n8n.json) —
// giro alto = top 20% em quantidade vendida nos últimos 30 dias entre
// quem vendeu algo, e estoque zerado agora. Mantido em espelho pra não
// mostrar no app um produto que não está (ou vice-versa) no zap que o
// gestor já recebe todo dia às 08h.
export interface ItemEstoqueZeradoGiroAlto {
  codigoProduto: number;
  nomeProduto: string;
  quantidadeVendida30d: number;
}

// Classificação em lote de itens da sugestão de compras (18/08/2026) —
// "não vou comprar esse produto específico porque já resolvi de outro
// jeito", sem mexer no cálculo de demanda/estoque. Motivo fixo (não
// texto livre) pra dar pra filtrar/relatar depois.
export type MotivoClassificacaoCompra = 'outro_laboratorio' | 'ja_comprado' | 'outros';

// Espelha vw_compras_classificacoes.
export interface ItemClassificacaoCompra {
  id: string;
  codigoProduto: number;
  nomeProduto: string;
  motivo: MotivoClassificacaoCompra;
  observacao: string | null;
  classificadoEm: string;
  nomeClassificadoPor: string | null;
}

export interface SugestaoCompra {
  codigoProduto: number;
  nomeProduto: string;
  codigoBarras: string;
  grupo: string;
  estoqueAtual: number;
  demandaMediaDiaria: number;
  estoqueMinimo: number;
  estoqueAlvo: number;
  fatorCompra: number;
  custoMedio: number;
  precoVenda: number;
  margemAtualPct: number;
  fornecedorSugerido: string | null;
  // Fornecedor com o menor valor_custo pago nos últimos 12 meses (pode
  // ser diferente do fornecedorSugerido, que é sempre o da compra MAIS
  // RECENTE). É o menor preço HISTÓRICO pago, não uma cotação atual —
  // a API da Trier não expõe cotação em tempo real.
  fornecedorMaisBarato: string | null;
  precoMaisBarato: number | null;
  quantidadeSugerida: number;
}
