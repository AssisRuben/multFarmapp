import AsyncStorage from '@react-native-async-storage/async-storage';
import { DataRepository } from '../repository';
import {
  AtividadeChecklist,
  Campanha,
  CampanhaComplementar,
  CampanhaVendaAdicional,
  ChecklistItemStatus,
  ClienteBusca,
  ClienteCarteira,
  ClienteCompradorPromocao,
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
  IdentificacaoCompradorVendedor,
  ItemClassificacaoCompra,
  ItemEstoqueZeradoGiroAlto,
  ItemPrecificacao,
  ItemRelatorioFalta,
  ItemVendaComplementar,
  MetaSemana,
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
} from '../../types/domain';
import {
  GESTOR_EMAIL,
  MOCK_PASSWORD,
  atividadesChecklistSeed,
  catalogoProdutosSeed,
  clientesSeed,
  compraInfoSeed,
  desempenhoSeedHoje,
  faixasComissaoSeed,
  fornecedoresSeed,
  metasSeedPadrao,
  metricasSeedHoje,
  produtosSeed,
  realizadoSeedPadrao,
  syncControlSeed,
  vendaItensDetalheSeed,
  vendaRecenteSeed,
  vendedoresSeed,
  VendaItemDetalheSeed,
} from './seed';
import { diasDecorridosNaSemana, rotuloSemana, semanaDoDia } from '../../lib/metas';
import { todayISO } from '../../lib/format';
import { sugerirCandidatos } from '../../lib/campanhas';
import { calcularSugestaoCompras } from '../../lib/doseCerta';
import { calcularEstoqueZeradoGiroAlto, calcularRelatorioPrecificacao } from '../../lib/precificacao';

const SESSION_KEY = '@farmapp/session';
const RECEITAS_OVERRIDES_KEY = '@farmapp/receitas_overrides';
const METAS_OVERRIDES_KEY = '@farmapp/metas_overrides';
const CHECKLIST_ATIVIDADES_KEY = '@farmapp/checklist_atividades';
const CHECKLIST_RESPOSTAS_KEY = '@farmapp/checklist_respostas';
const CAMPANHAS_KEY = '@farmapp/campanhas';
const CAMPANHAS_VENDA_ADICIONAL_KEY = '@farmapp/campanhas_venda_adicional';
const CAMPANHAS_COMPLEMENTARES_KEY = '@farmapp/campanhas_complementares';
const VENDA_ITEM_COMPLEMENTAR_KEY = '@farmapp/venda_item_complementar';
const OFERTA_COMPLEMENTAR_DIARIA_KEY = '@farmapp/oferta_complementar_diaria';
const CONTATOS_CLIENTES_KEY = '@farmapp/contatos_clientes';
const PRODUTOS_EM_FALTA_KEY = '@farmapp/produtos_em_falta';
const PENDENCIAS_KEY = '@farmapp/pendencias';
const COMPRAS_CLASSIFICACOES_KEY = '@farmapp/compras_classificacoes';
const CARTEIRA_CLIENTES_KEY = '@farmapp/carteira_clientes';
const SIMULATED_LATENCY_MS = 350;

interface ReceitaOverride {
  receitaAnexada: boolean;
  receitaDataAnexo: string | null;
  receitaFotoUri: string | null;
}

interface MetaOverride {
  valorMetaMensal: number;
  valoresMetaSemanal: [number, number, number, number];
}

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS));
}

function nomeVendedor(codigo: number): string {
  return vendedoresSeed.find((v) => v.codigo === codigo)?.nome ?? `Vendedor ${codigo}`;
}

function nomeCliente(codigo: number): string {
  return clientesSeed.find((c) => c.codigo === codigo)?.nome ?? `Cliente ${codigo}`;
}

function telefoneCliente(codigo: number): string | null {
  return clientesSeed.find((c) => c.codigo === codigo)?.telefone ?? null;
}

function dataDiasAtras(diasAtras: number): string {
  const data = new Date();
  data.setDate(data.getDate() - diasAtras);
  return data.toISOString().slice(0, 10);
}

// Compartilhado por getProdutosRecorrentesDoVendedor (filtra por
// vendedor antes de chamar) e getProdutosRecorrentesClientes (passa
// todo mundo) — só muda o subconjunto de itens agregado, a conta de
// recorrente/atrasado é a mesma.
function agregarProdutosRecorrentes(itens: VendaItemDetalheSeed[]) {
  const porChave = new Map<string, { codigoCliente: number; codigoProduto: number; datas: string[] }>();
  for (const item of itens) {
    const chave = `${item.codigoCliente}-${item.codigoProduto}`;
    const atual = porChave.get(chave) ?? { codigoCliente: item.codigoCliente, codigoProduto: item.codigoProduto, datas: [] };
    atual.datas.push(dataDiasAtras(item.diasAtras));
    porChave.set(chave, atual);
  }
  return Array.from(porChave.values()).map(({ codigoCliente, codigoProduto, datas }) => {
    const produto = produtosSeed.find((p) => p.codigo === codigoProduto);
    const ordenadas = datas.slice().sort();
    const ultimaCompra = ordenadas[ordenadas.length - 1];
    const qtdCompras = ordenadas.length;
    const diasDesdeUltimaCompra = Math.round((Date.now() - new Date(ultimaCompra).getTime()) / 86400000);
    const intervaloMedioDias =
      qtdCompras >= 2
        ? Math.round((new Date(ultimaCompra).getTime() - new Date(ordenadas[0]).getTime()) / 86400000 / (qtdCompras - 1))
        : null;
    const recorrente = qtdCompras >= 2;
    const atrasado = recorrente && intervaloMedioDias != null && diasDesdeUltimaCompra > intervaloMedioDias * 1.3;
    return {
      codigoCliente,
      codigoProduto,
      nomeProduto: produto?.nome ?? `Produto ${codigoProduto}`,
      categoria: null,
      grupo: null,
      qtdCompras,
      ultimaCompra,
      intervaloMedioDias,
      diasDesdeUltimaCompra,
      recorrente,
      atrasado,
    };
  });
}

// Igual à RLS real: gestor vê tudo; vendedor só as linhas do próprio codigo_vendedor.
function visivelParaPerfil<T extends { codigoVendedor: number }>(profile: Profile, linhas: T[]): T[] {
  if (profile.role === 'gestor') return linhas;
  return linhas.filter((linha) => linha.codigoVendedor === profile.codigoVendedor);
}


// metricasSeedHoje/desempenhoSeedHoje são um snapshot FIXO de "hoje" —
// sem variação por data, o Dashboard mostrava o mesmo faturamento
// (e, por tabela, o mesmo "realizado" na meta do dia) não importa qual
// dataEmissao fosse pedida, dando a impressão de que a meta diária
// nunca muda. A meta (alvo) em si varia por bucket de semana + vendedor
// por design (meta da semana ÷ dias de trabalho — ver metaDiaria() em
// lib/metas.ts, isso está correto); o que faltava era o REALIZADO
// reagir à data. Aplica uma variação determinística pelo dia do mês
// (mesmo dia = mesmo valor sempre, dia diferente = valor diferente) —
// só pra simular que o dado depende da data; no backend real isso
// viria de vendas de verdade, não precisaria disso.
function fatorVariacaoPorData(dataEmissao: string): number {
  const dia = Number(dataEmissao.slice(-2)) || 1;
  return 0.82 + ((dia % 15) / 15) * 0.36; // varia entre ~0.82x e ~1.18x
}

function metricasDoDia(dataEmissao: string): MetricasVendedorDiario[] {
  const fator = fatorVariacaoPorData(dataEmissao);
  return metricasSeedHoje.map((m) => {
    const qtdNotas = Math.max(1, Math.round(m.qtdNotas * fator));
    const faturamentoLiquido = round2(m.faturamentoLiquido * fator);
    const faturamentoBruto = round2(m.faturamentoBruto * fator);
    const totalDesconto = round2(m.totalDesconto * fator);
    const comissaoEstimada = round2(m.comissaoEstimada * fator);
    const totalCusto = round2(m.totalCusto * fator);
    return {
      dataEmissao,
      codigoVendedor: m.codigoVendedor,
      nomeVendedor: nomeVendedor(m.codigoVendedor),
      qtdNotas,
      faturamentoLiquido,
      faturamentoBruto,
      totalDesconto,
      taxaDescontoPct: round2((totalDesconto / faturamentoBruto) * 100),
      comissaoEstimada,
      ticketMedio: round2(faturamentoLiquido / qtdNotas),
      totalCusto,
      margemBrutaPct: round2(((faturamentoLiquido - totalCusto) / faturamentoLiquido) * 100),
    };
  });
}

async function getReceitasOverrides(): Promise<Record<string, ReceitaOverride>> {
  const raw = await AsyncStorage.getItem(RECEITAS_OVERRIDES_KEY);
  return raw ? (JSON.parse(raw) as Record<string, ReceitaOverride>) : {};
}

async function getMetasOverrides(): Promise<Record<string, MetaOverride>> {
  const raw = await AsyncStorage.getItem(METAS_OVERRIDES_KEY);
  return raw ? (JSON.parse(raw) as Record<string, MetaOverride>) : {};
}

async function getAtividadesStore(): Promise<AtividadeChecklist[]> {
  const raw = await AsyncStorage.getItem(CHECKLIST_ATIVIDADES_KEY);
  if (raw) {
    const armazenadas = JSON.parse(raw) as any[];
    // migra registros salvos numa versão anterior a existirem os campos
    // horario/diasSemana, ou na versão anterior a codigoVendedor virar
    // codigosVendedor (um vendedor só -> lista de um) — senão fica
    // "preso" sem essa informação, ou quebra ao ler campo undefined,
    // até apagar o app.
    let precisaMigrar = false;
    const migradas = armazenadas.map((a) => {
      if (a.horario !== undefined && a.diasSemana !== undefined && a.codigosVendedor !== undefined) return a;
      precisaMigrar = true;
      const doSeed = atividadesChecklistSeed.find((s) => s.id === a.id);
      const codigosVendedor: number[] =
        a.codigosVendedor ?? (a.codigoVendedor != null ? [a.codigoVendedor] : doSeed?.codigosVendedor ?? []);
      const nomesVendedores: string[] =
        a.nomesVendedores ?? (a.nomeVendedor != null ? [a.nomeVendedor] : doSeed?.nomesVendedores ?? []);
      return {
        id: a.id,
        titulo: a.titulo,
        ativo: a.ativo,
        horario: a.horario ?? doSeed?.horario ?? null,
        codigosVendedor,
        nomesVendedores,
        diasSemana: a.diasSemana ?? doSeed?.diasSemana ?? [2, 3, 4, 5, 6, 7],
      };
    }) as AtividadeChecklist[];
    if (precisaMigrar) {
      await AsyncStorage.setItem(CHECKLIST_ATIVIDADES_KEY, JSON.stringify(migradas));
    }
    return migradas;
  }
  const inicial = atividadesChecklistSeed.map((a) => ({ ...a }));
  await AsyncStorage.setItem(CHECKLIST_ATIVIDADES_KEY, JSON.stringify(inicial));
  return inicial;
}

