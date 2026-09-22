import type { User } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { File as ExpoFile } from 'expo-file-system';
import { supabase } from './client';
import { DataRepository } from '../repository';
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
  Role,
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
import { calcularSugestaoCompras } from '../../lib/doseCerta';
import { calcularEstoqueZeradoGiroAlto, calcularRelatorioPrecificacao } from '../../lib/precificacao';
import { sugerirCandidatos } from '../../lib/campanhas';
import { LinhaRpcAfinidade, mapearSugestoesAfinidade, resolverCodigosSeed } from '../../lib/afinidadeKits';
import { rotuloSemana } from '../../lib/metas';
import { todayISO } from '../../lib/format';

function round2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

// A API File do expo-file-system (usada abaixo pra ler foto local
// antes de subir pro Storage) é nativa-only — no web (Safari/Chrome
// via Expo Web) ela quebra com "this.validatePath is not a function"
// assim que chama .arrayBuffer(), porque o shim de web da lib não
// implementa esse método. fetch(uri).arrayBuffer() funciona bem no web
// (a uri ali é blob:/data:, não um path de arquivo), mas foi
// especificamente pouco confiável pra arquivo local NATIVO no SDK 57 —
// por isso o native continua usando a File API, e só o web cai pro
// fetch (achado 18/08/2026).
async function lerFotoComoArrayBuffer(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') {
    const resposta = await fetch(uri);
    return resposta.arrayBuffer();
  }
  return new ExpoFile(uri).arrayBuffer();
}

function mapearProdutoCatalogo(r: any): ProdutoCatalogo {
  return {
    codigo: r.codigo,
    codigoBarras: r.codigo_barras ?? '',
    nome: r.nome,
    categoria: r.categoria ?? '',
    grupo: (r.grupo ?? '').trim(),
    marca: r.marca ?? '',
    precoVenda: Number(r.preco_venda),
    custoMedio: Number(r.custo_medio),
    estoqueAtual: r.estoque_atual,
    tipoLista: r.tipo_lista ?? null,
  };
}

// profiles não guarda nome (só id/role/codigo_vendedor) — pro vendedor
// usamos vendedores.nome (já sincronizado pelo coletor); pro gestor,
// que não tem linha em vendedores, cai num rótulo fixo. Se quiser o
// nome de verdade do gestor no futuro, dá pra adicionar uma coluna
// `nome` em profiles — não fiz isso agora pra não pedir mais uma
// migração em cima do que já é bastante coisa nesta rodada.
async function buscarProfile(user: User): Promise<Profile | null> {
  const { data: perfil, error } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, codigo_vendedor')
    .eq('id', user.id)
    .maybeSingle();
  if (error || !perfil) return null;

  if (perfil.codigo_vendedor != null) {
    const { data: vendedor } = await supabase
      .from('vendedores')
      .select('nome')
      .eq('codigo', perfil.codigo_vendedor)
      .maybeSingle();
    return {
      id: perfil.id,
      tenantId: perfil.tenant_id,
      nome: vendedor?.nome ?? user.email ?? `Vendedor ${perfil.codigo_vendedor}`,
      email: user.email ?? '',
      role: perfil.role as Role,
      codigoVendedor: perfil.codigo_vendedor,
    };
  }

  return {
    id: perfil.id,
    tenantId: perfil.tenant_id,
    nome: 'Gestor(a) da Farmácia',
    email: user.email ?? '',
    role: perfil.role as Role,
    codigoVendedor: null,
  };
}

/**
 * Frente 2: implementação real do DataRepository, consumindo só o
 * Supabase (nunca a API da Trier diretamente — ver README). A RLS
 * definida em schema.sql/rls_policies.sql já resolve a filtragem
 * vendedor-vs-gestor na maioria dos métodos; por isso boa parte das
 * queries aqui não faz filtro manual por `profile` (diferente do
 * mockRepository, que precisa simular a RLS em JS).
 */