async function getRespostasStore(): Promise<Record<string, boolean>> {
  const raw = await AsyncStorage.getItem(CHECKLIST_RESPOSTAS_KEY);
  return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
}

async function getCampanhasStore(): Promise<Campanha[]> {
  const raw = await AsyncStorage.getItem(CAMPANHAS_KEY);
  if (!raw) return [];
  const campanhas = JSON.parse(raw) as Campanha[];
  // Normaliza aqui, na origem — campanha salva em AsyncStorage antes
  // do campo `kits` existir não tem essa chave no JSON guardado (o
  // parse cru simplesmente omite), e Campanha.kits não é opcional no
  // tipo. Um ponto só de conserto pra todo mundo que lê daqui, em vez
  // de espalhar `?? []` em cada tela que consome campanha. Mesma
  // lacuna pro `kit` de produto único (02/09/2026): campanha salva
  // antes de tipoPrecificacao/precoFixo existirem só tem
  // {quantidadeMinima, percentualDescontoItem} no JSON.
  return campanhas.map((c) => ({
    ...c,
    kits: c.kits ?? [],
    produtos: c.produtos.map((p) =>
      p.kit && !p.kit.tipoPrecificacao
        ? { ...p, kit: { ...p.kit, tipoPrecificacao: 'percentual' as const, precoFixo: null } }
        : p
    ),
  }));
}

async function salvarCampanhasStore(campanhas: Campanha[]): Promise<void> {
  await AsyncStorage.setItem(CAMPANHAS_KEY, JSON.stringify(campanhas));
}

async function getCampanhasVendaAdicionalStore(): Promise<CampanhaVendaAdicional[]> {
  const raw = await AsyncStorage.getItem(CAMPANHAS_VENDA_ADICIONAL_KEY);
  return raw ? (JSON.parse(raw) as CampanhaVendaAdicional[]) : [];
}

async function salvarCampanhasVendaAdicionalStore(campanhas: CampanhaVendaAdicional[]): Promise<void> {
  await AsyncStorage.setItem(CAMPANHAS_VENDA_ADICIONAL_KEY, JSON.stringify(campanhas));
}

async function getCampanhasComplementaresStore(): Promise<CampanhaComplementar[]> {
  const raw = await AsyncStorage.getItem(CAMPANHAS_COMPLEMENTARES_KEY);
  return raw ? (JSON.parse(raw) as CampanhaComplementar[]) : [];
}

async function salvarCampanhasComplementaresStore(campanhas: CampanhaComplementar[]): Promise<void> {
  await AsyncStorage.setItem(CAMPANHAS_COMPLEMENTARES_KEY, JSON.stringify(campanhas));
}

// Marcação mock: só a lista de itemIds marcados (sem timestamp/autoria
// — o dev mock não precisa disso, diferente do Supabase de verdade).
async function getItensComplementarMarcadosStore(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(VENDA_ITEM_COMPLEMENTAR_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

async function salvarItensComplementarMarcadosStore(itemIds: string[]): Promise<void> {
  await AsyncStorage.setItem(VENDA_ITEM_COMPLEMENTAR_KEY, JSON.stringify(itemIds));
}

// chave "codigoVendedor:data" -> quantidade de clientes ofertados.
async function getOfertaComplementarDiariaStore(): Promise<Record<string, number>> {
  const raw = await AsyncStorage.getItem(OFERTA_COMPLEMENTAR_DIARIA_KEY);
  return raw ? (JSON.parse(raw) as Record<string, number>) : {};
}

async function salvarOfertaComplementarDiariaStore(mapa: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(OFERTA_COMPLEMENTAR_DIARIA_KEY, JSON.stringify(mapa));
}

async function getContatosStore(): Promise<ContatoCliente[]> {
  const raw = await AsyncStorage.getItem(CONTATOS_CLIENTES_KEY);
  return raw ? (JSON.parse(raw) as ContatoCliente[]) : [];
}

async function getProdutosEmFaltaStore(): Promise<ProdutoEmFalta[]> {
  const raw = await AsyncStorage.getItem(PRODUTOS_EM_FALTA_KEY);
  return raw ? (JSON.parse(raw) as ProdutoEmFalta[]) : [];
}

async function salvarProdutosEmFaltaStore(itens: ProdutoEmFalta[]): Promise<void> {
  await AsyncStorage.setItem(PRODUTOS_EM_FALTA_KEY, JSON.stringify(itens));
}

async function getClassificacoesCompraStore(): Promise<ItemClassificacaoCompra[]> {
  const raw = await AsyncStorage.getItem(COMPRAS_CLASSIFICACOES_KEY);
  return raw ? (JSON.parse(raw) as ItemClassificacaoCompra[]) : [];
}

async function salvarClassificacoesCompraStore(itens: ItemClassificacaoCompra[]): Promise<void> {
  await AsyncStorage.setItem(COMPRAS_CLASSIFICACOES_KEY, JSON.stringify(itens));
}

async function getPendenciasStore(): Promise<Pendencia[]> {
  const raw = await AsyncStorage.getItem(PENDENCIAS_KEY);
  return raw ? (JSON.parse(raw) as Pendencia[]) : [];
}

async function salvarPendenciasStore(itens: Pendencia[]): Promise<void> {
  await AsyncStorage.setItem(PENDENCIAS_KEY, JSON.stringify(itens));
}

interface CarteiraClienteRaw {
  id: string;
  codigoVendedor: number;
  codigoCliente: number;
  criadoEm: string;
}

async function getCarteiraClientesStore(): Promise<CarteiraClienteRaw[]> {
  const raw = await AsyncStorage.getItem(CARTEIRA_CLIENTES_KEY);
  return raw ? (JSON.parse(raw) as CarteiraClienteRaw[]) : [];
}

async function salvarCarteiraClientesStore(itens: CarteiraClienteRaw[]): Promise<void> {
  await AsyncStorage.setItem(CARTEIRA_CLIENTES_KEY, JSON.stringify(itens));
}

class MockRepository implements DataRepository {
  async login(email: string, senha: string): Promise<Profile> {
    if (senha !== MOCK_PASSWORD) {
      throw new Error('E-mail ou senha inválidos.');
    }

    let profile: Profile;
    if (email.toLowerCase() === GESTOR_EMAIL) {
      profile = { id: 'gestor-1', tenantId: 'mock-tenant', nome: 'Gestor(a) da Farmácia', email, role: 'gestor', codigoVendedor: null };
    } else {
      const vendedor = vendedoresSeed.find((v) => v.email.toLowerCase() === email.toLowerCase());
      if (!vendedor) {
        throw new Error('E-mail ou senha inválidos.');
      }
      profile = { id: `vendedor-${vendedor.codigo}`, tenantId: 'mock-tenant', nome: vendedor.nome, email, role: 'vendedor', codigoVendedor: vendedor.codigo };
    }

    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(profile));
    return delay(profile);
  }

  async logout(): Promise<void> {
    await AsyncStorage.removeItem(SESSION_KEY);
  }

  async getSession(): Promise<Profile | null> {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  }

  // Push de verdade não existe em mock (não tem servidor pra mandar) —
  // no-op de propósito.
  async salvarPushToken(_profile: Profile, _token: string): Promise<void> {}

  async getDesempenhoVendedorDiario(profile: Profile, dataEmissao: string): Promise<DesempenhoVendedorDiario[]> {
    const fator = fatorVariacaoPorData(dataEmissao);
    const linhas = desempenhoSeedHoje.map((d) => {
      const quantidadeAtendimentos = Math.max(1, Math.round(d.quantidadeAtendimentos * fator));
      const quantidadeItens = Math.max(1, Math.round(d.quantidadeItens * fator));
      return {
        dataEmissao,
        codigoVendedor: d.codigoVendedor,
        nomeVendedor: nomeVendedor(d.codigoVendedor),
        quantidadeAtendimentos,
        quantidadeItens,
        itensPorAtendimento: round2(quantidadeItens / quantidadeAtendimentos),
      };
    });
    return delay(visivelParaPerfil(profile, linhas));
  }

  async getMetricasVendedorDiario(profile: Profile, dataEmissao: string): Promise<MetricasVendedorDiario[]> {
    return delay(visivelParaPerfil(profile, metricasDoDia(dataEmissao)));
  }

  // Mock aproximado: soma metricasSeedHoje ao longo dos dias já
  // decorridos do mês (ou o mês inteiro, se for um mês passado) — não
  // tem pretensão de ser fiel dia a dia, só de dar um número plausível
  // pro card "Desempenho do mês" enquanto o mock não é mais usado
  // (Frente 2/Supabase real já é o repositório ativo).
  async getDesempenhoVendedorMensal(profile: Profile, ano: number, mes: number): Promise<DesempenhoVendedorMensal[]> {
    const hoje = new Date();
    const ehMesCorrente = hoje.getFullYear() === ano && hoje.getMonth() + 1 === mes;
    const dias = ehMesCorrente ? hoje.getDate() : new Date(ano, mes, 0).getDate();
    const linhas = desempenhoSeedHoje.map((d) => {
      const quantidadeAtendimentos = Math.max(1, Math.round(d.quantidadeAtendimentos * dias));
      const quantidadeItens = Math.max(1, Math.round(d.quantidadeItens * dias));
      return {
        ano,
        mes,
        codigoVendedor: d.codigoVendedor,
        nomeVendedor: nomeVendedor(d.codigoVendedor),
        quantidadeAtendimentos,
        quantidadeItens,
        itensPorAtendimento: round2(quantidadeItens / quantidadeAtendimentos),
      };
    });
    return delay(visivelParaPerfil(profile, linhas));
  }

  async getMetricasVendedorMensal(profile: Profile, ano: number, mes: number): Promise<MetricasVendedorMensal[]> {
    const hoje = new Date();
    const ehMesCorrente = hoje.getFullYear() === ano && hoje.getMonth() + 1 === mes;
    const dias = ehMesCorrente ? hoje.getDate() : new Date(ano, mes, 0).getDate();
    const linhas = metricasSeedHoje.map((m) => {
      const qtdNotas = Math.max(1, Math.round(m.qtdNotas * dias));
      const faturamentoLiquido = round2(m.faturamentoLiquido * dias);
      const faturamentoBruto = round2(m.faturamentoBruto * dias);
      const totalDesconto = round2(m.totalDesconto * dias);
      const comissaoEstimada = round2(m.comissaoEstimada * dias);
      const totalCusto = round2(m.totalCusto * dias);
      return {
        ano,
        mes,
        codigoVendedor: m.codigoVendedor,
        nomeVendedor: nomeVendedor(m.codigoVendedor),
        qtdNotas,
        faturamentoLiquido,
        faturamentoBruto,
        totalDesconto,
        taxaDescontoPct: round2((totalDesconto / faturamentoBruto) * 100),
        comissaoEstimada,
        ticketMedio: round2(faturamentoLiquido / qtdNotas),
        totalCusto,
        margemBrutaPct: round2(((faturamentoLiquido - totalCusto) / faturamentoLiquido) * 100),
      };
    });
    return delay(visivelParaPerfil(profile, linhas));
  }

  // Seletor "Período" (calendário) do card "Desempenho" — mesma
  // simulação de dia/semana/mês (taxa diária do seed × nº de dias),
  // só que o intervalo vem direto das duas datas em vez de um bucket
  // fixo (11/08/2026).
  async getDesempenhoVendedorPeriodo(
    profile: Profile,
    dataInicio: string,
    dataFim: string
  ): Promise<DesempenhoVendedorPeriodo[]> {
    const dias = diasNoIntervalo(dataInicio, dataFim);
    const linhas = desempenhoSeedHoje.map((d) => {
      const quantidadeAtendimentos = Math.max(1, Math.round(d.quantidadeAtendimentos * dias));
      const quantidadeItens = Math.max(1, Math.round(d.quantidadeItens * dias));
      return {
        dataInicio,
        dataFim,
        codigoVendedor: d.codigoVendedor,
        nomeVendedor: nomeVendedor(d.codigoVendedor),
        quantidadeAtendimentos,
        quantidadeItens,
        itensPorAtendimento: round2(quantidadeItens / quantidadeAtendimentos),
      };
    });
    return delay(visivelParaPerfil(profile, linhas));
  }

  async getMetricasVendedorPeriodo(
    profile: Profile,
    dataInicio: string,
    dataFim: string
  ): Promise<MetricasVendedorPeriodo[]> {
    const dias = diasNoIntervalo(dataInicio, dataFim);
    const linhas = metricasSeedHoje.map((m) => {
      const qtdNotas = Math.max(1, Math.round(m.qtdNotas * dias));
      const faturamentoLiquido = round2(m.faturamentoLiquido * dias);
      const faturamentoBruto = round2(m.faturamentoBruto * dias);
      const totalDesconto = round2(m.totalDesconto * dias);
      const totalCusto = round2(m.totalCusto * dias);
      return {
        dataInicio,
        dataFim,
        codigoVendedor: m.codigoVendedor,
        nomeVendedor: nomeVendedor(m.codigoVendedor),
        qtdNotas,
        faturamentoLiquido,
        faturamentoBruto,
        totalDesconto,
        taxaDescontoPct: round2((totalDesconto / faturamentoBruto) * 100),
        ticketMedio: round2(faturamentoLiquido / qtdNotas),
        totalCusto,
        margemBrutaPct: round2(((faturamentoLiquido - totalCusto) / faturamentoLiquido) * 100),
      };
    });
    return delay(visivelParaPerfil(profile, linhas));
  }

  async getDesempenhoVendedorSemanal(
    profile: Profile,
    ano: number,
    mes: number,
    semana: 1 | 2 | 3 | 4
  ): Promise<DesempenhoVendedorSemanal[]> {
    const dias = diasDecorridosNaSemana(ano, mes, semana);
    const linhas = desempenhoSeedHoje.map((d) => {
      const quantidadeAtendimentos = Math.max(1, Math.round(d.quantidadeAtendimentos * dias));
      const quantidadeItens = Math.max(1, Math.round(d.quantidadeItens * dias));
      return {
        ano,
        mes,
        semana,
        codigoVendedor: d.codigoVendedor,
        nomeVendedor: nomeVendedor(d.codigoVendedor),
        quantidadeAtendimentos,
        quantidadeItens,
        itensPorAtendimento: round2(quantidadeItens / quantidadeAtendimentos),
      };
    });
    return delay(visivelParaPerfil(profile, linhas));
  }

  async getMetricasVendedorSemanal(
    profile: Profile,
    ano: number,
    mes: number,
    semana: 1 | 2 | 3 | 4
  ): Promise<MetricasVendedorSemanal[]> {
    const dias = diasDecorridosNaSemana(ano, mes, semana);
    const linhas = metricasSeedHoje.map((m) => {
      const qtdNotas = Math.max(1, Math.round(m.qtdNotas * dias));
      const faturamentoLiquido = round2(m.faturamentoLiquido * dias);
      const faturamentoBruto = round2(m.faturamentoBruto * dias);
      const totalDesconto = round2(m.totalDesconto * dias);
      const comissaoEstimada = round2(m.comissaoEstimada * dias);
      const totalCusto = round2(m.totalCusto * dias);
      return {
        ano,
        mes,
        semana,
        codigoVendedor: m.codigoVendedor,
        nomeVendedor: nomeVendedor(m.codigoVendedor),
        qtdNotas,
        faturamentoLiquido,
        faturamentoBruto,
        totalDesconto,
        taxaDescontoPct: round2((totalDesconto / faturamentoBruto) * 100),
        comissaoEstimada,
        ticketMedio: round2(faturamentoLiquido / qtdNotas),
        totalCusto,
        margemBrutaPct: round2(((faturamentoLiquido - totalCusto) / faturamentoLiquido) * 100),
      };
    });
    return delay(visivelParaPerfil(profile, linhas));
  }

  // Ranking é gamificação: mostra todo mundo, mesmo pra quem loga como
  // vendedor (decisão de produto — motivar competição só funciona se
  // todos veem o placar completo). Por isso NÃO usa visivelParaPerfil
  // aqui, ao contrário dos outros métodos deste repositório.
  async getRankingVendedoresDia(_profile: Profile, dataEmissao: string): Promise<RankingVendedorDia[]> {
    const ordenado = metricasDoDia(dataEmissao).sort((a, b) => b.faturamentoLiquido - a.faturamentoLiquido);
    const ranking = ordenado.map((m, index) => ({
      dataEmissao,
      codigoVendedor: m.codigoVendedor,
      nomeVendedor: m.nomeVendedor,
      faturamentoLiquido: m.faturamentoLiquido,
      posicao: index + 1,
    }));
    return delay(ranking);
  }

  async getClientesInatividade(profile: Profile): Promise<ClienteInatividade[]> {
    const hoje = new Date();
    // cliente que nunca comprou nada não entra aqui — essa lista é pra
    // gerar ação de RESGATE, não tem o que resgatar de quem nunca foi
    // cliente de fato (mesmo critério da vw_clientes_inatividade real).
    const linhas = clientesSeed
      .filter((c) => c.diasSemComprar != null)
      .map((c) => {
        const ultimaCompra = new Date(hoje.getTime() - c.diasSemComprar! * 86400000).toISOString().slice(0, 10);
        return {
          codigo: c.codigo,
          nome: c.nome,
          telefone: c.telefone,
          ultimaCompra,
          diasSemComprar: c.diasSemComprar,
          inativo: c.diasSemComprar! > 60,
          codigoVendedor: c.codigoVendedor,
          nomeVendedor: c.codigoVendedor != null ? nomeVendedor(c.codigoVendedor) : null,
        };
      });

    // gestor vê todos; vendedor só os clientes cuja última compra foi
    // com ele mesmo.
    const visivel = profile.role === 'gestor' ? linhas : linhas.filter((l) => l.codigoVendedor === profile.codigoVendedor);

    return delay(visivel);
  }

  async getResumoClientesInatividade(profile: Profile): Promise<ResumoClientesInatividade> {
    const linhas = await this.getClientesInatividade(profile);
    return { total: linhas.length, inativos: linhas.filter((l) => l.inativo).length };
  }

  async getClientesDoVendedor(profile: Profile): Promise<ClienteDoVendedor[]> {
    if (profile.codigoVendedor == null) return delay([]);
    const doVendedor = vendaItensDetalheSeed.filter((v) => v.codigoVendedor === profile.codigoVendedor);
    const porCliente = new Map<number, { valorTotal: number; ultimaCompra: string }>();
    for (const item of doVendedor) {
      const produto = produtosSeed.find((p) => p.codigo === item.codigoProduto);
      const valor = (produto?.precoAtual ?? 0) * item.quantidade;
      const data = dataDiasAtras(item.diasAtras);
      const atual = porCliente.get(item.codigoCliente);
      porCliente.set(item.codigoCliente, {
        valorTotal: round2((atual?.valorTotal ?? 0) + valor),
        ultimaCompra: atual && atual.ultimaCompra > data ? atual.ultimaCompra : data,
      });
    }
    const linhas = Array.from(porCliente.entries())
      .map(([codigo, agregado]) => ({
        codigo,
        nome: nomeCliente(codigo),
        telefone: telefoneCliente(codigo),
        email: null,
        dataNascimento: null,
        ...agregado,
      }))
      .sort((a, b) => b.ultimaCompra.localeCompare(a.ultimaCompra));
    return delay(linhas);
  }

  async getClientesValorGeral(_profile: Profile): Promise<ClienteDoVendedor[]> {
    // Mesma conta de getClientesDoVendedor, mas somando QUALQUER
    // vendedor (sem filtrar vendaItensDetalheSeed por codigoVendedor).
    const porCliente = new Map<number, { valorTotal: number; ultimaCompra: string }>();
    for (const item of vendaItensDetalheSeed) {
      const produto = produtosSeed.find((p) => p.codigo === item.codigoProduto);
      const valor = (produto?.precoAtual ?? 0) * item.quantidade;
      const data = dataDiasAtras(item.diasAtras);
      const atual = porCliente.get(item.codigoCliente);
      porCliente.set(item.codigoCliente, {
        valorTotal: round2((atual?.valorTotal ?? 0) + valor),
        ultimaCompra: atual && atual.ultimaCompra > data ? atual.ultimaCompra : data,
      });
    }
    const linhas = Array.from(porCliente.entries())
      .map(([codigo, agregado]) => ({
        codigo,
        nome: nomeCliente(codigo),
        telefone: telefoneCliente(codigo),
        email: null,
        dataNascimento: null,
        ...agregado,
      }))
      .sort((a, b) => b.ultimaCompra.localeCompare(a.ultimaCompra));
    return delay(linhas);
  }

  async getHistoricoComprasCliente(_profile: Profile, codigoCliente: number, limite = 5): Promise<HistoricoCompraCliente[]> {
    const linhas = vendaItensDetalheSeed
      .filter((v) => v.codigoCliente === codigoCliente)
      .map((item, indice) => {
        const produto = produtosSeed.find((p) => p.codigo === item.codigoProduto);
        return {
          itemId: indice + 1,
          vendaId: indice + 1,
          dataEmissao: dataDiasAtras(item.diasAtras),
          codigoProduto: item.codigoProduto,
          nomeProduto: produto?.nome ?? `Produto ${item.codigoProduto}`,
          quantidade: item.quantidade,
          valorTotal: round2((produto?.precoAtual ?? 0) * item.quantidade),
          codigoVendedor: item.codigoVendedor,
          nomeVendedor: nomeVendedor(item.codigoVendedor),
        };
      })
      .sort((a, b) => b.dataEmissao.localeCompare(a.dataEmissao))
      .slice(0, limite);
    return delay(linhas);
  }

  async getProdutosRecorrentesDoVendedor(profile: Profile): Promise<ProdutoRecorrenteCliente[]> {
    if (profile.codigoVendedor == null) return delay([]);
    const doVendedor = vendaItensDetalheSeed.filter((v) => v.codigoVendedor === profile.codigoVendedor);
    return delay(agregarProdutosRecorrentes(doVendedor));
  }

  async getProdutosRecorrentesClientes(_profile: Profile): Promise<ProdutoRecorrenteCliente[]> {
    return delay(agregarProdutosRecorrentes(vendaItensDetalheSeed));
  }

  async getProdutosEmPromocao(_profile: Profile): Promise<ProdutoPromocaoAlerta[]> {
    const alertas = produtosSeed
      .filter((p) => p.emPromocao)
      .map((produto) => {
        const compras = vendaItensDetalheSeed.filter((v) => v.codigoProduto === produto.codigo);

        const porCliente = new Map<number, ClienteCompradorPromocao>();
        for (const compra of compras) {
          const dataCompra = dataDiasAtras(compra.diasAtras);
          const existente = porCliente.get(compra.codigoCliente);
          if (!existente || dataCompra > existente.ultimaCompraProduto) {
            porCliente.set(compra.codigoCliente, {
              codigoCliente: compra.codigoCliente,
              nomeCliente: nomeCliente(compra.codigoCliente),
              telefone: telefoneCliente(compra.codigoCliente),
              ultimaCompraProduto: dataCompra,
              quantidade: compra.quantidade,
            });
          }
        }

        const clientes = Array.from(porCliente.values()).sort((a, b) =>
          b.ultimaCompraProduto.localeCompare(a.ultimaCompraProduto)
        );

        // Mock não rastreia quando a promoção começou (sem updated_at/
        // campanha simulados aqui) — usa a soma de tudo no seed como
        // aproximação razoável, mesmo espírito de "vendido na ação".
        const quantidadeVendidaAcao = compras.reduce((soma, c) => soma + c.quantidade, 0);

        return { produto, clientes, quantidadeVendidaAcao };
      })
      .sort((a, b) => (b.produto.percentualDesconto ?? 0) - (a.produto.percentualDesconto ?? 0));

    return delay(alertas);
  }

  async getVendasComReceita(profile: Profile): Promise<VendaReceitaPendente[]> {
    const overrides = await getReceitasOverrides();

    const produtosComReceita = new Set(produtosSeed.filter((p) => p.exigeReceita).map((p) => p.codigo));
    const linhas = vendaItensDetalheSeed
      .filter((v) => produtosComReceita.has(v.codigoProduto))
      .map((v) => {
        const produto = produtosSeed.find((p) => p.codigo === v.codigoProduto)!;
        const override = overrides[v.id];
        const anexadaSeed = v.receitaAnexadaSeed ?? false;

        const receitaAnexada = override?.receitaAnexada ?? anexadaSeed;
        const receitaDataAnexo =
          override?.receitaDataAnexo ?? (anexadaSeed ? dataDiasAtras(Math.max(v.diasAtras - 1, 0)) : null);
        const receitaFotoUri = override?.receitaFotoUri ?? null;

        return {
          itemId: v.id,
          dataVenda: dataDiasAtras(v.diasAtras),
          codigoProduto: v.codigoProduto,
          nomeProduto: produto.nome,
          tipoReceita: produto.tipoReceita as TipoReceita,
          codigoCliente: v.codigoCliente,
          nomeCliente: nomeCliente(v.codigoCliente),
          codigoVendedor: v.codigoVendedor,
          nomeVendedor: nomeVendedor(v.codigoVendedor),
          receitaAnexada,
          receitaDataAnexo,
          receitaFotoUri,
        };
      });

    const visivel = visivelParaPerfil(profile, linhas);
    // pendentes primeiro, mais recentes primeiro
    visivel.sort((a, b) => {
      if (a.receitaAnexada !== b.receitaAnexada) return a.receitaAnexada ? 1 : -1;
      return b.dataVenda.localeCompare(a.dataVenda);
    });

    return delay(visivel);
  }

  // Sem visivelParaPerfil de propósito — mesma lógica de
  // getProdutosEmPromocao, é oportunidade de contato pra qualquer
  // vendedor, não fila pessoal (ver comentário em repository.ts).
  async getVendasAntimicrobianoRecente(_profile: Profile): Promise<VendaAntimicrobianoRecente[]> {
    const linhas: VendaAntimicrobianoRecente[] = vendaItensDetalheSeed
      .filter((v) => {
        const produto = produtosSeed.find((p) => p.codigo === v.codigoProduto);
        return produto?.tipoReceita === 'antimicrobiano';
      })
      .map((v) => ({
        itemId: v.id,
        dataVenda: dataDiasAtras(v.diasAtras),
        codigoProduto: v.codigoProduto,
        nomeProduto: produtosSeed.find((p) => p.codigo === v.codigoProduto)!.nome,
        codigoCliente: v.codigoCliente,
        nomeCliente: nomeCliente(v.codigoCliente),
      }));

    return delay(linhas);
  }

  async getIdentificacaoCompradorPorVendedor(profile: Profile): Promise<IdentificacaoCompradorVendedor[]> {
    const produtosComReceita = new Set(produtosSeed.filter((p) => p.exigeReceita).map((p) => p.codigo));
    const porVendedor = new Map<
      number,
      { nome: string; total: number; semIdentificacao: number; totalControlado: number; semIdentificacaoControlado: number }
    >();

    for (const v of vendaItensDetalheSeed) {
      const atual = porVendedor.get(v.codigoVendedor) ?? {
        nome: nomeVendedor(v.codigoVendedor),
        total: 0,
        semIdentificacao: 0,
        totalControlado: 0,
        semIdentificacaoControlado: 0,
      };
      atual.total += 1;
      if (v.codigoCliente == null) atual.semIdentificacao += 1;
      if (produtosComReceita.has(v.codigoProduto)) {
        atual.totalControlado += 1;
        if (v.codigoCliente == null) atual.semIdentificacaoControlado += 1;
      }
      porVendedor.set(v.codigoVendedor, atual);
    }

    const linhas: IdentificacaoCompradorVendedor[] = Array.from(porVendedor.entries()).map(([codigoVendedor, v]) => ({
      codigoVendedor,
      nomeVendedor: v.nome,
      totalVendas: v.total,
      vendasSemIdentificacao: v.semIdentificacao,
      percentualSemIdentificacao: v.total > 0 ? Math.round((v.semIdentificacao / v.total) * 1000) / 10 : 0,
      totalVendasControladas: v.totalControlado,
      vendasControladasSemIdentificacao: v.semIdentificacaoControlado,
      percentualControladasSemIdentificacao:
        v.totalControlado > 0 ? Math.round((v.semIdentificacaoControlado / v.totalControlado) * 1000) / 10 : 0,
      // seed não modela CPF de vendedor/cliente — sem base pra simular
      // "próprio CPF" no mock (mesma limitação de `motivo`, sempre
      // 'sem_cliente' em getVendasSemIdentificacaoComprador abaixo).
      vendasProprioCpf: 0,
      percentualProprioCpf: 0,
    }));

    const visivel = visivelParaPerfil(profile, linhas);
    visivel.sort((a, b) => b.percentualSemIdentificacao - a.percentualSemIdentificacao);
    return delay(visivel);
  }

  async getVendasSemIdentificacaoComprador(
    profile: Profile,
    codigoVendedor: number
  ): Promise<VendaSemIdentificacaoComprador[]> {
    const podeVer = profile.role === 'gestor' || profile.codigoVendedor === codigoVendedor;
    if (!podeVer) return delay([]);

    const produtosComReceita = new Set(produtosSeed.filter((p) => p.exigeReceita).map((p) => p.codigo));
    const linhas: VendaSemIdentificacaoComprador[] = vendaItensDetalheSeed
      .filter((v) => v.codigoVendedor === codigoVendedor && v.codigoCliente == null)
      .map((v) => {
        const produto = produtosSeed.find((p) => p.codigo === v.codigoProduto);
        return {
          itemId: v.id,
          dataVenda: dataDiasAtras(v.diasAtras),
          horaVenda: null,
          numeroNota: Number(v.id) || 0,
          nomeProduto: produto?.nome ?? `Produto ${v.codigoProduto}`,
          motivo: 'sem_cliente' as const,
          controlado: produtosComReceita.has(v.codigoProduto),
        };
      });

    return delay(linhas);
  }

  async getContatosRecentes(_profile: Profile): Promise<ContatoCliente[]> {
    return delay(await getContatosStore());
  }

  async registrarContato(_profile: Profile, input: RegistrarContatoInput): Promise<void> {
    const contatos = await getContatosStore();
    contatos.push({
      codigoCliente: input.codigoCliente,
      motivo: input.motivo,
      codigoProduto: input.codigoProduto ?? null,
      contatadoEm: new Date().toISOString(),
    });
    await AsyncStorage.setItem(CONTATOS_CLIENTES_KEY, JSON.stringify(contatos));
  }

  async anexarReceita(itemId: string, info: { tipo: TipoReceita; fotoUri: string | null }): Promise<void> {
    const overrides = await getReceitasOverrides();
    overrides[itemId] = {
      receitaAnexada: true,
      receitaDataAnexo: new Date().toISOString(),
      receitaFotoUri: info.fotoUri,
    };
    await AsyncStorage.setItem(RECEITAS_OVERRIDES_KEY, JSON.stringify(overrides));
  }

  async getMetas(profile: Profile, ano: number, mes: number): Promise<MetaVendedor[]> {
    const overrides = await getMetasOverrides();
    const hoje = new Date();
    const ehMesCorrente = hoje.getFullYear() === ano && hoje.getMonth() + 1 === mes;
    const semanaAtual = semanaDoDia(hoje.getDate());

    const linhas: (MetaVendedor & { codigoVendedor: number })[] = metasSeedPadrao.map((padrao) => {
      const override = overrides[`${padrao.codigoVendedor}-${ano}-${mes}`];
      const valorMetaMensal = override?.valorMetaMensal ?? padrao.valorMetaMensal;
      const valoresMetaSemanal = override?.valoresMetaSemanal ?? padrao.valoresMetaSemanal;
      const realizado = realizadoSeedPadrao.find((r) => r.codigoVendedor === padrao.codigoVendedor);

      const semanas: MetaSemana[] = ([1, 2, 3, 4] as const).map((semana) => {
        // só mostra realizado das semanas já decorridas do mês corrente;
        // meses passados/futuros no seletor do gestor não têm "realizado" mockado.
        const semanaJaOcorreu = ehMesCorrente && semana <= semanaAtual;
        return {
          semana,
          rotulo: rotuloSemana(semana, ano, mes),
          valorMeta: valoresMetaSemanal[semana - 1],
          valorRealizado: semanaJaOcorreu ? realizado?.realizadoSemanal[semana - 1] ?? 0 : 0,
        };
      });

      const valorRealizadoMensal = semanas.reduce((acc, s) => acc + s.valorRealizado, 0);

      return {
        codigoVendedor: padrao.codigoVendedor,
        nomeVendedor: nomeVendedor(padrao.codigoVendedor),
        ano,
        mes,
        valorMetaMensal,
        valorRealizadoMensal,
        semanas,
      };
    });

    return delay(visivelParaPerfil(profile, linhas));
  }

  async salvarMeta(_profile: Profile, input: SalvarMetaInput): Promise<void> {
    const overrides = await getMetasOverrides();
    overrides[`${input.codigoVendedor}-${input.ano}-${input.mes}`] = {
      valorMetaMensal: input.valorMetaMensal,
      valoresMetaSemanal: input.valoresMetaSemanal,
    };
    await AsyncStorage.setItem(METAS_OVERRIDES_KEY, JSON.stringify(overrides));
  }

  async getVendedoresAtivos(_profile: Profile): Promise<VendedorAtivo[]> {
    return delay(
      vendedoresSeed
        .map((v) => ({ codigo: v.codigo, nome: v.nome }))
        .sort((a, b) => a.nome.localeCompare(b.nome))
    );
  }

  async getComissoesMensal(profile: Profile, ano: number, mes: number): Promise<ComissaoMensal[]> {
    // Reaproveita getMetas (já filtra por perfil: vendedor só a própria
    // linha, gestor todas) — mesma regra de visibilidade de vw_metas_comissao.
    const metas = await this.getMetas(profile, ano, mes);

    const faixaPara = (percentual: number): FaixaComissao =>
      faixasComissaoSeed
        .filter((f) => f.percentualMetaMin <= percentual)
        .sort((a, b) => b.percentualMetaMin - a.percentualMetaMin)[0]
        ?? faixasComissaoSeed[faixasComissaoSeed.length - 1];

    const comissoes: ComissaoMensal[] = metas.map((meta) => {
      // valorRealizadoMensal/valorRealizado de semana JÁ são margem bruta
      // (vw_metas_progresso troca faturamento por margem) — mock espelha
      // a mesma unidade, sem proxy de %.
      const margemBrutaValor = meta.valorRealizadoMensal;
      const percentualAtingido = meta.valorMetaMensal > 0
        ? (meta.valorRealizadoMensal / meta.valorMetaMensal) * 100
        : 0;

      const bateuMeta = meta.valorMetaMensal > 0 && meta.valorRealizadoMensal >= meta.valorMetaMensal;

      let comissaoValor: number;
      let regraAplicada: ComissaoMensal['regraAplicada'];
      let detalheSemanas: ComissaoMensal['detalheSemanas'];

      if (bateuMeta) {
        comissaoValor = Math.round(margemBrutaValor * 0.10 * 100) / 100;
        regraAplicada = 'flat_10_mensal';
        detalheSemanas = null;
      } else {
        const semanas = meta.semanas.map((s) => {
          const percentual = s.valorMeta > 0 ? (s.valorRealizado / s.valorMeta) * 100 : 0;
          const taxa = faixaPara(percentual).percentualComissao;
          const comissao = Math.round(s.valorRealizado * (taxa / 100) * 100) / 100;
          return { semana: s.semana, margem: s.valorRealizado, meta: s.valorMeta, percentual: Math.round(percentual * 100) / 100, taxa, comissao };
        });
        comissaoValor = Math.round(semanas.reduce((sum, s) => sum + s.comissao, 0) * 100) / 100;
        regraAplicada = 'soma_semanal';
        detalheSemanas = semanas;
      }

      // Mock não tem workflow n8n escrevendo o ratchet de verdade —
      // aproxima pela faixa "se fechasse agora" (mesma lógica de
      // vw_faixa_comissao_atual), sem guardar o piso de 3% como
      // "alcançada".
      const faixaAtual = faixaPara(percentualAtingido).percentualComissao;

      return {
        codigoVendedor: meta.codigoVendedor,
        nomeVendedor: meta.nomeVendedor,
        ano,
        mes,
        valorMeta: meta.valorMetaMensal,
        valorRealizado: meta.valorRealizadoMensal,
        percentualAtingido: Math.round(percentualAtingido * 100) / 100,
        margemBrutaValor: Math.round(margemBrutaValor * 100) / 100,
        percentualComissao: margemBrutaValor > 0 ? Math.round((comissaoValor / margemBrutaValor) * 10000) / 100 : 0,
        comissaoValor,
        regraAplicada,
        detalheSemanas,
        faixaAlcancada: faixaAtual > 3 ? faixaAtual : null,
      };
    });

    return delay(comissoes);
  }

  async getFaixasComissao(): Promise<FaixaComissao[]> {
    return delay(faixasComissaoSeed);
  }

  async getAtividadesChecklist(profile: Profile): Promise<AtividadeChecklist[]> {
    const atividades = await getAtividadesStore();
    if (profile.role === 'gestor') return delay(atividades);
    return delay(atividades.filter((a) => a.ativo));
  }

  async salvarAtividadeChecklist(_profile: Profile, input: {
    id?: string;
    titulo: string;
    horario: string | null;
    codigosVendedor: number[];
    diasSemana: number[];
  }): Promise<void> {
    const atividades = await getAtividadesStore();
    const nomes = input.codigosVendedor.map((codigo) => nomeVendedor(codigo));
    if (input.id) {
      const existente = atividades.find((a) => a.id === input.id);
      if (existente) {
        existente.titulo = input.titulo;
        existente.horario = input.horario;
        existente.codigosVendedor = input.codigosVendedor;
        existente.nomesVendedores = nomes;
        existente.diasSemana = input.diasSemana;
      }
    } else {
      atividades.push({
        id: `chk-${Date.now()}`,
        titulo: input.titulo,
        horario: input.horario,
        ativo: true,
        codigosVendedor: input.codigosVendedor,
        nomesVendedores: nomes,
        diasSemana: input.diasSemana,
      });
    }
    await AsyncStorage.setItem(CHECKLIST_ATIVIDADES_KEY, JSON.stringify(atividades));
  }

  async alternarAtividadeChecklist(id: string, ativo: boolean): Promise<void> {
    const atividades = await getAtividadesStore();
    const existente = atividades.find((a) => a.id === id);
    if (existente) existente.ativo = ativo;
    await AsyncStorage.setItem(CHECKLIST_ATIVIDADES_KEY, JSON.stringify(atividades));
  }

  async excluirAtividadeChecklist(id: string): Promise<void> {
    const atividades = (await getAtividadesStore()).filter((a) => a.id !== id);
    await AsyncStorage.setItem(CHECKLIST_ATIVIDADES_KEY, JSON.stringify(atividades));
  }

  async getChecklistHoje(profile: Profile): Promise<ChecklistItemStatus[]> {
    // domingo=1 ... sábado=7 — mesma numeração de diasSemana.
    const diaDaSemanaHoje = new Date().getDay() + 1;
    const atividades = (await getAtividadesStore()).filter(
      (a) =>
        a.ativo &&
        (a.codigosVendedor.length === 0 || a.codigosVendedor.includes(profile.codigoVendedor ?? -1)) &&
        a.diasSemana.includes(diaDaSemanaHoje)
    );
    const respostas = await getRespostasStore();
    const hojeIso = new Date().toISOString().slice(0, 10);

    return delay(
      atividades.map((atividade) => ({
        atividade,
        concluida: respostas[`${profile.codigoVendedor}-${hojeIso}-${atividade.id}`] ?? false,
      }))
    );
  }

  async marcarChecklistItem(profile: Profile, atividadeId: string, concluida: boolean): Promise<void> {
    const respostas = await getRespostasStore();
    const hojeIso = new Date().toISOString().slice(0, 10);
    respostas[`${profile.codigoVendedor}-${hojeIso}-${atividadeId}`] = concluida;
    await AsyncStorage.setItem(CHECKLIST_RESPOSTAS_KEY, JSON.stringify(respostas));
  }

  async getStatusSincronizacao(): Promise<StatusSincronizacao[]> {
    const agora = Date.now();
    const linhas = syncControlSeed.map((s) => ({
      entityName: s.entityName,
      ultimaSincronizacao: new Date(agora - s.minutosAtras * 60_000).toISOString(),
    }));
    return delay(linhas);
  }

  async getStatusWhatsApp(_profile: Profile): Promise<Record<number, boolean>> {
    // Mock não tem checagem real contra a Evolution API — devolve vazio,
    // o app cai pro fallback de validar só o formato do telefone.
    return delay({});
  }

  async getCatalogoProdutos(_profile: Profile): Promise<ProdutoCatalogo[]> {
    return delay(catalogoProdutosSeed);
  }

  async sugerirProdutosCampanha(_profile: Profile, params: SugestaoCampanhaParams): Promise<ProdutoElegibilidade[]> {
    const vendaRecentePorProduto = new Map(
      vendaRecenteSeed.map((v) => [v.codigoProduto, { quantidadeVendida30d: v.quantidadeVendida30d, diasSemVenda: v.diasSemVenda }])
    );

    // evita sugerir de novo produto que já está em campanha nossa
    // ativa/futura — não faz sentido empilhar desconto no mesmo item.
    const campanhas = await getCampanhasStore();
    const hojeIso = new Date().toISOString().slice(0, 10);
    const codigosEmCampanhaAtiva = new Set(
      campanhas.filter((c) => c.dataFim >= hojeIso).flatMap((c) => c.produtos.map((p) => p.codigoProduto))
    );

    const sugestoes = sugerirCandidatos(catalogoProdutosSeed, vendaRecentePorProduto, params, codigosEmCampanhaAtiva);
    return delay(sugestoes);
  }

  // Mock não tem venda com granularidade de venda_id (só agregado por
  // produto em vendaRecenteSeed), então não dá pra simular afinidade
  // de compra de verdade — nem dá pra usar macroGrupoDoProduto aqui
  // (catalogoProdutosSeed não popula `grupo`, só `categoria`, campo
  // que esse mock usa de verdade). Fabrica pares determinísticos: dois
  // produtos da MESMA categoria formam um par sugerido, com
  // coOcorrencias/lift derivados das quantidades já existentes no
  // seed (não é uma análise real, só dá pra tela ter o que mostrar em
  // dev). `params.macroGrupo` é ignorado de propósito.
  async sugerirParesAfinidade(_profile: Profile, _params: SugestaoKitsParams): Promise<SugestaoParAfinidade[]> {
    const vendaPorCodigo = new Map(vendaRecenteSeed.map((v) => [v.codigoProduto, v.quantidadeVendida30d]));
    const porCategoria = new Map<string, ProdutoCatalogo[]>();
    for (const produto of catalogoProdutosSeed) {
      const lista = porCategoria.get(produto.categoria) ?? [];
      lista.push(produto);
      porCategoria.set(produto.categoria, lista);
    }

    const sugestoes: SugestaoParAfinidade[] = [];
    for (const produtos of porCategoria.values()) {
      for (let i = 0; i < produtos.length; i++) {
        for (let j = i + 1; j < produtos.length; j++) {
          const seed = produtos[i];
          const parceiro = produtos[j];
          const vendasSeed = vendaPorCodigo.get(seed.codigo) ?? 0;
          const vendasParceiro = vendaPorCodigo.get(parceiro.codigo) ?? 0;
          const coOcorrencias = Math.round(Math.min(vendasSeed, vendasParceiro) * 0.4);
          if (coOcorrencias < 3) continue;
          sugestoes.push({
            codigoProdutoSeed: seed.codigo,
            nomeProdutoSeed: seed.nome,
            precoRegularSeed: seed.precoVenda,
            custoMedioSeed: seed.custoMedio,
            codigoProdutoParceiro: parceiro.codigo,
            nomeProdutoParceiro: parceiro.nome,
            precoRegularParceiro: parceiro.precoVenda,
            custoMedioParceiro: parceiro.custoMedio,
            coOcorrencias,
            vendasSeed,
            vendasParceiro,
            lift: 1.5,
          });
        }
      }
    }
    return delay(sugestoes.sort((a, b) => b.coOcorrencias - a.coOcorrencias));
  }

  async getCampanhas(_profile: Profile): Promise<Campanha[]> {
    const campanhas = await getCampanhasStore();
    return delay([...campanhas].sort((a, b) => b.criadaEm.localeCompare(a.criadaEm)));
  }

  async getCampanha(_profile: Profile, id: string): Promise<Campanha | null> {
    const campanhas = await getCampanhasStore();
    return delay(campanhas.find((c) => c.id === id) ?? null);
  }

  async salvarCampanha(_profile: Profile, input: SalvarCampanhaInput): Promise<Campanha> {
    const campanhas = await getCampanhasStore();
    let salva: Campanha;

    if (input.id) {
      const existente = campanhas.find((c) => c.id === input.id);
      if (!existente) throw new Error('Campanha não encontrada.');
      existente.nome = input.nome;
      existente.dataInicio = input.dataInicio;
      existente.dataFim = input.dataFim;
      existente.produtos = input.produtos;
      existente.kits = input.kits;
      salva = existente;
    } else {
      salva = {
        id: `camp-${Date.now()}`,
        nome: input.nome,
        dataInicio: input.dataInicio,
        dataFim: input.dataFim,
        criadaEm: new Date().toISOString(),
        // Mock não simula venda real contra campanha — sempre zero,
        // igual a uma campanha recém-criada de verdade.
        quantidadeVendida: 0,
        valorVendido: 0,
        produtos: input.produtos,
        kits: input.kits,
      };
      campanhas.push(salva);
    }

    await salvarCampanhasStore(campanhas);
    return delay(salva);
  }

  async gerarSugestaoCompras(_profile: Profile, params: ParametrosCompra): Promise<SugestaoCompra[]> {
    const demandaPorProduto = new Map(
      vendaRecenteSeed.map((v) => [v.codigoProduto, { quantidadeVendidaPeriodo: v.quantidadeVendida30d }])
    );
    const fornecedoresPorCodigo = new Map(fornecedoresSeed.map((f) => [f.codigo, f.nomeFantasia]));
    const fornecedorPorProduto = new Map(
      compraInfoSeed.map((c) => [
        c.codigoProduto,
        { fatorCompra: c.fatorCompra, nomeFornecedor: fornecedoresPorCodigo.get(c.codigoFornecedor) ?? null },
      ])
    );

    // seed não tem histórico de compra por mais de um fornecedor por
    // produto — sem base pra simular "mais barato" no mock.
    const fornecedorMaisBaratoPorProduto = new Map<number, { nomeFornecedor: string; precoCusto: number }>();
    const sugestoes = calcularSugestaoCompras(
      catalogoProdutosSeed,
      demandaPorProduto,
      fornecedorPorProduto,
      fornecedorMaisBaratoPorProduto,
      params
    );

    const classificados = new Set((await getClassificacoesCompraStore()).map((c) => c.codigoProduto));
    return delay(sugestoes.filter((s) => !classificados.has(s.codigoProduto)));
  }

  async classificarItensCompra(
    _profile: Profile,
    codigosProduto: number[],
    motivo: MotivoClassificacaoCompra,
    observacao?: string
  ): Promise<void> {
    const atuais = await getClassificacoesCompraStore();
    const semOsNovos = atuais.filter((c) => !codigosProduto.includes(c.codigoProduto));
    const novos: ItemClassificacaoCompra[] = codigosProduto.map((codigo) => ({
      id: `${codigo}-${Date.now()}`,
      codigoProduto: codigo,
      nomeProduto: catalogoProdutosSeed.find((p) => p.codigo === codigo)?.nome ?? `Produto ${codigo}`,
      motivo,
      observacao: observacao ?? null,
      classificadoEm: new Date().toISOString(),
      nomeClassificadoPor: 'Gestor(a) da Farmácia',
    }));
    await salvarClassificacoesCompraStore([...semOsNovos, ...novos]);
  }

  async getClassificacoesCompra(_profile: Profile): Promise<ItemClassificacaoCompra[]> {
    const itens = await getClassificacoesCompraStore();
    return delay([...itens].sort((a, b) => b.classificadoEm.localeCompare(a.classificadoEm)));
  }

  async removerClassificacaoCompra(codigoProduto: number): Promise<void> {
    const itens = await getClassificacoesCompraStore();
    await salvarClassificacoesCompraStore(itens.filter((i) => i.codigoProduto !== codigoProduto));
  }

  async getEstoqueZeradoGiroAlto(_profile: Profile): Promise<ItemEstoqueZeradoGiroAlto[]> {
    const vendaPorProduto = new Map(
      vendaRecenteSeed.map((v) => [v.codigoProduto, { quantidadeVendida30d: v.quantidadeVendida30d, diasSemVenda: v.diasSemVenda }])
    );
    const classificados = new Set((await getClassificacoesCompraStore()).map((c) => c.codigoProduto));
    const itens = calcularEstoqueZeradoGiroAlto(catalogoProdutosSeed, vendaPorProduto).filter(
      (item) => !classificados.has(item.codigoProduto)
    );
    return delay(itens);
  }

  async getRelatorioPrecificacao(_profile: Profile): Promise<ItemPrecificacao[]> {
    const vendaPorProduto = new Map(
      vendaRecenteSeed.map((v) => [v.codigoProduto, { quantidadeVendida30d: v.quantidadeVendida30d, diasSemVenda: v.diasSemVenda }])
    );

    // mesmo critério de "desconto ativo" usado em sugerirProdutosCampanha
    // — produto já em campanha ativa/futura não é candidato a reajuste.
    const campanhas = await getCampanhasStore();
    const hojeIso = new Date().toISOString().slice(0, 10);
    const codigosComDescontoAtivo = new Set(
      campanhas.filter((c) => c.dataFim >= hojeIso).flatMap((c) => c.produtos.map((p) => p.codigoProduto))
    );

    // estoque_atual > 0: produto zerado não é candidato a reajuste de
    // preço — mesmo critério da versão Supabase.
    const catalogoComEstoque = catalogoProdutosSeed.filter((p) => p.estoqueAtual > 0);
    const relatorio = calcularRelatorioPrecificacao(catalogoComEstoque, vendaPorProduto, codigosComDescontoAtivo);
    return delay(relatorio);
  }

  async getMetricasMensais(_profile: Profile, mesReferencia: string, _ateData?: string): Promise<MetricaMensal[]> {
    // Mock não tem fechamento mensal de verdade (isso é feito pelo
    // workflow n8n na conta real, direto em SQL sobre as tabelas
    // cruas) — aqui só aproxima o mês ATUAL a partir dos stores já
    // existentes, o suficiente pra testar a tela. Qualquer outro mês
    // volta vazio. Envios de WhatsApp/ligação ficam de fora da
    // aproximação: ContatoCliente (tipo devolvido por
    // getContatosRecentes) não carrega tipoContato/codigoVendedor —
    // só a tabela real tem essas colunas, e o mock guarda no mesmo
    // formato enxuto.
    const mesAtual = new Date().toISOString().slice(0, 7);
    if (!mesReferencia.startsWith(mesAtual)) return delay([]);

    const [produtosEmFalta, pendencias, carteira] = await Promise.all([
      getProdutosEmFaltaStore(),
      getPendenciasStore(),
      getCarteiraClientesStore(),
    ]);

    const metricas: MetricaMensal[] = [
      {
        mesReferencia,
        codigoVendedor: null,
        chave: 'produtos_em_falta_reportados',
        valor: produtosEmFalta.filter((p) => p.data.startsWith(mesAtual)).length,
      },
      {
        mesReferencia,
        codigoVendedor: null,
        chave: 'pendencias_dadas_baixa',
        valor: pendencias.filter((p) => p.baixadaEm?.startsWith(mesAtual)).length,
      },
    ];

    for (const v of vendedoresSeed) {
      const totalCarteira = carteira.filter((c) => c.codigoVendedor === v.codigo).length;
      if (totalCarteira > 0) {
        metricas.push({ mesReferencia, codigoVendedor: v.codigo, chave: 'carteira_clientes_total', valor: totalCarteira });
      }
    }

    return delay(metricas);
  }

  async excluirCampanha(id: string): Promise<void> {
    const campanhas = await getCampanhasStore();
    await salvarCampanhasStore(campanhas.filter((c) => c.id !== id));
  }

  async getCampanhasVendaAdicional(_profile: Profile): Promise<CampanhaVendaAdicional[]> {
    const campanhas = await getCampanhasVendaAdicionalStore();
    return delay([...campanhas].sort((a, b) => b.dataInicio.localeCompare(a.dataInicio)));
  }

  async salvarCampanhaVendaAdicional(_profile: Profile, input: SalvarCampanhaVendaAdicionalInput): Promise<void> {
    const campanhas = await getCampanhasVendaAdicionalStore();
    const produtos = input.codigosProduto.map((codigoProduto) => ({
      codigoProduto,
      nomeProduto: catalogoProdutosSeed.find((p) => p.codigo === codigoProduto)?.nome ?? `Produto ${codigoProduto}`,
    }));

    if (input.id) {
      const existente = campanhas.find((c) => c.id === input.id);
      if (!existente) throw new Error('Campanha não encontrada.');
      existente.nome = input.nome;
      existente.dataInicio = input.dataInicio;
      existente.dataFim = input.dataFim;
      existente.tipoPremiacao = input.tipoPremiacao;
      existente.criterioQuantidade = input.criterioQuantidade;
      existente.metaQuantidade = input.metaQuantidade;
      existente.premiacaoMetaValor = input.premiacaoMetaValor;
      existente.premiacaoRanking = input.premiacaoRanking;
      existente.minimoParaConcorrer = input.minimoParaConcorrer;
      existente.horarioLembrete = input.horarioLembrete;
      existente.produtos = produtos;
    } else {
      campanhas.push({
        id: `venda-adicional-${Date.now()}`,
        nome: input.nome,
        dataInicio: input.dataInicio,
        dataFim: input.dataFim,
        tipoPremiacao: input.tipoPremiacao,
        criterioQuantidade: input.criterioQuantidade,
        metaQuantidade: input.metaQuantidade,
        premiacaoMetaValor: input.premiacaoMetaValor,
        premiacaoRanking: input.premiacaoRanking,
        minimoParaConcorrer: input.minimoParaConcorrer,
        horarioLembrete: input.horarioLembrete,
        produtos,
      });
    }

    await salvarCampanhasVendaAdicionalStore(campanhas);
  }

  async excluirCampanhaVendaAdicional(id: string): Promise<void> {
    const campanhas = await getCampanhasVendaAdicionalStore();
    await salvarCampanhasVendaAdicionalStore(campanhas.filter((c) => c.id !== id));
  }

  async getVendasVendaAdicional(_profile: Profile, campanhaId: string): Promise<VendaVendaAdicional[]> {
    const campanhas = await getCampanhasVendaAdicionalStore();
    const campanha = campanhas.find((c) => c.id === campanhaId);
    if (!campanha) return delay([]);

    const codigosProduto = new Set(campanha.produtos.map((p) => p.codigoProduto));
    const linhas: VendaVendaAdicional[] = vendaItensDetalheSeed
      .filter((v) => codigosProduto.has(v.codigoProduto))
      .map((v) => ({ v, dataVenda: dataDiasAtras(v.diasAtras) }))
      .filter(({ dataVenda }) => dataVenda >= campanha.dataInicio && dataVenda <= campanha.dataFim)
      .map(({ v, dataVenda }) => ({
        itemId: v.id,
        // seed mock não modela nota com múltiplos itens — cada linha é
        // sua própria "venda" pra fins do critério 'mesma_venda'.
        vendaId: v.id,
        numeroNota: null,
        campanhaId,
        dataVenda,
        horaVenda: null,
        codigoProduto: v.codigoProduto,
        nomeProduto: catalogoProdutosSeed.find((p) => p.codigo === v.codigoProduto)?.nome ?? `Produto ${v.codigoProduto}`,
        quantidade: v.quantidade,
        codigoVendedor: v.codigoVendedor,
        nomeVendedor: nomeVendedor(v.codigoVendedor),
        codigoCliente: v.codigoCliente,
        nomeCliente: nomeCliente(v.codigoCliente),
        // idem — seed não modela outros itens na mesma nota, então
        // 'venda_com_outros_itens' não tem como ser testado no mock.
        qtdItensNaVenda: 1,
        outrosProdutosNaVenda: null,
        valor: (catalogoProdutosSeed.find((p) => p.codigo === v.codigoProduto)?.precoVenda ?? 0) * v.quantidade,
      }));

    return delay(linhas);
  }

  async getItensVendaComplementarDia(
    _profile: Profile,
    data: string,
    codigoVendedor: number
  ): Promise<ItemVendaComplementar[]> {
    const marcados = new Set(await getItensComplementarMarcadosStore());
    const itens: ItemVendaComplementar[] = vendaItensDetalheSeed
      .filter((v) => v.codigoVendedor === codigoVendedor && dataDiasAtras(v.diasAtras) === data)
      .map((v) => {
        const produto = catalogoProdutosSeed.find((p) => p.codigo === v.codigoProduto);
        return {
          itemId: v.id,
          vendaId: v.id,
          numeroNota: null,
          dataVenda: data,
          codigoProduto: v.codigoProduto,
          nomeProduto: produto?.nome ?? `Produto ${v.codigoProduto}`,
          valor: (produto?.precoVenda ?? 0) * v.quantidade,
          codigoCliente: v.codigoCliente,
          nomeCliente: nomeCliente(v.codigoCliente),
          codigoVendedor: v.codigoVendedor,
          nomeVendedor: nomeVendedor(v.codigoVendedor),
          marcado: marcados.has(v.id),
        };
      });
    return delay(itens);
  }

  async salvarVendasComplementaresDia(
    _profile: Profile,
    data: string,
    codigoVendedor: number,
    itemIdsMarcados: string[]
  ): Promise<void> {
    // sincroniza só os itens DESSE dia/vendedor — não mexe na marcação
    // de outros dias/vendedores já salva.
    const idsDoContexto = new Set(
      vendaItensDetalheSeed
        .filter((v) => v.codigoVendedor === codigoVendedor && dataDiasAtras(v.diasAtras) === data)
        .map((v) => v.id)
    );
    const atuais = await getItensComplementarMarcadosStore();
    const foraDoContexto = atuais.filter((id) => !idsDoContexto.has(id));
    await salvarItensComplementarMarcadosStore([...foraDoContexto, ...itemIdsMarcados]);
  }

  async getCampanhasComplementares(_profile: Profile): Promise<CampanhaComplementar[]> {
    const campanhas = await getCampanhasComplementaresStore();
    return delay([...campanhas].sort((a, b) => b.dataInicio.localeCompare(a.dataInicio)));
  }

  async salvarCampanhaComplementar(_profile: Profile, input: SalvarCampanhaComplementarInput): Promise<void> {
    const campanhas = await getCampanhasComplementaresStore();
    if (input.id) {
      const existente = campanhas.find((c) => c.id === input.id);
      if (!existente) throw new Error('Campanha não encontrada.');
      existente.dataInicio = input.dataInicio;
      existente.dataFim = input.dataFim;
      existente.valorMinimo = input.valorMinimo;
      existente.quantidadeMinima = input.quantidadeMinima;
      existente.metaClientesOfertadosDia = input.metaClientesOfertadosDia;
      existente.premiacaoRanking = input.premiacaoRanking;
    } else {
      campanhas.push({
        id: `complementar-${Date.now()}`,
        dataInicio: input.dataInicio,
        dataFim: input.dataFim,
        valorMinimo: input.valorMinimo,
        quantidadeMinima: input.quantidadeMinima,
        metaClientesOfertadosDia: input.metaClientesOfertadosDia,
        premiacaoRanking: input.premiacaoRanking,
      });
    }
    await salvarCampanhasComplementaresStore(campanhas);
  }

  async excluirCampanhaComplementar(id: string): Promise<void> {
    const campanhas = await getCampanhasComplementaresStore();
    await salvarCampanhasComplementaresStore(campanhas.filter((c) => c.id !== id));
  }

  async getOfertaComplementarDia(_profile: Profile, data: string, codigoVendedor: number): Promise<number> {
    const mapa = await getOfertaComplementarDiariaStore();
    return delay(mapa[`${codigoVendedor}:${data}`] ?? 0);
  }

  async salvarOfertaComplementarDia(
    _profile: Profile,
    data: string,
    codigoVendedor: number,
    clientesOfertados: number
  ): Promise<void> {
    const mapa = await getOfertaComplementarDiariaStore();
    mapa[`${codigoVendedor}:${data}`] = clientesOfertados;
    await salvarOfertaComplementarDiariaStore(mapa);
  }

  async getOfertaComplementarPeriodo(
    _profile: Profile,
    dataInicio: string,
    dataFim: string
  ): Promise<OfertaComplementarDia[]> {
    const mapa = await getOfertaComplementarDiariaStore();
    const linhas = Object.entries(mapa)
      .map(([chave, clientesOfertados]) => {
        const [codigoVendedorTexto, data] = chave.split(':');
        return { codigoVendedor: Number(codigoVendedorTexto), data, clientesOfertados };
      })
      .filter((l) => l.data >= dataInicio && l.data <= dataFim);
    return delay(linhas);
  }

  async getVendasComplementaresCampanha(_profile: Profile, campanhaId: string): Promise<VendaComplementarMarcada[]> {
    const campanhas = await getCampanhasComplementaresStore();
    const campanha = campanhas.find((c) => c.id === campanhaId);
    if (!campanha) return delay([]);

    const marcados = new Set(await getItensComplementarMarcadosStore());
    const linhas: VendaComplementarMarcada[] = vendaItensDetalheSeed
      .filter((v) => marcados.has(v.id))
      .map((v) => ({ v, dataVenda: dataDiasAtras(v.diasAtras) }))
      .filter(({ dataVenda }) => dataVenda >= campanha.dataInicio && dataVenda <= campanha.dataFim)
      .map(({ v, dataVenda }) => {
        const produto = catalogoProdutosSeed.find((p) => p.codigo === v.codigoProduto);
        return {
          itemId: v.id,
          vendaId: v.id,
          dataVenda,
          valor: (produto?.precoVenda ?? 0) * v.quantidade,
          codigoVendedor: v.codigoVendedor,
          nomeVendedor: nomeVendedor(v.codigoVendedor),
          nomeProduto: produto?.nome ?? `Produto ${v.codigoProduto}`,
        };
      });
    return delay(linhas);
  }

  async getProdutosEmFalta(_profile: Profile): Promise<ProdutoEmFalta[]> {
    // Mock não tem sessão real de quem salvou (salvarProdutoEmFalta não
    // recebe profile) — nomeRegistradoPor fica sempre null aqui; no
    // real (supabaseRepository) vem resolvido por vw_produtos_em_falta.
    const itens = await getProdutosEmFaltaStore();
    return delay([...itens].sort((a, b) => b.data.localeCompare(a.data)));
  }

  async salvarProdutoEmFalta(_profile: Profile, input: SalvarProdutoEmFaltaInput): Promise<void> {
    const itens = await getProdutosEmFaltaStore();

    if (input.id) {
      const existente = itens.find((i) => i.id === input.id);
      if (!existente) throw new Error('Registro não encontrado.');
      existente.codigoProduto = input.codigoProduto;
      existente.nomeProduto = input.nomeProduto;
      existente.data = input.data;
      existente.temSaldoEstoque = input.temSaldoEstoque;
    } else {
      itens.push({
        id: `falta-${Date.now()}`,
        codigoProduto: input.codigoProduto,
        nomeProduto: input.nomeProduto,
        data: input.data,
        temSaldoEstoque: input.temSaldoEstoque,
        nomeRegistradoPor: null,
      });
    }

    await salvarProdutosEmFaltaStore(itens);
  }

  async excluirProdutoEmFalta(id: string): Promise<void> {
    const itens = await getProdutosEmFaltaStore();
    await salvarProdutosEmFaltaStore(itens.filter((i) => i.id !== id));
  }

  async gerarRelatorioFaltas(profile: Profile): Promise<ItemRelatorioFalta[]> {
    const faltas = await this.getProdutosEmFalta(profile);
    const fornecedoresPorCodigo = new Map(fornecedoresSeed.map((f) => [f.codigo, f.nomeFantasia]));
    const fornecedorPorProduto = new Map(
      compraInfoSeed.map((c) => [c.codigoProduto, fornecedoresPorCodigo.get(c.codigoFornecedor) ?? null])
    );

    return delay(
      faltas.map((f) => {
        const cat = f.codigoProduto != null ? catalogoProdutosSeed.find((p) => p.codigo === f.codigoProduto) : null;
        return {
          id: f.id,
          nomeProduto: f.nomeProduto,
          codigoProduto: f.codigoProduto,
          codigoBarras: cat?.codigoBarras ?? null,
          custoMedio: cat?.custoMedio ?? null,
          fornecedorSugerido: f.codigoProduto != null ? fornecedorPorProduto.get(f.codigoProduto) ?? null : null,
          data: f.data,
          nomeRegistradoPor: f.nomeRegistradoPor,
          temSaldoEstoque: f.temSaldoEstoque,
        };
      })
    );
  }

  async limparProdutosEmFalta(ids: string[]): Promise<void> {
    const itens = await getProdutosEmFaltaStore();
    await salvarProdutosEmFaltaStore(itens.filter((i) => !ids.includes(i.id)));
  }

  async getPendencias(_profile: Profile): Promise<Pendencia[]> {
    const itens = await getPendenciasStore();
    return delay(
      itens
        .filter((i) => !i.baixada)
        .sort((a, b) => b.data.localeCompare(a.data))
    );
  }

  async salvarPendencia(_profile: Profile, input: SalvarPendenciaInput): Promise<void> {
    const itens = await getPendenciasStore();
    itens.push({
      id: `pend-${Date.now()}`,
      nomeCliente: input.nomeCliente,
      produtos: input.produtos,
      // uri local do dispositivo — sem storage de verdade no mock, mas
      // <Image> renderiza uri local igual signed URL, então funciona
      // pra pré-visualizar na mesma sessão.
      fotoUrl: input.fotoUri,
      data: todayISO(),
      baixada: false,
      baixadaEm: null,
      nomeRegistradoPor: null,
    });
    await salvarPendenciasStore(itens);
  }

  async darBaixaPendencia(id: string): Promise<void> {
    const itens = await getPendenciasStore();
    const existente = itens.find((i) => i.id === id);
    if (existente) {
      existente.baixada = true;
      existente.baixadaEm = new Date().toISOString();
    }
    await salvarPendenciasStore(itens);
  }

  async getCarteiraClientes(profile: Profile, codigoVendedor?: number): Promise<ClienteCarteira[]> {
    const itens = await getCarteiraClientesStore();
    const filtro = codigoVendedor ?? (profile.role === 'vendedor' ? profile.codigoVendedor : null);
    const filtrados = filtro != null ? itens.filter((i) => i.codigoVendedor === filtro) : itens;

    const hoje = new Date();
    const seisMesesAtras = new Date(hoje);
    seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 6);
    const seisMesesAtrasIso = seisMesesAtras.toISOString().slice(0, 10);
    const mesAtual = hoje.toISOString().slice(0, 7);

    return delay(
      filtrados.map((item) => {
        // Soma QUALQUER vendedor (mesmo raciocínio de
        // getClientesValorGeral) — não filtra vendaItensDetalheSeed por
        // codigoVendedor.
        const comprasDoCliente = vendaItensDetalheSeed.filter((v) => v.codigoCliente === item.codigoCliente);
        let valor6Meses = 0;
        let valorMesAtual = 0;
        let compradoEsteMes = false;
        for (const compra of comprasDoCliente) {
          const data = dataDiasAtras(compra.diasAtras);
          const valorCompra = (produtosSeed.find((p) => p.codigo === compra.codigoProduto)?.precoAtual ?? 0) * compra.quantidade;
          if (data >= seisMesesAtrasIso) {
            valor6Meses += valorCompra;
          }
          if (data.slice(0, 7) === mesAtual) {
            compradoEsteMes = true;
            valorMesAtual += valorCompra;
          }
        }
        return {
          id: item.id,
          codigoVendedor: item.codigoVendedor,
          codigoCliente: item.codigoCliente,
          nome: nomeCliente(item.codigoCliente),
          telefone: telefoneCliente(item.codigoCliente),
          valor6Meses: round2(valor6Meses),
          compradoEsteMes,
          valorMesAtual: round2(valorMesAtual),
        };
      })
    );
  }

  async getDonosCarteira(_profile: Profile): Promise<DonoCarteira[]> {
    const itens = await getCarteiraClientesStore();
    const nomePorCodigo = new Map(vendedoresSeed.map((v) => [v.codigo, v.nome]));
    return delay(
      itens.map((item) => ({
        codigoCliente: item.codigoCliente,
        codigoVendedor: item.codigoVendedor,
        nomeVendedor: nomePorCodigo.get(item.codigoVendedor) ?? `Vendedor ${item.codigoVendedor}`,
      }))
    );
  }

  async buscarClientesParaCarteira(termo: string): Promise<ClienteBusca[]> {
    const termoLimpo = termo.trim().toLowerCase();
    if (!termoLimpo) return delay([]);
    return delay(
      clientesSeed
        .filter((c) => c.nome.toLowerCase().includes(termoLimpo) || String(c.codigo).includes(termoLimpo))
        .slice(0, 20)
        .map((c) => ({ codigo: c.codigo, nome: c.nome, numeroCpfCnpj: null, telefone: c.telefone }))
    );
  }

  async adicionarClienteCarteira(_profile: Profile, codigoVendedor: number, codigoCliente: number): Promise<void> {
    const itens = await getCarteiraClientesStore();
    if (itens.some((i) => i.codigoVendedor === codigoVendedor && i.codigoCliente === codigoCliente)) return;
    itens.push({ id: `cart-${Date.now()}`, codigoVendedor, codigoCliente, criadoEm: new Date().toISOString() });
    await salvarCarteiraClientesStore(itens);
  }

  async removerClienteCarteira(id: string): Promise<void> {
    const itens = await getCarteiraClientesStore();
    await salvarCarteiraClientesStore(itens.filter((i) => i.id !== id));
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function diasNoIntervalo(dataInicio: string, dataFim: string): number {
  const inicio = new Date(`${dataInicio}T00:00:00`);
  const fim = new Date(`${dataFim}T00:00:00`);
  return Math.max(1, Math.round((fim.getTime() - inicio.getTime()) / 86_400_000) + 1);
}

export const mockRepository = new MockRepository();