class SupabaseRepository implements DataRepository {
  async login(email: string, senha: string): Promise<Profile> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error || !data.user) {
      throw new Error('E-mail ou senha inválidos.');
    }
    const profile = await buscarProfile(data.user);
    if (!profile) {
      await supabase.auth.signOut();
      throw new Error('Usuário sem perfil cadastrado — contate o gestor.');
    }
    return profile;
  }

  async logout(): Promise<void> {
    await supabase.auth.signOut();
  }

  async getSession(): Promise<Profile | null> {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    return buscarProfile(user);
  }

  // Coluna liberada por GRANT específico (não a linha inteira) em
  // rls_policies.sql — vendedor só consegue escrever esse campo em si
  // mesmo, nunca role/codigo_vendedor.
  async salvarPushToken(profile: Profile, token: string): Promise<void> {
    if (!profile.codigoVendedor) return;
    const { error } = await supabase.from('profiles').update({ expo_push_token: token }).eq('id', profile.id);
    if (error) throw error;
  }

  async getDesempenhoVendedorDiario(_profile: Profile, dataEmissao: string): Promise<DesempenhoVendedorDiario[]> {
    const { data, error } = await supabase
      .from('vw_desempenho_vendedor_diario')
      .select('*')
      .eq('data_emissao', dataEmissao);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      dataEmissao: r.data_emissao,
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
      quantidadeAtendimentos: r.quantidade_atendimentos,
      quantidadeItens: r.quantidade_itens,
      itensPorAtendimento: Number(r.itens_por_atendimento ?? 0),
    }));
  }

  async getMetricasVendedorDiario(_profile: Profile, dataEmissao: string): Promise<MetricasVendedorDiario[]> {
    const { data, error } = await supabase.from('vw_metricas_vendedor_diario').select('*').eq('data_emissao', dataEmissao);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      dataEmissao: r.data_emissao,
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
      qtdNotas: r.qtd_notas,
      faturamentoLiquido: Number(r.faturamento_liquido),
      faturamentoBruto: Number(r.faturamento_bruto),
      totalDesconto: Number(r.total_desconto),
      taxaDescontoPct: Number(r.taxa_desconto_pct ?? 0),
      comissaoEstimada: Number(r.comissao_estimada),
      ticketMedio: Number(r.ticket_medio ?? 0),
      totalCusto: Number(r.total_custo),
      margemBrutaPct: Number(r.margem_bruta_pct ?? 0),
    }));
  }

  async getDesempenhoVendedorMensal(_profile: Profile, ano: number, mes: number): Promise<DesempenhoVendedorMensal[]> {
    const { data, error } = await supabase
      .from('vw_desempenho_vendedor_mensal')
      .select('*')
      .eq('ano', ano)
      .eq('mes', mes);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      ano: r.ano,
      mes: r.mes,
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
      quantidadeAtendimentos: r.quantidade_atendimentos,
      quantidadeItens: r.quantidade_itens,
      itensPorAtendimento: Number(r.itens_por_atendimento ?? 0),
    }));
  }

  async getMetricasVendedorMensal(_profile: Profile, ano: number, mes: number): Promise<MetricasVendedorMensal[]> {
    const { data, error } = await supabase
      .from('vw_metricas_vendedor_mensal')
      .select('*')
      .eq('ano', ano)
      .eq('mes', mes);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      ano: r.ano,
      mes: r.mes,
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
      qtdNotas: r.qtd_notas,
      faturamentoLiquido: Number(r.faturamento_liquido),
      faturamentoBruto: Number(r.faturamento_bruto),
      totalDesconto: Number(r.total_desconto),
      taxaDescontoPct: Number(r.taxa_desconto_pct ?? 0),
      comissaoEstimada: Number(r.comissao_estimada),
      ticketMedio: Number(r.ticket_medio ?? 0),
      totalCusto: Number(r.total_custo),
      margemBrutaPct: Number(r.margem_bruta_pct ?? 0),
    }));
  }

  // Seletor "Período" (calendário) do card "Desempenho" — intervalo de
  // datas livre, via fn_metricas_vendedor_periodo/fn_desempenho_vendedor_periodo
  // (11/08/2026, ver migracao_metricas_periodo_customizado.sql).
  async getDesempenhoVendedorPeriodo(
    _profile: Profile,
    dataInicio: string,
    dataFim: string
  ): Promise<DesempenhoVendedorPeriodo[]> {
    const { data, error } = await supabase.rpc('fn_desempenho_vendedor_periodo', {
      data_inicio: dataInicio,
      data_fim: dataFim,
    });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      dataInicio,
      dataFim,
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
      quantidadeAtendimentos: r.quantidade_atendimentos,
      quantidadeItens: r.quantidade_itens,
      itensPorAtendimento: Number(r.itens_por_atendimento ?? 0),
    }));
  }

  async getMetricasVendedorPeriodo(
    _profile: Profile,
    dataInicio: string,
    dataFim: string
  ): Promise<MetricasVendedorPeriodo[]> {
    const { data, error } = await supabase.rpc('fn_metricas_vendedor_periodo', {
      data_inicio: dataInicio,
      data_fim: dataFim,
    });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      dataInicio,
      dataFim,
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
      qtdNotas: r.qtd_notas,
      faturamentoLiquido: Number(r.faturamento_liquido),
      faturamentoBruto: Number(r.faturamento_bruto),
      totalDesconto: Number(r.total_desconto),
      taxaDescontoPct: Number(r.taxa_desconto_pct ?? 0),
      ticketMedio: Number(r.ticket_medio ?? 0),
      totalCusto: Number(r.total_custo),
      margemBrutaPct: Number(r.margem_bruta_pct ?? 0),
    }));
  }

  async getDesempenhoVendedorSemanal(
    _profile: Profile,
    ano: number,
    mes: number,
    semana: 1 | 2 | 3 | 4
  ): Promise<DesempenhoVendedorSemanal[]> {
    const { data, error } = await supabase
      .from('vw_desempenho_vendedor_semanal')
      .select('*')
      .eq('ano', ano)
      .eq('mes', mes)
      .eq('semana', semana);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      ano: r.ano,
      mes: r.mes,
      semana: r.semana,
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
      quantidadeAtendimentos: r.quantidade_atendimentos,
      quantidadeItens: r.quantidade_itens,
      itensPorAtendimento: Number(r.itens_por_atendimento ?? 0),
    }));
  }

  async getMetricasVendedorSemanal(
    _profile: Profile,
    ano: number,
    mes: number,
    semana: 1 | 2 | 3 | 4
  ): Promise<MetricasVendedorSemanal[]> {
    const { data, error } = await supabase
      .from('vw_metricas_vendedor_semanal')
      .select('*')
      .eq('ano', ano)
      .eq('mes', mes)
      .eq('semana', semana);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      ano: r.ano,
      mes: r.mes,
      semana: r.semana,
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
      qtdNotas: r.qtd_notas,
      faturamentoLiquido: Number(r.faturamento_liquido),
      faturamentoBruto: Number(r.faturamento_bruto),
      totalDesconto: Number(r.total_desconto),
      taxaDescontoPct: Number(r.taxa_desconto_pct ?? 0),
      comissaoEstimada: Number(r.comissao_estimada),
      ticketMedio: Number(r.ticket_medio ?? 0),
      totalCusto: Number(r.total_custo),
      margemBrutaPct: Number(r.margem_bruta_pct ?? 0),
    }));
  }

  // vw_ranking_vendedores_dia roda sem RLS de propósito (gamificação —
  // todo vendedor vê o placar inteiro), então não precisa de filtro por
  // profile aqui, igual ao mock.
  async getRankingVendedoresDia(_profile: Profile, dataEmissao: string): Promise<RankingVendedorDia[]> {
    const { data, error } = await supabase.from('vw_ranking_vendedores_dia').select('*').eq('data_emissao', dataEmissao);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      dataEmissao: r.data_emissao,
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
      faturamentoLiquido: Number(r.faturamento_liquido),
      posicao: r.posicao,
    }));
  }

  // vw_clientes_inatividade já faz o próprio controle de acesso no
  // WHERE (vendedor vê todo cliente desde 01/08/2026, não só os
  // próprios). Paginado: a farmácia já passa de 5 mil clientes
  // cadastrados, bem acima do limite padrão de 1000 linhas do
  // PostgREST — sem isso, a busca por nome em Pendências (que reusa
  // esse método) nunca acharia cliente fora da primeira fatia (achado
  // 06/08/2026).
  async getClientesInatividade(_profile: Profile): Promise<ClienteInatividade[]> {
    const data = await this.buscarPaginado((inicio, fim) =>
      supabase.from('vw_clientes_inatividade').select('*').order('codigo', { ascending: true }).range(inicio, fim)
    );
    return data.map((r: any) => ({
      codigo: r.codigo,
      nome: r.nome,
      telefone: r.telefone,
      ultimaCompra: r.ultima_compra,
      diasSemComprar: r.dias_sem_comprar,
      inativo: r.inativo,
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
    }));
  }

  // count 'exact' + head:true não traz linha nenhuma, só o total real no
  // header — imune ao limite padrão de 1000 linhas por request que
  // getClientesInatividade(select '*') tem (a RLS da view já filtra por
  // papel, então cada count aqui já reflete só o que aquele usuário pode
  // ver, igual à lista completa).
  async getResumoClientesInatividade(_profile: Profile): Promise<ResumoClientesInatividade> {
    const [totalRes, inativosRes] = await Promise.all([
      supabase.from('vw_clientes_inatividade').select('*', { count: 'exact', head: true }),
      supabase.from('vw_clientes_inatividade').select('*', { count: 'exact', head: true }).eq('inativo', true),
    ]);
    if (totalRes.error) throw totalRes.error;
    if (inativosRes.error) throw inativosRes.error;
    return { total: totalRes.count ?? 0, inativos: inativosRes.count ?? 0 };
  }

  async getClientesDoVendedor(profile: Profile): Promise<ClienteDoVendedor[]> {
    if (profile.codigoVendedor == null) return [];
    // PostgREST limita 1000 linhas por request por padrão — sem
    // paginação aqui, um vendedor com carteira grande via a lista
    // cortada em exatamente 1000 (achado 01/08/2026, mesma causa do
    // tile "Clientes inativos" antes de corrigir pra count agregado).
    // Aqui não dá pra usar só count (a tela precisa dos dados
    // completos pra buscar/filtrar), então pagina de verdade.
    // Desempate por codigo (client) além de ultima_compra — só a data
    // pode empatar entre clientes diferentes, e sem desempate único a
    // ordenação não é garantida estável entre páginas (mesmo risco do
    // getProdutosRecorrentesDoVendedor abaixo).
    const TAMANHO_PAGINA = 1000;
    const linhas: Record<string, unknown>[] = [];
    for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
      const { data, error } = await supabase
        .from('vw_clientes_por_vendedor')
        .select('*')
        .eq('codigo_vendedor', profile.codigoVendedor)
        .order('ultima_compra', { ascending: false })
        .order('codigo', { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      if (error) throw error;
      linhas.push(...(data ?? []));
      if (!data || data.length < TAMANHO_PAGINA) break;
    }
    return linhas.map((r: any) => ({
      codigo: r.codigo,
      nome: r.nome,
      telefone: r.telefone,
      email: r.email,
      dataNascimento: r.data_nascimento,
      valorTotal: Number(r.valor_total),
      ultimaCompra: r.ultima_compra,
    }));
  }

  async getClientesValorGeral(_profile: Profile): Promise<ClienteDoVendedor[]> {
    // Mesma paginação de getClientesDoVendedor (PostgREST limita 1000
    // linhas por request) — aqui sem filtro de vendedor, então o total
    // de clientes é ainda maior.
    const TAMANHO_PAGINA = 1000;
    const linhas: Record<string, unknown>[] = [];
    for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
      const { data, error } = await supabase
        .from('vw_clientes_valor_geral')
        .select('*')
        .order('ultima_compra', { ascending: false })
        .order('codigo', { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      if (error) throw error;
      linhas.push(...(data ?? []));
      if (!data || data.length < TAMANHO_PAGINA) break;
    }
    return linhas.map((r: any) => ({
      codigo: r.codigo,
      nome: r.nome,
      telefone: r.telefone,
      email: r.email,
      dataNascimento: r.data_nascimento,
      valorTotal: Number(r.valor_total),
      ultimaCompra: r.ultima_compra,
    }));
  }

  async getCarteiraClientes(profile: Profile, codigoVendedor?: number): Promise<ClienteCarteira[]> {
    // Sem codigoVendedor explícito: vendedor filtra pra si mesmo;
    // gestor NÃO filtra (a view já mostra tudo pra ele, usado pelo
    // card de Alertas pra somar a carteira de todo mundo). Com
    // codigoVendedor: usado pelo gestor na aba, com o seletor.
    const filtro = codigoVendedor ?? (profile.role === 'vendedor' ? profile.codigoVendedor : null);
    let query = supabase.from('vw_carteira_clientes').select('*').order('nome', { ascending: true });
    if (filtro != null) query = query.eq('codigo_vendedor', filtro);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: String(r.id),
      codigoVendedor: r.codigo_vendedor,
      codigoCliente: r.codigo_cliente,
      nome: r.nome,
      telefone: r.telefone,
      valor6Meses: Number(r.valor_6_meses),
      compradoEsteMes: r.comprado_este_mes,
      valorMesAtual: Number(r.valor_mes_atual ?? 0),
    }));
  }

  async getDonosCarteira(_profile: Profile): Promise<DonoCarteira[]> {
    const { data, error } = await supabase.from('vw_cliente_dono_carteira').select('*');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      codigoCliente: r.codigo_cliente,
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
    }));
  }

  async buscarClientesParaCarteira(termo: string): Promise<ClienteBusca[]> {
    const termoLimpo = termo.trim();
    if (!termoLimpo) return [];
    const filtros = [`nome.ilike.%${termoLimpo}%`, `numero_cpf_cnpj.ilike.%${termoLimpo}%`];
    // codigo é integer — só entra no OR quando o termo é só dígitos, senão o
    // PostgREST rejeita o eq com "invalid input syntax for type integer".
    if (/^\d+$/.test(termoLimpo)) filtros.push(`codigo.eq.${termoLimpo}`);
    const { data, error } = await supabase
      .from('clientes')
      .select('codigo, nome, numero_cpf_cnpj, fone')
      .or(filtros.join(','))
      .order('nome', { ascending: true })
      .limit(20);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      codigo: r.codigo,
      nome: r.nome,
      numeroCpfCnpj: r.numero_cpf_cnpj,
      telefone: r.fone,
    }));
  }

  async adicionarClienteCarteira(profile: Profile, codigoVendedor: number, codigoCliente: number): Promise<void> {
    const { data: sessao } = await supabase.auth.getUser();
    const { error } = await supabase.from('carteira_clientes').insert({
      tenant_id: profile.tenantId,
      codigo_vendedor: codigoVendedor,
      codigo_cliente: codigoCliente,
      adicionado_por: sessao.user?.id ?? null,
    });
    if (error) throw error;
  }

  async removerClienteCarteira(id: string): Promise<void> {
    const { error } = await supabase.from('carteira_clientes').delete().eq('id', Number(id));
    if (error) throw error;
  }

  // Limit no app, não na view — a view fica genérica pra outros usos
  // poderem pedir mais/menos (padrão 5 pra "Meus clientes", 7 pra
  // "Cliente para resgate").
  async getHistoricoComprasCliente(_profile: Profile, codigoCliente: number, limite = 5): Promise<HistoricoCompraCliente[]> {
    const { data, error } = await supabase
      .from('vw_historico_compras_cliente')
      .select('*')
      .eq('codigo_cliente', codigoCliente)
      .order('data_emissao', { ascending: false })
      .limit(limite);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      itemId: r.item_id,
      vendaId: r.venda_id,
      dataEmissao: r.data_emissao,
      codigoProduto: r.codigo_produto,
      nomeProduto: r.nome_produto,
      quantidade: Number(r.quantidade_produtos),
      valorTotal: Number(r.valor_total_liquido),
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
    }));
  }

  async getProdutosRecorrentesDoVendedor(profile: Profile): Promise<ProdutoRecorrenteCliente[]> {
    if (profile.codigoVendedor == null) return [];
    // mesma paginação de getClientesDoVendedor — pode passar de 1000
    // linhas fácil (1 linha por produto distinto de cada cliente).
    // .order() ANTES do .range() não é opcional aqui: sem ordenação
    // estável o Postgres não garante que cada página traga linhas
    // diferentes das outras — sem isso, a mesma linha podia aparecer
    // em duas páginas (e outra sumir), causando produto duplicado pro
    // mesmo cliente (achado 01/08/2026 — "Encountered two children
    // with the same key" no app, key = codigo_produto repetido).
    const TAMANHO_PAGINA = 1000;
    const linhas: Record<string, unknown>[] = [];
    for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
      const { data, error } = await supabase
        .from('vw_clientes_produtos_vendedor')
        .select('*')
        .eq('codigo_vendedor', profile.codigoVendedor)
        .order('codigo_cliente', { ascending: true })
        .order('codigo_produto', { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      if (error) throw error;
      linhas.push(...(data ?? []));
      if (!data || data.length < TAMANHO_PAGINA) break;
    }
    return linhas.map((r: any) => ({
      codigoCliente: r.codigo_cliente,
      codigoProduto: r.codigo_produto,
      nomeProduto: r.nome_produto,
      categoria: r.categoria,
      grupo: r.grupo,
      qtdCompras: r.qtd_compras,
      ultimaCompra: r.ultima_compra,
      intervaloMedioDias: r.intervalo_medio_dias == null ? null : Number(r.intervalo_medio_dias),
      diasDesdeUltimaCompra: r.dias_desde_ultima_compra,
      recorrente: r.recorrente,
      atrasado: r.atrasado,
    }));
  }

  // Mesma paginação/motivo de getProdutosRecorrentesDoVendedor, mas sem
  // filtro de codigo_vendedor — vw_clientes_produtos já agrega por
  // cliente somando qualquer vendedor.
  async getProdutosRecorrentesClientes(_profile: Profile): Promise<ProdutoRecorrenteCliente[]> {
    const TAMANHO_PAGINA = 1000;
    const linhas: Record<string, unknown>[] = [];
    for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
      const { data, error } = await supabase
        .from('vw_clientes_produtos')
        .select('*')
        .order('codigo_cliente', { ascending: true })
        .order('codigo_produto', { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      if (error) throw error;
      linhas.push(...(data ?? []));
      if (!data || data.length < TAMANHO_PAGINA) break;
    }
    return linhas.map((r: any) => ({
      codigoCliente: r.codigo_cliente,
      codigoProduto: r.codigo_produto,
      nomeProduto: r.nome_produto,
      categoria: r.categoria,
      grupo: r.grupo,
      qtdCompras: r.qtd_compras,
      ultimaCompra: r.ultima_compra,
      intervaloMedioDias: r.intervalo_medio_dias == null ? null : Number(r.intervalo_medio_dias),
      diasDesdeUltimaCompra: r.dias_desde_ultima_compra,
      recorrente: r.recorrente,
      atrasado: r.atrasado,
    }));
  }

  // vw_produtos_promocao_clientes também roda sem RLS de propósito —
  // qualquer vendedor vê oportunidade de contato de qualquer cliente.
  async getProdutosEmPromocao(_profile: Profile): Promise<ProdutoPromocaoAlerta[]> {
    const { data, error } = await supabase
      .from('vw_produtos_promocao_clientes')
      .select('*')
      .order('percentual_desconto', { ascending: false });
    if (error) throw error;

    const porProduto = new Map<number, ProdutoPromocaoAlerta>();
    for (const r of data ?? []) {
      let alerta = porProduto.get(r.codigo_produto);
      if (!alerta) {
        alerta = {
          produto: {
            codigo: r.codigo_produto,
            nome: r.nome_produto,
            precoAtual: Number(r.preco_atual),
            precoAnterior: r.preco_anterior != null ? Number(r.preco_anterior) : null,
            emPromocao: true,
            percentualDesconto: r.percentual_desconto != null ? Number(r.percentual_desconto) : null,
            exigeReceita: r.exige_receita,
            tipoReceita: r.tipo_receita,
          },
          clientes: [],
          quantidadeVendidaAcao: Number(r.quantidade_vendida_periodo),
        };
        porProduto.set(r.codigo_produto, alerta);
      }
      alerta.clientes.push({
        codigoCliente: r.codigo_cliente,
        nomeCliente: r.nome_cliente,
        telefone: r.telefone_cliente,
        ultimaCompraProduto: r.ultima_compra_produto,
        quantidade: Number(r.quantidade_total),
      });
    }
    return Array.from(porProduto.values());
  }

  async getVendasComReceita(_profile: Profile): Promise<VendaReceitaPendente[]> {
    const { data, error } = await supabase.from('vw_vendas_receita_status').select('*');
    if (error) throw error;

    const linhas = data ?? [];

    // foto_url na view é só o path dentro do bucket (bucket "receitas" é
    // privado) — precisa virar signed URL pra <Image> conseguir carregar.
    // createSignedUrls (plural) resolve todas de uma vez, 1 chamada só,
    // em vez de 1 request por item anexado.
    const paths = [...new Set(linhas.map((r) => r.foto_url).filter((p): p is string => !!p))];
    const urlPorPath = new Map<string, string>();
    if (paths.length > 0) {
      const { data: assinadas } = await supabase.storage.from('receitas').createSignedUrls(paths, 60 * 60);
      for (const item of assinadas ?? []) {
        if (item.path && item.signedUrl) urlPorPath.set(item.path, item.signedUrl);
      }
    }

    const resultado: VendaReceitaPendente[] = linhas.map((r) => ({
      itemId: String(r.venda_item_id),
      dataVenda: r.data_venda,
      codigoProduto: r.codigo_produto,
      nomeProduto: r.nome_produto,
      tipoReceita: r.tipo_receita as TipoReceita,
      codigoCliente: r.codigo_cliente,
      nomeCliente: r.nome_cliente ?? '—',
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
      receitaAnexada: r.receita_anexada,
      receitaDataAnexo: r.data_anexo,
      receitaFotoUri: r.foto_url ? urlPorPath.get(r.foto_url) ?? null : null,
    }));

    resultado.sort((a, b) => {
      if (a.receitaAnexada !== b.receitaAnexada) return a.receitaAnexada ? 1 : -1;
      return b.dataVenda.localeCompare(a.dataVenda);
    });
    return resultado;
  }

  async getVendasAntimicrobianoRecente(_profile: Profile): Promise<VendaAntimicrobianoRecente[]> {
    const { data, error } = await supabase.from('vw_vendas_antimicrobiano_recente').select('*');
    if (error) throw error;
    return (data ?? []).map((r) => ({
      itemId: String(r.venda_item_id),
      dataVenda: r.data_venda,
      codigoProduto: r.codigo_produto,
      nomeProduto: r.nome_produto,
      codigoCliente: r.codigo_cliente,
      nomeCliente: r.nome_cliente ?? '—',
    }));
  }

  async getIdentificacaoCompradorPorVendedor(_profile: Profile): Promise<IdentificacaoCompradorVendedor[]> {
    const { data, error } = await supabase.from('vw_receita_identificacao_comprador').select('*');
    if (error) throw error;

    return (data ?? [])
      .map((r) => ({
        codigoVendedor: r.codigo_vendedor,
        nomeVendedor: r.nome_vendedor,
        totalVendas: r.total_vendas,
        vendasSemIdentificacao: r.vendas_todas_sem_identificacao,
        percentualSemIdentificacao:
          r.total_vendas > 0 ? Math.round((r.vendas_todas_sem_identificacao / r.total_vendas) * 1000) / 10 : 0,
        totalVendasControladas: r.total_vendas_controladas,
        vendasControladasSemIdentificacao: r.vendas_sem_identificacao,
        percentualControladasSemIdentificacao:
          r.total_vendas_controladas > 0
            ? Math.round((r.vendas_sem_identificacao / r.total_vendas_controladas) * 1000) / 10
            : 0,
        vendasProprioCpf: r.vendas_proprio_cpf,
        percentualProprioCpf: r.total_vendas > 0 ? Math.round((r.vendas_proprio_cpf / r.total_vendas) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.percentualSemIdentificacao - a.percentualSemIdentificacao);
  }

  async getVendasSemIdentificacaoComprador(
    _profile: Profile,
    codigoVendedor: number
  ): Promise<VendaSemIdentificacaoComprador[]> {
    const { data, error } = await supabase
      .from('vw_vendas_sem_identificacao_comprador')
      .select('*')
      .eq('codigo_vendedor', codigoVendedor);
    if (error) throw error;

    return (data ?? []).map((r) => ({
      itemId: String(r.venda_item_id),
      dataVenda: r.data_venda,
      horaVenda: r.hora_emissao ?? null,
      numeroNota: r.numero_nota,
      nomeProduto: r.nome_produto,
      motivo: r.motivo as 'sem_cliente' | 'proprio_cpf',
      controlado: r.controlado,
    }));
  }

  // 300 dias cobre a maior janela usada (aniversário — ver
  // lib/contatos.ts); cada tela filtra pela janela do próprio motivo.
  async getContatosRecentes(_profile: Profile): Promise<ContatoCliente[]> {
    const limite = new Date(Date.now() - 300 * 86400000).toISOString();
    const { data, error } = await supabase
      .from('contatos_clientes')
      .select('codigo_cliente, motivo, codigo_produto, contatado_em')
      .gte('contatado_em', limite);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      codigoCliente: r.codigo_cliente,
      motivo: r.motivo,
      codigoProduto: r.codigo_produto,
      contatadoEm: r.contatado_em,
    }));
  }

  async registrarContato(profile: Profile, input: RegistrarContatoInput): Promise<void> {
    const { error } = await supabase.from('contatos_clientes').insert({
      tenant_id: profile.tenantId,
      codigo_cliente: input.codigoCliente,
      motivo: input.motivo,
      tipo_contato: input.tipoContato,
      codigo_produto: input.codigoProduto ?? null,
      codigo_vendedor: input.codigoVendedor,
    });
    if (error) throw error;
  }

  // Convenção de path fixada em storage_setup.sql: as policies do bucket
  // "receitas" checam o primeiro segmento do path contra
  // profiles.codigo_vendedor — subir fora desse formato quebra a RLS de
  // Storage (vendedor não consegue nem ler a própria foto).
  async anexarReceita(itemId: string, info: { tipo: TipoReceita; fotoUri: string | null }): Promise<void> {
    const { data: item, error: itemError } = await supabase
      .from('venda_itens')
      .select('id, codigo_vendedor')
      .eq('id', itemId)
      .single();
    if (itemError || !item) throw new Error('Item de venda não encontrado.');

    let fotoUrl: string | null = null;
    if (info.fotoUri) {
      const path = `${item.codigo_vendedor}/${itemId}.jpg`;
      const arrayBuffer = await lerFotoComoArrayBuffer(info.fotoUri);
      const { error: uploadError } = await supabase.storage.from('receitas').upload(path, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (uploadError) throw uploadError;
      fotoUrl = path;
    }

    const { data: sessao } = await supabase.auth.getUser();
    const { error } = await supabase.from('venda_item_receitas').upsert(
      {
        venda_item_id: Number(itemId),
        tipo_receita: info.tipo,
        foto_url: fotoUrl,
        anexado_por: sessao.user?.id ?? null,
        data_anexo: new Date().toISOString(),
      },
      { onConflict: 'venda_item_id' }
    );
    if (error) throw error;
  }

  async getMetas(_profile: Profile, ano: number, mes: number): Promise<MetaVendedor[]> {
    const { data, error } = await supabase.from('vw_metas_progresso').select('*').eq('ano', ano).eq('mes', mes);
    if (error) throw error;

    const porVendedor = new Map<number, MetaVendedor>();
    for (const r of data ?? []) {
      let meta = porVendedor.get(r.codigo_vendedor);
      if (!meta) {
        meta = {
          codigoVendedor: r.codigo_vendedor,
          nomeVendedor: r.nome_vendedor,
          ano,
          mes,
          valorMetaMensal: 0,
          valorRealizadoMensal: 0,
          semanas: [],
        };
        porVendedor.set(r.codigo_vendedor, meta);
      }
      if (r.semana == null) {
        meta.valorMetaMensal = Number(r.valor_meta);
        meta.valorRealizadoMensal = Number(r.valor_realizado);
      } else {
        const semana = r.semana as 1 | 2 | 3 | 4;
        meta.semanas.push({
          semana,
          rotulo: rotuloSemana(semana, ano, mes),
          valorMeta: Number(r.valor_meta),
          valorRealizado: Number(r.valor_realizado),
        });
      }
    }
    for (const meta of porVendedor.values()) {
      meta.semanas.sort((a, b) => a.semana - b.semana);
    }
    return Array.from(porVendedor.values());
  }

  // metas_mensal_unique/metas_semanal_unique são índices ÚNICOS PARCIAIS
  // (where semana is [not] null) — o on_conflict do PostgREST não infere
  // índice parcial (não dá pra mandar o WHERE junto), então upsert não
  // funciona aqui. Delete + insert é mais simples e sempre correto,
  // ainda que troque uma operação atômica por duas.
  async salvarMeta(profile: Profile, input: SalvarMetaInput): Promise<void> {
    const linhas: { tenant_id: string; codigo_vendedor: number; ano: number; mes: number; semana: number | null; valor_meta: number }[] = [
      { tenant_id: profile.tenantId, codigo_vendedor: input.codigoVendedor, ano: input.ano, mes: input.mes, semana: null, valor_meta: input.valorMetaMensal },
      ...input.valoresMetaSemanal.map((valor, i) => ({
        tenant_id: profile.tenantId,
        codigo_vendedor: input.codigoVendedor,
        ano: input.ano,
        mes: input.mes,
        semana: i + 1,
        valor_meta: valor,
      })),
    ];

    for (const linha of linhas) {
      let query = supabase
        .from('metas')
        .delete()
        .eq('codigo_vendedor', linha.codigo_vendedor)
        .eq('ano', linha.ano)
        .eq('mes', linha.mes);
      query = linha.semana === null ? query.is('semana', null) : query.eq('semana', linha.semana);
      const { error: deleteError } = await query;
      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase.from('metas').insert(linha);
      if (insertError) throw insertError;
    }
  }

  async getVendedoresAtivos(_profile: Profile): Promise<VendedorAtivo[]> {
    const { data, error } = await supabase.from('vw_vendedores_ativos').select('codigo, nome').order('nome');
    if (error) throw error;
    return (data ?? []).map((r) => ({ codigo: r.codigo, nome: r.nome }));
  }

  async getComissoesMensal(_profile: Profile, ano: number, mes: number): Promise<ComissaoMensal[]> {
    const [{ data, error }, { data: faixas, error: erroFaixas }] = await Promise.all([
      supabase.from('vw_metas_comissao').select('*').eq('ano', ano).eq('mes', mes),
      supabase.from('comissao_faixa_alcancada').select('codigo_vendedor, faixa_percentual').eq('ano', ano).eq('mes', mes),
    ]);
    if (error) throw error;
    if (erroFaixas) throw erroFaixas;

    const faixaPorVendedor = new Map((faixas ?? []).map((f) => [f.codigo_vendedor, Number(f.faixa_percentual)]));

    return (data ?? []).map((r) => ({
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
      ano,
      mes,
      valorMeta: Number(r.valor_meta),
      valorRealizado: Number(r.valor_realizado),
      percentualAtingido: Number(r.percentual_atingido ?? 0),
      margemBrutaValor: Number(r.margem_bruta_valor),
      percentualComissao: Number(r.percentual_comissao),
      comissaoValor: Number(r.comissao_valor),
      regraAplicada: r.regra_aplicada,
      detalheSemanas: (r.detalhe_semanas ?? null) as ComissaoMensal['detalheSemanas'],
      faixaAlcancada: faixaPorVendedor.get(r.codigo_vendedor) ?? null,
    }));
  }

  async getFaixasComissao(): Promise<FaixaComissao[]> {
    const { data, error } = await supabase
      .from('faixas_comissao')
      .select('percentual_meta_min, percentual_comissao')
      .order('percentual_meta_min', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      percentualMetaMin: Number(r.percentual_meta_min),
      percentualComissao: Number(r.percentual_comissao),
    }));
  }

  // RLS já resolve a diferença vendedor-vê-só-ativas vs gestor-vê-tudo
  // (ver "atividades_checklist: vendedor le as ativas" em
  // rls_policies.sql) — não precisa filtrar de novo aqui. Vínculo com
  // vendedor agora é join table (atividade_checklist_vendedores), não
  // coluna — embed do PostgREST traz os vínculos direto.
  async getAtividadesChecklist(_profile: Profile): Promise<AtividadeChecklist[]> {
    const { data, error } = await supabase
      .from('atividades_checklist')
      .select('id, titulo, horario, ativo, dias_semana, atividade_checklist_vendedores(codigo_vendedor, vendedores(nome))')
      .order('titulo');
    if (error) throw error;
    return (data ?? []).map((r: any) => {
      const vinculos = (r.atividade_checklist_vendedores ?? []) as {
        codigo_vendedor: number;
        vendedores: { nome: string } | null;
      }[];
      return {
        id: String(r.id),
        titulo: r.titulo,
        horario: r.horario,
        ativo: r.ativo,
        codigosVendedor: vinculos.map((v) => v.codigo_vendedor),
        nomesVendedores: vinculos.map((v) => v.vendedores?.nome ?? `Vendedor ${v.codigo_vendedor}`),
        diasSemana: r.dias_semana ?? [],
      };
    });
  }

  async salvarAtividadeChecklist(profile: Profile, input: {
    id?: string;
    titulo: string;
    horario: string | null;
    codigosVendedor: number[];
    diasSemana: number[];
  }): Promise<void> {
    const linha = {
      titulo: input.titulo,
      horario: input.horario,
      dias_semana: input.diasSemana,
    };

    let atividadeId: number;
    if (input.id) {
      atividadeId = Number(input.id);
      const { error } = await supabase.from('atividades_checklist').update(linha).eq('id', atividadeId);
      if (error) throw error;

      // substitui a lista de vendedores por completo — mesmo padrão de
      // campanha_produtos em salvarCampanha (mais simples e seguro do
      // que diffar item a item).
      const { error: deleteError } = await supabase
        .from('atividade_checklist_vendedores')
        .delete()
        .eq('atividade_id', atividadeId);
      if (deleteError) throw deleteError;
    } else {
      const { data, error } = await supabase
        .from('atividades_checklist')
        .insert({ ...linha, tenant_id: profile.tenantId })
        .select('id')
        .single();
      if (error || !data) throw error ?? new Error('Falha ao criar atividade.');
      atividadeId = data.id;
    }

    if (input.codigosVendedor.length > 0) {
      const { error } = await supabase.from('atividade_checklist_vendedores').insert(
        input.codigosVendedor.map((codigo) => ({ tenant_id: profile.tenantId, atividade_id: atividadeId, codigo_vendedor: codigo }))
      );
      if (error) throw error;
    }
  }

  async alternarAtividadeChecklist(id: string, ativo: boolean): Promise<void> {
    const { error } = await supabase.from('atividades_checklist').update({ ativo }).eq('id', id);
    if (error) throw error;
  }

  async excluirAtividadeChecklist(id: string): Promise<void> {
    const { error } = await supabase.from('atividades_checklist').delete().eq('id', id);
    if (error) throw error;
  }

  async getChecklistHoje(profile: Profile): Promise<ChecklistItemStatus[]> {
    const hojeIso = todayISO();
    // domingo=1 ... sábado=7 — mesma numeração de dias_semana (ver
    // schema.sql) e do expo-notifications, pra não converter em nenhum
    // dos dois lados.
    const diaDaSemanaHoje = new Date(`${hojeIso}T00:00:00`).getDay() + 1;
    // sem coluna codigo_vendedor pra filtrar direto na query (agora é
    // join table) — traz os vínculos de todo mundo (tabela pequena) e
    // filtra em JS: atividade sem NENHUM vínculo = "todos" (RLS já
    // restringe atividades_checklist pra só as ativas do vendedor).
    const [
      { data: atividades, error: erroAtividades },
      { data: vinculos, error: erroVinculos },
      { data: respostas, error: erroRespostas },
    ] = await Promise.all([
      supabase
        .from('atividades_checklist')
        .select('id, titulo, horario, ativo, dias_semana')
        .eq('ativo', true)
        .contains('dias_semana', [diaDaSemanaHoje])
        .order('titulo'),
      supabase.from('atividade_checklist_vendedores').select('atividade_id, codigo_vendedor'),
      supabase
        .from('checklist_respostas')
        .select('atividade_id, concluida')
        .eq('codigo_vendedor', profile.codigoVendedor)
        .eq('data', hojeIso),
    ]);
    if (erroAtividades) throw erroAtividades;
    if (erroVinculos) throw erroVinculos;
    if (erroRespostas) throw erroRespostas;

    const vendedoresPorAtividade = new Map<number, number[]>();
    for (const v of vinculos ?? []) {
      const lista = vendedoresPorAtividade.get(v.atividade_id) ?? [];
      lista.push(v.codigo_vendedor);
      vendedoresPorAtividade.set(v.atividade_id, lista);
    }

    const concluidaPorAtividade = new Map<number, boolean>((respostas ?? []).map((r) => [r.atividade_id, r.concluida]));

    return (atividades ?? [])
      .filter((a) => {
        const codigosVendedor = vendedoresPorAtividade.get(a.id) ?? [];
        return codigosVendedor.length === 0 || codigosVendedor.includes(profile.codigoVendedor ?? -1);
      })
      .map((a) => ({
        atividade: {
          id: String(a.id),
          titulo: a.titulo,
          horario: a.horario,
          ativo: a.ativo,
          codigosVendedor: vendedoresPorAtividade.get(a.id) ?? [],
          nomesVendedores: [],
          diasSemana: a.dias_semana ?? [],
        },
        concluida: concluidaPorAtividade.get(a.id) ?? false,
      }));
  }

  // atividade_id+codigo_vendedor+data é unique CONSTRAINT de verdade
  // (não índice parcial), então onConflict funciona normalmente aqui —
  // diferente de `metas` acima.
  async marcarChecklistItem(profile: Profile, atividadeId: string, concluida: boolean): Promise<void> {
    const hojeIso = todayISO();
    const { error } = await supabase.from('checklist_respostas').upsert(
      {
        tenant_id: profile.tenantId,
        atividade_id: Number(atividadeId),
        codigo_vendedor: profile.codigoVendedor,
        data: hojeIso,
        concluida,
        concluida_em: concluida ? new Date().toISOString() : null,
      },
      { onConflict: 'atividade_id,codigo_vendedor,data' }
    );
    if (error) throw error;
  }

  async getStatusSincronizacao(): Promise<StatusSincronizacao[]> {
    const { data, error } = await supabase.from('sync_control').select('entity_name, last_synced_at');
    if (error) throw error;
    return (data ?? []).map((r) => ({ entityName: r.entity_name, ultimaSincronizacao: r.last_synced_at }));
  }

  // produto_catalogo passa de 1000 linhas fácil (catálogo real tem 26
  // mil+ produtos) — sem paginar, o limite padrão do PostgREST corta
  // silenciosamente o resultado. Qualquer `select` direto numa tabela/
  // view grande (produto_catalogo, vw_venda_recente_produto,
  // vw_produto_fornecedor_recente) precisa passar por aqui, não só
  // getCatalogoProdutos (achado 03/08/2026, catalogado em
  // README.md#pendências-técnicas — varreu 5 métodos com o mesmo bug).
  private async buscarPaginado<T = any>(
    montarQuery: (inicio: number, fim: number) => PromiseLike<{ data: T[] | null; error: any }>
  ): Promise<T[]> {
    const TAMANHO_PAGINA = 1000;
    const linhas: T[] = [];
    for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
      const { data, error } = await montarQuery(inicio, inicio + TAMANHO_PAGINA - 1);
      if (error) throw error;
      linhas.push(...(data ?? []));
      if (!data || data.length < TAMANHO_PAGINA) break;
    }
    return linhas;
  }

  // "TAXA DE ENTREGA", "TAXA E-DELIVERY", "ENTREGA MANUAL" etc. são
  // linhas de serviço/taxa lançadas como produto no PDV (sem outro jeito
  // de cobrar frete pelo sistema) — não é catálogo de verdade: preço
  // simbólico, estoque sempre 0, nenhuma unidade de venda real por
  // trás. Confirmado com dados reais em 05/08/2026 (6 códigos, nenhum
  // grupo/categoria único cobre todos — 3 tinham categoria null e grupo
  // espalhado em CONVENIENCIA/LINHA GERAL/USO OU CONSUMO/CADASTRO
  // AUTOMATICO). Filtra por nome direto na query pra nunca aparecer em
  // catálogo, sugestão de campanha, compras ou precificação.
  private queryProdutoCatalogo(colunas: string) {
    return supabase
      .from('produto_catalogo')
      .select(colunas)
      .not('nome', 'ilike', '%ENTREGA%')
      .not('nome', 'ilike', '%DELIVERY%');
  }

  async getStatusWhatsApp(_profile: Profile): Promise<Record<number, boolean>> {
    const linhas = await this.buscarPaginado((inicio, fim) =>
      supabase
        .from('clientes')
        .select('codigo, tem_whatsapp')
        .not('tem_whatsapp', 'is', null)
        .order('codigo', { ascending: true })
        .range(inicio, fim)
    );
    const mapa: Record<number, boolean> = {};
    for (const r of linhas as { codigo: number; tem_whatsapp: boolean }[]) {
      mapa[r.codigo] = r.tem_whatsapp;
    }
    return mapa;
  }

  async getCatalogoProdutos(_profile: Profile): Promise<ProdutoCatalogo[]> {
    const linhas = await this.buscarPaginado((inicio, fim) =>
      this.queryProdutoCatalogo('*')
        .order('nome', { ascending: true })
        .order('codigo', { ascending: true })
        .range(inicio, fim)
    );
    return linhas.map((r: any) => mapearProdutoCatalogo(r));
  }

  async sugerirProdutosCampanha(profile: Profile, params: SugestaoCampanhaParams): Promise<ProdutoElegibilidade[]> {
    const [catalogoLinhas, vendaLinhas, campanhas] = await Promise.all([
      this.buscarPaginado((inicio, fim) =>
        this.queryProdutoCatalogo('*').order('codigo', { ascending: true }).range(inicio, fim)
      ),
      this.buscarPaginado((inicio, fim) =>
        supabase.from('vw_venda_recente_produto').select('*').order('codigo_produto', { ascending: true }).range(inicio, fim)
      ),
      this.getCampanhas(profile),
    ]);

    const catalogo = catalogoLinhas.map(mapearProdutoCatalogo);
    const vendaPorProduto = new Map(
      vendaLinhas.map((r: any) => [
        r.codigo_produto,
        { quantidadeVendida30d: Number(r.quantidade_vendida_30d), diasSemVenda: r.dias_sem_venda },
      ])
    );

    const hojeIso = todayISO();
    const codigosEmCampanhaAtiva = new Set(
      campanhas.filter((c) => c.dataFim >= hojeIso).flatMap((c) => c.produtos.map((p) => p.codigoProduto))
    );

    return sugerirCandidatos(catalogo, vendaPorProduto, params, codigosEmCampanhaAtiva);
  }

  async sugerirParesAfinidade(_profile: Profile, params: SugestaoKitsParams): Promise<SugestaoParAfinidade[]> {
    const catalogoLinhas = await this.buscarPaginado((inicio, fim) =>
      this.queryProdutoCatalogo('*').order('codigo', { ascending: true }).range(inicio, fim)
    );
    const catalogo = catalogoLinhas.map(mapearProdutoCatalogo);
    const codigosSeed = resolverCodigosSeed(catalogo, params.macroGrupo);
    if (codigosSeed.length === 0) return [];

    const { data, error } = await supabase.rpc('fn_sugerir_pares_afinidade', {
      p_codigos_seed: codigosSeed,
      p_dias: params.diasJanela ?? 120,
      p_min_co_ocorrencias: params.minCoOcorrencias ?? 8,
      p_lift_minimo: params.liftMinimo ?? 1.2,
    });
    if (error) throw error;

    const linhas = (data ?? []) as LinhaRpcAfinidade[];
    // catalogo já tem o produto_catalogo inteiro carregado acima (pra
    // resolver os códigos-semente) — reaproveita em vez de buscar de
    // novo só os códigos parceiros.
    const catalogoPorCodigo = new Map(catalogo.map((p) => [p.codigo, p]));
    return mapearSugestoesAfinidade(linhas, catalogoPorCodigo);
  }

  private async carregarCampanhas(filtroId?: number): Promise<Campanha[]> {
    let query = supabase
      .from('campanhas')
      .select(
        'id, nome, data_inicio, data_fim, created_at, campanha_produtos(codigo_produto, preco_promocional, percentual_desconto, quantidade_cartazes, data_inicio, data_fim, tipo_promocao, kit_quantidade_minima, kit_percentual_desconto_item, kit_preco_fixo), campanha_kits(id, nome, tipo_precificacao, percentual_desconto_item, preco_fixo, quantidade_cartazes, data_inicio, data_fim, campanha_kit_produtos(codigo_produto, quantidade))'
      )
      .order('created_at', { ascending: false });
    if (filtroId !== undefined) query = query.eq('id', filtroId);

    let desempenhoQuery = supabase.from('vw_campanhas_desempenho').select('campanha_id, quantidade_vendida, valor_vendido');
    if (filtroId !== undefined) desempenhoQuery = desempenhoQuery.eq('campanha_id', filtroId);

    const [{ data, error }, { data: desempenho, error: erroDesempenho }] = await Promise.all([query, desempenhoQuery]);
    if (error) throw error;
    if (erroDesempenho) throw erroDesempenho;
    const linhas = data ?? [];
    // view só tem linha pra campanha que já vendeu algo (join interno
    // com venda_itens) — sem entrada aqui = zero vendido, não erro.
    const desempenhoPorCampanha = new Map(
      (desempenho ?? []).map((d: any) => [d.campanha_id, { quantidade: Number(d.quantidade_vendida), valor: Number(d.valor_vendido) }])
    );

    // produto_catalogo dá nome/código de barras — campanha_produtos só
    // guarda o código. Só resolve isso quando filtroId está definido
    // (uma campanha específica, pra edição): a LISTA (filtroId
    // indefinido) não usa nome/código de barras, só quantidade e soma
    // de cartazes (ver CampanhasScreen) — buscar o catálogo inteiro
    // (paginado, milhares de produtos numa farmácia) em toda carga da
    // lista deixava a tela lenta à toa (achado 21/08/2026). Com
    // filtroId, busca só os códigos daquela campanha via `.in()` — uma
    // consulta rápida e direta, sem paginação.
    let catalogoPorCodigo = new Map<number, any>();
    if (filtroId !== undefined) {
      const codigos = [
        ...new Set([
          ...linhas.flatMap((c: any) => (c.campanha_produtos ?? []).map((cp: any) => cp.codigo_produto)),
          // kit multi-produto (02/09/2026) também precisa de
          // preco_venda/custo_medio ATUAIS (não dá pra derivar como em
          // campanha_produtos, já que percentual_desconto de kit é do
          // COMBO, não de um produto só).
          ...linhas.flatMap((c: any) =>
            (c.campanha_kits ?? []).flatMap((k: any) => (k.campanha_kit_produtos ?? []).map((kp: any) => kp.codigo_produto))
          ),
        ]),
      ];
      if (codigos.length > 0) {
        const { data: produtos, error: erroProdutos } = await this.queryProdutoCatalogo(
          'codigo, codigo_barras, nome, preco_venda, custo_medio'
        ).in('codigo', codigos);
        if (erroProdutos) throw erroProdutos;
        catalogoPorCodigo = new Map((produtos ?? []).map((p: any) => [p.codigo, p]));
      }
    }

    return linhas.map((c: any) => ({
      id: String(c.id),
      nome: c.nome,
      dataInicio: c.data_inicio,
      dataFim: c.data_fim,
      criadaEm: c.created_at,
      quantidadeVendida: desempenhoPorCampanha.get(c.id)?.quantidade ?? 0,
      valorVendido: desempenhoPorCampanha.get(c.id)?.valor ?? 0,
      produtos: (c.campanha_produtos ?? []).map((cp: any) => {
        const produto = catalogoPorCodigo.get(cp.codigo_produto);
        const percentualDesconto = Number(cp.percentual_desconto);
        const precoPromocional = Number(cp.preco_promocional);
        const precoRegular = percentualDesconto > 0 ? round2(precoPromocional / (1 - percentualDesconto / 100)) : precoPromocional;
        return {
          codigoProduto: cp.codigo_produto,
          // Vazio quando veio da lista (filtroId indefinido) — de
          // propósito, ver comentário acima. getCampanha resolve certo.
          codigoBarras: produto?.codigo_barras ?? '',
          nomeProduto: produto?.nome ?? (filtroId !== undefined ? `Produto ${cp.codigo_produto}` : ''),
          precoRegular,
          custoMedio: produto?.custo_medio != null ? Number(produto.custo_medio) : 0,
          precoPromocional,
          percentualDesconto,
          quantidadeCartazes: cp.quantidade_cartazes,
          // null = sem override — segue a validade da campanha (mesmo
          // espírito de precoRegular ser derivado, não uma cópia
          // congelada: campanha antiga muda de validade, item
          // não-customizado acompanha).
          dataInicio: cp.data_inicio ?? c.data_inicio,
          dataFim: cp.data_fim ?? c.data_fim,
          tipoPromocao: cp.tipo_promocao === 'kit' ? 'kit' : 'unitario',
          kit:
            cp.tipo_promocao === 'kit' && cp.kit_quantidade_minima != null
              ? {
                  quantidadeMinima: cp.kit_quantidade_minima,
                  tipoPrecificacao: cp.kit_preco_fixo != null ? 'preco_fixo' : 'percentual',
                  percentualDescontoItem: cp.kit_preco_fixo != null ? null : Number(cp.kit_percentual_desconto_item ?? 0),
                  precoFixo: cp.kit_preco_fixo != null ? Number(cp.kit_preco_fixo) : null,
                }
              : null,
        };
      }),
      kits: (c.campanha_kits ?? []).map((k: any) => ({
        id: String(k.id),
        nome: k.nome,
        tipoPrecificacao: k.tipo_precificacao,
        percentualDescontoItem: k.percentual_desconto_item != null ? Number(k.percentual_desconto_item) : null,
        precoFixo: k.preco_fixo != null ? Number(k.preco_fixo) : null,
        quantidadeCartazes: k.quantidade_cartazes,
        dataInicio: k.data_inicio ?? c.data_inicio,
        dataFim: k.data_fim ?? c.data_fim,
        produtos: (k.campanha_kit_produtos ?? []).map((kp: any) => {
          const produto = catalogoPorCodigo.get(kp.codigo_produto);
          return {
            codigoProduto: kp.codigo_produto,
            nomeProduto: produto?.nome ?? (filtroId !== undefined ? `Produto ${kp.codigo_produto}` : ''),
            quantidade: kp.quantidade,
            precoRegular: produto?.preco_venda != null ? Number(produto.preco_venda) : 0,
            custoMedio: produto?.custo_medio != null ? Number(produto.custo_medio) : 0,
          };
        }),
      })),
    }));
  }

  async getCampanhas(_profile: Profile): Promise<Campanha[]> {
    return this.carregarCampanhas();
  }

  // Fetch dedicado pra UMA campanha (usado na edição) — resolve nome
  // e código de barras de verdade, diferente da lista (ver
  // carregarCampanhas).
  async getCampanha(_profile: Profile, id: string): Promise<Campanha | null> {
    const [campanha] = await this.carregarCampanhas(Number(id));
    return campanha ?? null;
  }

  async salvarCampanha(profile: Profile, input: SalvarCampanhaInput): Promise<Campanha> {
    let campanhaId: number;

    if (input.id) {
      campanhaId = Number(input.id);
      const { error } = await supabase
        .from('campanhas')
        .update({ nome: input.nome, data_inicio: input.dataInicio, data_fim: input.dataFim })
        .eq('id', campanhaId);
      if (error) throw error;

      // substitui a lista de produtos por completo — mais simples e
      // seguro do que diffar item a item (a tela já manda a lista inteira).
      const { error: deleteError } = await supabase.from('campanha_produtos').delete().eq('campanha_id', campanhaId);
      if (deleteError) throw deleteError;

      // mesmo padrão pros kits multi-produto — on delete cascade em
      // campanha_kit_produtos.kit_id cuida de limpar os itens junto,
      // não precisa deletar essa tabela separado.
      const { error: deleteKitsError } = await supabase.from('campanha_kits').delete().eq('campanha_id', campanhaId);
      if (deleteKitsError) throw deleteKitsError;
    } else {
      const { data, error } = await supabase
        .from('campanhas')
        .insert({ tenant_id: profile.tenantId, nome: input.nome, data_inicio: input.dataInicio, data_fim: input.dataFim })
        .select('id')
        .single();
      if (error || !data) throw error ?? new Error('Falha ao criar campanha.');
      campanhaId = data.id;
    }

    if (input.produtos.length > 0) {
      const { error } = await supabase.from('campanha_produtos').insert(
        input.produtos.map((p) => ({
          tenant_id: profile.tenantId,
          campanha_id: campanhaId,
          codigo_produto: p.codigoProduto,
          preco_promocional: p.precoPromocional,
          percentual_desconto: p.percentualDesconto,
          quantidade_cartazes: p.quantidadeCartazes,
          // Só grava override se o item realmente diverge da validade
          // da campanha — igual vira null, e assim continua seguindo a
          // campanha automaticamente se ela mudar de data depois.
          data_inicio: p.dataInicio === input.dataInicio ? null : p.dataInicio,
          data_fim: p.dataFim === input.dataFim ? null : p.dataFim,
          tipo_promocao: p.tipoPromocao,
          kit_quantidade_minima: p.tipoPromocao === 'kit' ? p.kit?.quantidadeMinima ?? null : null,
          kit_percentual_desconto_item:
            p.tipoPromocao === 'kit' && p.kit?.tipoPrecificacao === 'percentual' ? p.kit?.percentualDescontoItem ?? null : null,
          kit_preco_fixo: p.tipoPromocao === 'kit' && p.kit?.tipoPrecificacao === 'preco_fixo' ? p.kit?.precoFixo ?? null : null,
        }))
      );
      if (error) throw error;
    }

    if (input.kits.length > 0) {
      const { data: kitsInseridos, error: erroKits } = await supabase
        .from('campanha_kits')
        .insert(
          input.kits.map((k) => ({
            tenant_id: profile.tenantId,
            campanha_id: campanhaId,
            nome: k.nome,
            tipo_precificacao: k.tipoPrecificacao,
            percentual_desconto_item: k.tipoPrecificacao === 'percentual' ? k.percentualDescontoItem : null,
            preco_fixo: k.tipoPrecificacao === 'preco_fixo' ? k.precoFixo : null,
            quantidade_cartazes: k.quantidadeCartazes,
            data_inicio: k.dataInicio === input.dataInicio ? null : k.dataInicio,
            data_fim: k.dataFim === input.dataFim ? null : k.dataFim,
          }))
        )
        .select('id');
      if (erroKits) throw erroKits;

      // Ids voltam na mesma ordem que foram inseridos — usa isso pra
      // ligar cada kit salvo aos seus produtos sem precisar de mais um
      // round-trip pra descobrir o id de cada um.
      const itensKitProdutos = (kitsInseridos ?? []).flatMap((kitSalvo: any, indice: number) =>
        input.kits[indice].produtos.map((p) => ({
          tenant_id: profile.tenantId,
          kit_id: kitSalvo.id,
          codigo_produto: p.codigoProduto,
          quantidade: p.quantidade,
        }))
      );
      if (itensKitProdutos.length > 0) {
        const { error: erroKitProdutos } = await supabase.from('campanha_kit_produtos').insert(itensKitProdutos);
        if (erroKitProdutos) throw erroKitProdutos;
      }
    }

    const [salva] = await this.carregarCampanhas(campanhaId);
    if (!salva) throw new Error('Campanha salva mas não encontrada ao recarregar.');
    return salva;
  }

  async excluirCampanha(id: string): Promise<void> {
    const { error } = await supabase.from('campanhas').delete().eq('id', Number(id));
    if (error) throw error;
  }

  private async carregarCampanhasVendaAdicional(filtroId?: number): Promise<CampanhaVendaAdicional[]> {
    let query = supabase
      .from('campanhas_venda_adicional')
      .select(
        'id, nome, data_inicio, data_fim, tipo_premiacao, criterio_quantidade, meta_quantidade, premiacao_meta_valor, premiacao_ranking, minimo_para_concorrer, horario_lembrete, campanha_venda_adicional_produtos(codigo_produto)'
      )
      .order('criada_em', { ascending: false });
    if (filtroId !== undefined) query = query.eq('id', filtroId);

    const { data, error } = await query;
    if (error) throw error;

    const catalogo = await this.buscarPaginado((inicio, fim) =>
      this.queryProdutoCatalogo('codigo, nome').order('codigo', { ascending: true }).range(inicio, fim)
    );
    const nomePorCodigo = new Map(catalogo.map((p: any) => [p.codigo, p.nome]));

    return (data ?? []).map((c: any) => ({
      id: String(c.id),
      nome: c.nome,
      dataInicio: c.data_inicio,
      dataFim: c.data_fim,
      tipoPremiacao: c.tipo_premiacao,
      criterioQuantidade: c.criterio_quantidade,
      metaQuantidade: c.meta_quantidade,
      premiacaoMetaValor: c.premiacao_meta_valor != null ? Number(c.premiacao_meta_valor) : null,
      premiacaoRanking: c.premiacao_ranking,
      minimoParaConcorrer: c.minimo_para_concorrer,
      horarioLembrete: c.horario_lembrete,
      produtos: (c.campanha_venda_adicional_produtos ?? []).map((p: any) => ({
        codigoProduto: p.codigo_produto,
        nomeProduto: nomePorCodigo.get(p.codigo_produto) ?? `Produto ${p.codigo_produto}`,
      })),
    }));
  }

  async getCampanhasVendaAdicional(_profile: Profile): Promise<CampanhaVendaAdicional[]> {
    return this.carregarCampanhasVendaAdicional();
  }

  async salvarCampanhaVendaAdicional(profile: Profile, input: SalvarCampanhaVendaAdicionalInput): Promise<void> {
    let campanhaId: number;

    const payload = {
      tenant_id: profile.tenantId,
      nome: input.nome,
      data_inicio: input.dataInicio,
      data_fim: input.dataFim,
      tipo_premiacao: input.tipoPremiacao,
      criterio_quantidade: input.criterioQuantidade,
      meta_quantidade: input.metaQuantidade,
      premiacao_meta_valor: input.premiacaoMetaValor,
      premiacao_ranking: input.premiacaoRanking,
      minimo_para_concorrer: input.minimoParaConcorrer,
      horario_lembrete: input.horarioLembrete,
    };

    if (input.id) {
      campanhaId = Number(input.id);
      const { error } = await supabase.from('campanhas_venda_adicional').update(payload).eq('id', campanhaId);
      if (error) throw error;

      // substitui a lista de produtos por completo — mais simples do
      // que diffar item a item (a tela já manda a lista inteira).
      const { error: deleteError } = await supabase
        .from('campanha_venda_adicional_produtos')
        .delete()
        .eq('campanha_id', campanhaId);
      if (deleteError) throw deleteError;
    } else {
      const { data, error } = await supabase.from('campanhas_venda_adicional').insert(payload).select('id').single();
      if (error || !data) throw error ?? new Error('Falha ao criar campanha de venda adicional.');
      campanhaId = data.id;
    }

    if (input.codigosProduto.length > 0) {
      const { error } = await supabase
        .from('campanha_venda_adicional_produtos')
        .insert(input.codigosProduto.map((codigoProduto) => ({ tenant_id: profile.tenantId, campanha_id: campanhaId, codigo_produto: codigoProduto })));
      if (error) throw error;
    }
  }

  async excluirCampanhaVendaAdicional(id: string): Promise<void> {
    const { error } = await supabase.from('campanhas_venda_adicional').delete().eq('id', Number(id));
    if (error) throw error;
  }

  async getVendasVendaAdicional(_profile: Profile, campanhaId: string): Promise<VendaVendaAdicional[]> {
    const { data, error } = await supabase
      .from('vw_venda_adicional_vendas')
      .select('*')
      .eq('campanha_id', Number(campanhaId));
    if (error) throw error;

    return (data ?? []).map((r) => ({
      itemId: String(r.venda_item_id),
      vendaId: String(r.venda_id),
      numeroNota: r.numero_nota,
      campanhaId: String(r.campanha_id),
      dataVenda: r.data_emissao,
      horaVenda: r.hora_emissao,
      codigoProduto: r.codigo_produto,
      nomeProduto: r.nome_produto,
      quantidade: Number(r.quantidade),
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor,
      codigoCliente: r.codigo_cliente,
      nomeCliente: r.nome_cliente,
      qtdItensNaVenda: Number(r.qtd_itens_na_venda),
      outrosProdutosNaVenda: r.outros_produtos_na_venda,
      valor: Number(r.valor ?? 0),
    }));
  }

  async getItensVendaComplementarDia(
    _profile: Profile,
    data: string,
    codigoVendedor: number
  ): Promise<ItemVendaComplementar[]> {
    const { data: linhas, error } = await supabase
      .from('venda_itens')
      .select(
        'id, venda_id, codigo_produto, valor_total_liquido, codigo_vendedor, ' +
          'vendedores(nome), ' +
          'vendas!inner(numero_nota, data_emissao, codigo_cliente, clientes(nome))'
      )
      .eq('codigo_vendedor', codigoVendedor)
      .eq('vendas.data_emissao', data)
      .order('id', { ascending: true });
    if (error) throw error;

    const linhasArr = (linhas ?? []) as any[];

    // Marcação buscada à parte (não embutida no select acima): RLS em
    // embed aninhado (child(id) dentro do select da tabela pai) não é
    // confiável — voltava sempre vazio pro gestor mesmo com a linha
    // existindo, a marcação "sumia" ao reabrir mesmo já salva (achado
    // 18/08/2026). Consulta direta na tabela, mesmo padrão já usado em
    // salvarVendasComplementaresDia, funciona.
    const idsItens = linhasArr.map((r) => Number(r.id));
    let idsMarcados = new Set<number>();
    if (idsItens.length > 0) {
      const { data: marcas, error: erroMarcas } = await supabase
        .from('venda_item_complementar')
        .select('venda_item_id')
        .in('venda_item_id', idsItens);
      if (erroMarcas) throw erroMarcas;
      // Number(...) explícito — bigint costuma vir como STRING do
      // PostgREST (evita perda de precisão), então "as number" (só
      // tipagem, não converte nada em runtime) deixava a comparação no
      // Set falhando silenciosamente sempre que os dois lados vinham
      // com tipos diferentes (achado 18/08/2026).
      idsMarcados = new Set((marcas ?? []).map((m: any) => Number(m.venda_item_id)));
    }

    const codigosProduto = [...new Set(linhasArr.map((r) => r.codigo_produto))];
    let nomePorCodigo = new Map<number, string>();
    if (codigosProduto.length > 0) {
      const { data: produtos, error: erroProdutos } = await supabase
        .from('produto_catalogo')
        .select('codigo, nome')
        .in('codigo', codigosProduto);
      if (erroProdutos) throw erroProdutos;
      nomePorCodigo = new Map((produtos ?? []).map((p: any) => [p.codigo, p.nome]));
    }

    return linhasArr.map((r) => ({
      itemId: String(r.id),
      vendaId: String(r.venda_id),
      numeroNota: r.vendas?.numero_nota ?? null,
      dataVenda: r.vendas?.data_emissao ?? data,
      codigoProduto: r.codigo_produto,
      nomeProduto: nomePorCodigo.get(r.codigo_produto) ?? `Produto ${r.codigo_produto}`,
      valor: Number(r.valor_total_liquido ?? 0),
      codigoCliente: r.vendas?.codigo_cliente ?? null,
      nomeCliente: r.vendas?.clientes?.nome ?? null,
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.vendedores?.nome ?? `Vendedor ${r.codigo_vendedor}`,
      marcado: idsMarcados.has(Number(r.id)),
    }));
  }

  async salvarVendasComplementaresDia(
    profile: Profile,
    data: string,
    codigoVendedor: number,
    itemIdsMarcados: string[]
  ): Promise<void> {
    // universo de itens desse vendedor nesse dia — decide o que
    // desmarcar (tudo que está fora da lista marcada agora).
    const { data: linhas, error: erroLinhas } = await supabase
      .from('venda_itens')
      .select('id, vendas!inner(data_emissao)')
      .eq('codigo_vendedor', codigoVendedor)
      .eq('vendas.data_emissao', data);
    if (erroLinhas) throw erroLinhas;

    const idsDoContexto = (linhas ?? []).map((r: any) => r.id as number);
    const idsMarcadosNum = new Set(itemIdsMarcados.map(Number));
    const idsParaDesmarcar = idsDoContexto.filter((id) => !idsMarcadosNum.has(id));

    if (idsParaDesmarcar.length > 0) {
      const { error } = await supabase.from('venda_item_complementar').delete().in('venda_item_id', idsParaDesmarcar);
      if (error) throw error;
    }

    // Só insere quem AINDA não tem linha — reenviar um item já marcado
    // não deve tocar a linha existente. Upsert com onConflict faria um
    // UPDATE no conflito, e não existe policy de UPDATE nessa tabela
    // (existência da linha já É o "marcado", nunca precisa atualizar
    // uma linha existente) — sem a policy o UPDATE é bloqueado pela
    // RLS e a marcação "sumia" ao reabrir depois de marcar de novo
    // (achado 18/08/2026).
    let idsParaInserir: number[] = [];
    if (idsMarcadosNum.size > 0) {
      const { data: jaMarcados, error: erroJaMarcados } = await supabase
        .from('venda_item_complementar')
        .select('venda_item_id')
        .in('venda_item_id', [...idsMarcadosNum]);
      if (erroJaMarcados) throw erroJaMarcados;
      const idsJaMarcados = new Set((jaMarcados ?? []).map((r: any) => r.venda_item_id as number));
      idsParaInserir = [...idsMarcadosNum].filter((id) => !idsJaMarcados.has(id));
    }

    if (idsParaInserir.length > 0) {
      const { error } = await supabase.from('venda_item_complementar').insert(
        idsParaInserir.map((venda_item_id) => ({
          tenant_id: profile.tenantId,
          venda_item_id,
          codigo_vendedor: codigoVendedor,
          marcado_por: profile.id,
        }))
      );
      if (error) throw error;
    }
  }

  async getCampanhasComplementares(_profile: Profile): Promise<CampanhaComplementar[]> {
    const { data, error } = await supabase
      .from('campanhas_complementares')
      .select('id, data_inicio, data_fim, valor_minimo, quantidade_minima, meta_clientes_ofertados_dia, premiacao_ranking')
      .order('data_inicio', { ascending: false });
    if (error) throw error;

    return (data ?? []).map((c: any) => ({
      id: String(c.id),
      dataInicio: c.data_inicio,
      dataFim: c.data_fim,
      valorMinimo: c.valor_minimo != null ? Number(c.valor_minimo) : null,
      quantidadeMinima: c.quantidade_minima != null ? Number(c.quantidade_minima) : null,
      metaClientesOfertadosDia: c.meta_clientes_ofertados_dia != null ? Number(c.meta_clientes_ofertados_dia) : null,
      premiacaoRanking: c.premiacao_ranking ?? [],
    }));
  }

  async salvarCampanhaComplementar(profile: Profile, input: SalvarCampanhaComplementarInput): Promise<void> {
    const payload = {
      tenant_id: profile.tenantId,
      data_inicio: input.dataInicio,
      data_fim: input.dataFim,
      valor_minimo: input.valorMinimo,
      quantidade_minima: input.quantidadeMinima,
      meta_clientes_ofertados_dia: input.metaClientesOfertadosDia,
      premiacao_ranking: input.premiacaoRanking,
    };

    if (input.id) {
      const { error } = await supabase.from('campanhas_complementares').update(payload).eq('id', Number(input.id));
      if (error) throw error;
    } else {
      const { error } = await supabase.from('campanhas_complementares').insert(payload);
      if (error) throw error;
    }
  }

  async excluirCampanhaComplementar(id: string): Promise<void> {
    const { error } = await supabase.from('campanhas_complementares').delete().eq('id', Number(id));
    if (error) throw error;
  }

  async getVendasComplementaresCampanha(_profile: Profile, campanhaId: string): Promise<VendaComplementarMarcada[]> {
    const { data: campanhaRow, error: erroCampanha } = await supabase
      .from('campanhas_complementares')
      .select('data_inicio, data_fim')
      .eq('id', Number(campanhaId))
      .single();
    if (erroCampanha || !campanhaRow) throw erroCampanha ?? new Error('Campanha não encontrada.');

    const { data, error } = await supabase
      .from('vw_venda_complementar_marcada')
      .select('*')
      .gte('data_emissao', campanhaRow.data_inicio)
      .lte('data_emissao', campanhaRow.data_fim);
    if (error) throw error;

    const linhas = (data ?? []) as any[];
    // codigo_produto não tem FK formal pra produto_catalogo (mesmo
    // caso de getItensVendaComplementarDia) — busca os nomes à parte.
    const codigosProduto = [...new Set(linhas.map((r) => r.codigo_produto))];
    let nomePorCodigo = new Map<number, string>();
    if (codigosProduto.length > 0) {
      const { data: produtos, error: erroProdutos } = await supabase
        .from('produto_catalogo')
        .select('codigo, nome')
        .in('codigo', codigosProduto);
      if (erroProdutos) throw erroProdutos;
      nomePorCodigo = new Map((produtos ?? []).map((p: any) => [p.codigo, p.nome]));
    }

    return linhas.map((r) => ({
      itemId: String(r.venda_item_id),
      vendaId: String(r.venda_id),
      dataVenda: r.data_emissao,
      valor: Number(r.valor ?? 0),
      codigoVendedor: r.codigo_vendedor,
      nomeVendedor: r.nome_vendedor ?? `Vendedor ${r.codigo_vendedor}`,
      nomeProduto: nomePorCodigo.get(r.codigo_produto) ?? `Produto ${r.codigo_produto}`,
    }));
  }

  async getOfertaComplementarDia(_profile: Profile, data: string, codigoVendedor: number): Promise<number> {
    const { data: linha, error } = await supabase
      .from('venda_complementar_oferta_diaria')
      .select('clientes_ofertados')
      .eq('codigo_vendedor', codigoVendedor)
      .eq('data', data)
      .maybeSingle();
    if (error) throw error;
    return linha?.clientes_ofertados ?? 0;
  }

  async salvarOfertaComplementarDia(
    profile: Profile,
    data: string,
    codigoVendedor: number,
    clientesOfertados: number
  ): Promise<void> {
    // Diferente de venda_item_complementar: aqui o VALOR muda entre
    // saves do mesmo dia, então upsert com update de verdade é correto
    // (a tabela tem policy de UPDATE, ver rls_policies.sql).
    const { error } = await supabase.from('venda_complementar_oferta_diaria').upsert(
      {
        tenant_id: profile.tenantId,
        codigo_vendedor: codigoVendedor,
        data,
        clientes_ofertados: clientesOfertados,
        atualizado_por: profile.id,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,codigo_vendedor,data' }
    );
    if (error) throw error;
  }

  async getOfertaComplementarPeriodo(
    _profile: Profile,
    dataInicio: string,
    dataFim: string
  ): Promise<OfertaComplementarDia[]> {
    const { data, error } = await supabase
      .from('venda_complementar_oferta_diaria')
      .select('codigo_vendedor, data, clientes_ofertados')
      .gte('data', dataInicio)
      .lte('data', dataFim);
    if (error) throw error;

    return (data ?? []).map((r) => ({
      codigoVendedor: r.codigo_vendedor,
      data: r.data,
      clientesOfertados: r.clientes_ofertados,
    }));
  }

  async getProdutosEmFalta(_profile: Profile): Promise<ProdutoEmFalta[]> {
    // vw_produtos_em_falta (não a tabela direto): resolve quem
    // registrou, mas só devolve nome_registrado_por pra quem está
    // logado como gestor — decidido dentro da própria view.
    const { data, error } = await supabase
      .from('vw_produtos_em_falta')
      .select('id, nome_produto, codigo_produto, data, tem_saldo_estoque, nome_registrado_por')
      .order('data', { ascending: false });
    if (error) throw error;

    return (data ?? []).map((r) => ({
      id: String(r.id),
      nomeProduto: r.nome_produto,
      codigoProduto: r.codigo_produto,
      data: r.data,
      temSaldoEstoque: r.tem_saldo_estoque,
      nomeRegistradoPor: r.nome_registrado_por,
    }));
  }

  async salvarProdutoEmFalta(profile: Profile, input: SalvarProdutoEmFaltaInput): Promise<void> {
    if (input.id) {
      const { error } = await supabase
        .from('produtos_em_falta')
        .update({
          nome_produto: input.nomeProduto,
          codigo_produto: input.codigoProduto,
          data: input.data,
          tem_saldo_estoque: input.temSaldoEstoque,
        })
        .eq('id', Number(input.id));
      if (error) throw error;
    } else {
      const { data: sessao } = await supabase.auth.getUser();
      const { error } = await supabase.from('produtos_em_falta').insert({
        tenant_id: profile.tenantId,
        nome_produto: input.nomeProduto,
        codigo_produto: input.codigoProduto,
        data: input.data,
        tem_saldo_estoque: input.temSaldoEstoque,
        registrado_por: sessao.user?.id ?? null,
      });
      if (error) throw error;
    }
  }

  async excluirProdutoEmFalta(id: string): Promise<void> {
    const { error } = await supabase.from('produtos_em_falta').delete().eq('id', Number(id));
    if (error) throw error;
  }

  async gerarRelatorioFaltas(profile: Profile): Promise<ItemRelatorioFalta[]> {
    const faltas = await this.getProdutosEmFalta(profile);
    const codigos = [...new Set(faltas.map((f) => f.codigoProduto).filter((c): c is number => c != null))];

    const [catalogoLinhas, fornecedorLinhas] = codigos.length
      ? await Promise.all([
          this.queryProdutoCatalogo('codigo, codigo_barras, custo_medio').in('codigo', codigos),
          supabase.from('vw_produto_fornecedor_recente').select('codigo_produto, nome_fornecedor').in('codigo_produto', codigos),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (catalogoLinhas.error) throw catalogoLinhas.error;
    if (fornecedorLinhas.error) throw fornecedorLinhas.error;

    const catalogoPorCodigo = new Map((catalogoLinhas.data ?? []).map((r: any) => [r.codigo, r]));
    const fornecedorPorCodigo = new Map((fornecedorLinhas.data ?? []).map((r: any) => [r.codigo_produto, r.nome_fornecedor]));

    return faltas.map((f) => {
      const cat = f.codigoProduto != null ? catalogoPorCodigo.get(f.codigoProduto) : null;
      return {
        id: f.id,
        nomeProduto: f.nomeProduto,
        codigoProduto: f.codigoProduto,
        codigoBarras: cat?.codigo_barras ?? null,
        custoMedio: cat ? Number(cat.custo_medio) : null,
        fornecedorSugerido: f.codigoProduto != null ? fornecedorPorCodigo.get(f.codigoProduto) ?? null : null,
        data: f.data,
        nomeRegistradoPor: f.nomeRegistradoPor,
        temSaldoEstoque: f.temSaldoEstoque,
      };
    });
  }

  async limparProdutosEmFalta(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await supabase.from('produtos_em_falta').delete().in('id', ids.map(Number));
    if (error) throw error;
  }

  // vw_pendencias resolve nome_registrado_por pra qualquer um (sem
  // máscara de gestor) — só as ATIVAS (baixada=false), "dar baixa" some
  // da lista sem apagar a linha.
  async getPendencias(_profile: Profile): Promise<Pendencia[]> {
    const { data, error } = await supabase
      .from('vw_pendencias')
      .select('*')
      .eq('baixada', false)
      .order('data', { ascending: false });
    if (error) throw error;

    const linhas = data ?? [];
    const paths = [...new Set(linhas.map((r) => r.foto_url).filter((p): p is string => !!p))];
    const urlPorPath = new Map<string, string>();
    if (paths.length > 0) {
      const { data: assinadas } = await supabase.storage.from('pendencias').createSignedUrls(paths, 60 * 60);
      for (const item of assinadas ?? []) {
        if (item.path && item.signedUrl) urlPorPath.set(item.path, item.signedUrl);
      }
    }

    return linhas.map((r) => ({
      id: String(r.id),
      nomeCliente: r.nome_cliente,
      produtos: r.produtos,
      fotoUrl: r.foto_url ? urlPorPath.get(r.foto_url) ?? null : null,
      data: r.data,
      baixada: r.baixada,
      baixadaEm: r.baixada_em,
      nomeRegistradoPor: r.nome_registrado_por,
    }));
  }

  async salvarPendencia(profile: Profile, input: SalvarPendenciaInput): Promise<void> {
    // path com nome único (timestamp + sufixo aleatório) em vez de
    // codigo_vendedor/id como em receitas — aqui não existe id ainda
    // (registro novo) nem "dono da venda", então não tem por que
    // organizar em pasta.
    const path = `${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
    const arrayBuffer = await lerFotoComoArrayBuffer(input.fotoUri);
    const { error: uploadError } = await supabase.storage.from('pendencias').upload(path, arrayBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: sessao } = await supabase.auth.getUser();
    const { error } = await supabase.from('pendencias').insert({
      tenant_id: profile.tenantId,
      nome_cliente: input.nomeCliente,
      produtos: input.produtos,
      foto_url: path,
      data: todayISO(),
      registrado_por: sessao.user?.id ?? null,
    });
    if (error) throw error;
  }

  async darBaixaPendencia(id: string): Promise<void> {
    const { data: sessao } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('pendencias')
      .update({ baixada: true, baixada_em: new Date().toISOString(), baixada_por: sessao.user?.id ?? null })
      .eq('id', Number(id));
    if (error) throw error;
  }

  async gerarSugestaoCompras(_profile: Profile, params: ParametrosCompra): Promise<SugestaoCompra[]> {
    // Demanda vem de fn_venda_periodo_produto(dias), parametrizada pelo
    // "Base de vendas p/ cálculo" da tela — diferente de
    // vw_venda_recente_produto (janela FIXA de 30 dias, usada pelas
    // outras telas). Sem isso, digitar qualquer valor diferente de 30
    // nesse campo só mudava o divisor da média diária, não os dias de
    // venda considerados — dava demanda/quantidade sugerida erradas
    // (achado 10/08/2026).
    const diasBase = Math.max(1, Math.round(params.diasBaseVenda));
    const [catalogoLinhas, vendaLinhas, fornecedorLinhas, fornecedorMaisBaratoLinhas, classificacoesLinhas] = await Promise.all([
      this.buscarPaginado((inicio, fim) =>
        this.queryProdutoCatalogo('*').order('codigo', { ascending: true }).range(inicio, fim)
      ),
      this.buscarPaginado((inicio, fim) =>
        supabase
          .rpc('fn_venda_periodo_produto', { dias: diasBase })
          .order('codigo_produto', { ascending: true })
          .range(inicio, fim)
      ),
      this.buscarPaginado((inicio, fim) =>
        supabase.from('vw_produto_fornecedor_recente').select('*').order('codigo_produto', { ascending: true }).range(inicio, fim)
      ),
      this.buscarPaginado((inicio, fim) =>
        supabase
          .from('vw_produto_fornecedor_mais_barato')
          .select('*')
          .order('codigo_produto', { ascending: true })
          .range(inicio, fim)
      ),
      // Classificados em lote (18/08/2026, "não vou comprar esse
      // produto porque já resolvi de outro jeito") não voltam a
      // aparecer na sugestão até alguém remover a classificação.
      this.buscarPaginado((inicio, fim) =>
        supabase.from('compras_classificacoes').select('codigo_produto').range(inicio, fim)
      ),
    ]);

    const catalogo = catalogoLinhas.map(mapearProdutoCatalogo);
    const demandaPorProduto = new Map(
      vendaLinhas.map((r: any) => [r.codigo_produto, { quantidadeVendidaPeriodo: Number(r.quantidade_vendida) }])
    );
    const fornecedorPorProduto = new Map(
      fornecedorLinhas.map((r: any) => [
        r.codigo_produto,
        { fatorCompra: r.fator_compra, nomeFornecedor: r.nome_fornecedor },
      ])
    );
    const fornecedorMaisBaratoPorProduto = new Map(
      fornecedorMaisBaratoLinhas.map((r: any) => [
        r.codigo_produto,
        { nomeFornecedor: r.nome_fornecedor, precoCusto: Number(r.valor_custo) },
      ])
    );
    const codigosClassificados = new Set(classificacoesLinhas.map((r: any) => r.codigo_produto));

    const sugestoes = calcularSugestaoCompras(catalogo, demandaPorProduto, fornecedorPorProduto, fornecedorMaisBaratoPorProduto, params);
    return sugestoes.filter((s) => !codigosClassificados.has(s.codigoProduto));
  }

  async classificarItensCompra(
    profile: Profile,
    codigosProduto: number[],
    motivo: MotivoClassificacaoCompra,
    observacao?: string
  ): Promise<void> {
    if (codigosProduto.length === 0) return;
    const { data: sessao } = await supabase.auth.getUser();
    const linhas = codigosProduto.map((codigo) => ({
      tenant_id: profile.tenantId,
      codigo_produto: codigo,
      motivo,
      observacao: observacao ?? null,
      classificado_em: new Date().toISOString(),
      classificado_por: sessao.user?.id ?? null,
    }));
    // upsert (não insert): reclassificar um produto já classificado
    // substitui a linha em vez de dar erro de unique constraint.
    const { error } = await supabase.from('compras_classificacoes').upsert(linhas, { onConflict: 'tenant_id,codigo_produto' });
    if (error) throw error;
  }

  async getClassificacoesCompra(_profile: Profile): Promise<ItemClassificacaoCompra[]> {
    const linhas = await this.buscarPaginado((inicio, fim) =>
      supabase.from('vw_compras_classificacoes').select('*').order('classificado_em', { ascending: false }).range(inicio, fim)
    );
    return linhas.map((r: any) => ({
      id: String(r.id),
      codigoProduto: r.codigo_produto,
      nomeProduto: r.nome_produto,
      motivo: r.motivo,
      observacao: r.observacao,
      classificadoEm: r.classificado_em,
      nomeClassificadoPor: r.nome_classificado_por,
    }));
  }

  async removerClassificacaoCompra(codigoProduto: number): Promise<void> {
    const { error } = await supabase.from('compras_classificacoes').delete().eq('codigo_produto', codigoProduto);
    if (error) throw error;
  }

  async getEstoqueZeradoGiroAlto(profile: Profile): Promise<ItemEstoqueZeradoGiroAlto[]> {
    const [catalogo, vendaLinhas, classificacoesLinhas] = await Promise.all([
      this.getCatalogoProdutos(profile),
      this.buscarPaginado((inicio, fim) =>
        supabase.from('vw_venda_recente_produto').select('*').order('codigo_produto', { ascending: true }).range(inicio, fim)
      ),
      this.buscarPaginado((inicio, fim) =>
        supabase.from('compras_classificacoes').select('codigo_produto').range(inicio, fim)
      ),
    ]);

    const vendaPorProduto = new Map(
      vendaLinhas.map((r: any) => [
        r.codigo_produto,
        { quantidadeVendida30d: Number(r.quantidade_vendida_30d), diasSemVenda: r.dias_sem_venda },
      ])
    );
    const codigosClassificados = new Set(classificacoesLinhas.map((r: any) => r.codigo_produto));

    return calcularEstoqueZeradoGiroAlto(catalogo, vendaPorProduto).filter(
      (item) => !codigosClassificados.has(item.codigoProduto)
    );
  }

  async getRelatorioPrecificacao(profile: Profile): Promise<ItemPrecificacao[]> {
    const [catalogoLinhas, vendaLinhas, campanhas] = await Promise.all([
      // estoque_atual > 0: produto zerado não é candidato a reajuste de
      // preço (sem estoque, ajustar preço não faz sentido — isso é
      // assunto da aba Compras, não Precificação).
      this.buscarPaginado((inicio, fim) =>
        this.queryProdutoCatalogo('*').gt('estoque_atual', 0).order('codigo', { ascending: true }).range(inicio, fim)
      ),
      this.buscarPaginado((inicio, fim) =>
        supabase.from('vw_venda_recente_produto').select('*').order('codigo_produto', { ascending: true }).range(inicio, fim)
      ),
      this.getCampanhas(profile),
    ]);

    const catalogo = catalogoLinhas.map(mapearProdutoCatalogo);
    const vendaPorProduto = new Map(
      vendaLinhas.map((r: any) => [
        r.codigo_produto,
        { quantidadeVendida30d: Number(r.quantidade_vendida_30d), diasSemVenda: r.dias_sem_venda },
      ])
    );

    const hojeIso = todayISO();
    const codigosComDescontoAtivo = new Set(
      campanhas.filter((c) => c.dataFim >= hojeIso).flatMap((c) => c.produtos.map((p) => p.codigoProduto))
    );

    return calcularRelatorioPrecificacao(catalogo, vendaPorProduto, codigosComDescontoAtivo);
  }

  async getMetricasMensais(profile: Profile, mesReferencia: string, ateData?: string): Promise<MetricaMensal[]> {
    const hoje = new Date();
    const mesAtualIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;

    // Mês em andamento (ou pedido explícito de recorte via ateData —
    // usado pra comparar "mesmo período do mês anterior", ver
    // RelatorioMensalScreen): não tem linha congelada em
    // metricas_mensais que sirva, calcula na hora via RPC, mesma
    // função que o fechamento usa (calcular_metricas_mes).
    if (mesReferencia === mesAtualIso || ateData) {
      const { data, error } = await supabase.rpc('calcular_metricas_mes', {
        p_tenant_id: profile.tenantId,
        mes_ref: mesReferencia,
        data_fim: ateData ?? null,
      });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        mesReferencia,
        codigoVendedor: r.codigo_vendedor,
        chave: r.chave,
        valor: Number(r.valor),
      }));
    }

    const { data, error } = await supabase
      .from('metricas_mensais')
      .select('mes_referencia, codigo_vendedor, chave, valor')
      .eq('mes_referencia', mesReferencia);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      mesReferencia: r.mes_referencia,
      codigoVendedor: r.codigo_vendedor,
      chave: r.chave,
      valor: Number(r.valor),
    }));
  }
}

export const supabaseRepository = new SupabaseRepository();
