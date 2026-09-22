import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { repository } from '../data';
import { Card } from '../components/Card';
import { WhatsAppButton } from '../components/WhatsAppButton';
import { PhoneCallButton } from '../components/PhoneCallButton';
import { LoadingFarmacia } from '../components/LoadingFarmacia';
import { colors } from '../theme/colors';
import { formatBRL, formatDateBR, nomeCurto, todayISO } from '../lib/format';
import { existeRegistroContato, foiContatadoRecentemente } from '../lib/contatos';
import { cacheGet, cacheSet } from '../lib/cache';
import {
  agruparPorVendedor,
  campanhaAtiva,
  calcularMetaIndividualVendaAdicional,
  calcularRankingVendaAdicional,
  filtrarVendasQualificadas,
  medalhaPosicao,
} from '../lib/vendaAdicional';
import {
  CampanhaVendaAdicional,
  ClienteCarteira,
  ClienteDoVendedor,
  ContatoCliente,
  DonoCarteira,
  HistoricoCompraCliente,
  IdentificacaoCompradorVendedor,
  MetaVendedor,
  MotivoContato,
  ProdutoPromocaoAlerta,
  ProdutoRecorrenteCliente,
  TipoContato,
  VendaAntimicrobianoRecente,
  VendaReceitaPendente,
  VendaSemIdentificacaoComprador,
  VendaVendaAdicional,
} from '../types/domain';

const MOTIVO_LABEL: Record<VendaSemIdentificacaoComprador['motivo'], string> = {
  sem_cliente: 'Sem cliente na venda',
  proprio_cpf: 'No CPF do próprio vendedor',
};

// Reaproveitada nas 3 listas de Alertas que mostram cliente (carteira
// de clientes, alto valor sumindo, e dentro de promoção) — mesmo
// comportamento de "Meus Clientes": clica no cliente, expande as
// últimas 5 compras (produto + data) do histórico completo dele
// (01/08/2026).
function LinhaClienteComHistorico({
  codigoCliente,
  nome,
  telefone,
  detalhe,
  donoCarteira,
  mensagemWhatsapp,
  onContato,
}: {
  codigoCliente: number;
  nome: string;
  telefone: string | null;
  detalhe: string;
  // Nome do vendedor dono desse cliente na carteira, se tiver — só
  // passado por quem usa (hoje só "alto valor sumindo"); nos outros 2
  // usos fica undefined e o selo simplesmente não aparece.
  donoCarteira?: string | null;
  mensagemWhatsapp: string;
  onContato?: (tipoContato: TipoContato) => void;
}) {
  const { profile } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [historico, setHistorico] = useState<HistoricoCompraCliente[]>([]);
  const [carregando, setCarregando] = useState(false);

  const alternar = async () => {
    if (aberto) {
      setAberto(false);
      return;
    }
    setAberto(true);
    if (historico.length > 0 || !profile) return;
    setCarregando(true);
    try {
      setHistorico(await repository.getHistoricoComprasCliente(profile, codigoCliente));
    } finally {
      setCarregando(false);
    }
  };

  return (
    <View>
      <Pressable style={styles.itemRow} onPress={alternar}>
        <View style={styles.itemInfo}>
          <View style={styles.itemNomeLinha}>
            <Text style={styles.itemNome}>{nome}</Text>
            {donoCarteira && (
              <View style={styles.carteiraBadge}>
                <Ionicons name="person" size={10} color={colors.navy} />
                <Text style={styles.carteiraBadgeTexto} numberOfLines={1}>
                  {donoCarteira}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.itemDetalhe}>{detalhe}</Text>
        </View>
        <View style={styles.itemAcoes}>
          {telefone ? (
            <>
              <PhoneCallButton compact telefone={telefone} onLigar={() => onContato?.('ligacao')} />
              <WhatsAppButton
                compact
                telefone={telefone}
                codigoCliente={codigoCliente}
                mensagem={mensagemWhatsapp}
                onEnviado={() => onContato?.('whatsapp')}
              />
            </>
          ) : null}
          <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </View>
      </Pressable>
      {aberto && (
        <View style={styles.historicoPainel}>
          {carregando ? (
            <ActivityIndicator style={{ marginTop: 6 }} />
          ) : historico.length === 0 ? (
            <Text style={styles.empty}>Sem histórico de compra encontrado.</Text>
          ) : (
            historico.map((h) => (
              <View key={h.itemId} style={styles.historicoRow}>
                <Text style={styles.historicoProduto} numberOfLines={1}>
                  {h.quantidade > 1 ? `${h.quantidade}x ` : ''}
                  {h.nomeProduto}
                </Text>
                <Text style={styles.historicoData}>{formatDateBR(h.dataEmissao)}</Text>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

// Resumo (2 linhas de estatística) + lista de clientes do card
// "Carteira de clientes" — reaproveitado tanto pro agregado (vendedor,
// ou gestor antes de separar por vendedor) quanto pro resumo de UM
// vendedor específico (gestor, depois de clicar — 21/08/2026).
function ResumoCarteira({
  stats,
  clientes,
  onContato,
}: {
  stats: StatsCarteira;
  clientes: ClienteCarteira[];
  onContato: (motivo: MotivoContato, codigoCliente: number, tipoContato: TipoContato) => void;
}) {
  return (
    <>
      <View style={styles.carteiraStatsRow}>
        <View style={styles.carteiraStatItem}>
          <Text style={styles.carteiraStatValor}>{formatBRL(stats.valorTotal)}</Text>
          <Text style={styles.carteiraStatLabel}>Vendido (últ. 6 meses)</Text>
        </View>
        <View style={styles.carteiraStatItem}>
          <Text style={styles.carteiraStatValor}>{stats.totalClientes}</Text>
          <Text style={styles.carteiraStatLabel}>Clientes na carteira</Text>
        </View>
        <View style={styles.carteiraStatItem}>
          <Text style={styles.carteiraStatValor}>{stats.compraramEsteMes}</Text>
          <Text style={styles.carteiraStatLabel}>Compraram este mês</Text>
        </View>
      </View>
      <View style={styles.carteiraStatsRow}>
        <View style={styles.carteiraStatItem}>
          <Text style={styles.carteiraStatValor}>{formatBRL(stats.valorMesAtual)}</Text>
          <Text style={styles.carteiraStatLabel}>Comprado este mês</Text>
        </View>
        <View style={styles.carteiraStatItem}>
          <Text style={styles.carteiraStatValor}>{stats.contatadosEsteMes}</Text>
          <Text style={styles.carteiraStatLabel}>Contatados este mês</Text>
        </View>
      </View>
      {clientes.length === 0 ? (
        <Text style={styles.empty}>Nenhum cliente na carteira ainda — adiciona na aba "Carteira de clientes".</Text>
      ) : (
        clientes.map((cliente) => (
          <LinhaClienteComHistorico
            key={cliente.id}
            codigoCliente={cliente.codigoCliente}
            nome={cliente.nome}
            telefone={cliente.telefone}
            detalhe={`${formatBRL(cliente.valor6Meses)} (últ. 6 meses)${
              cliente.compradoEsteMes ? ` · ${formatBRL(cliente.valorMesAtual)} este mês ✅` : ''
            }`}
            mensagemWhatsapp={`Oi, ${nomeCurto(cliente.nome)}! Tudo bem? Aqui é da Farmácia Conviva Parquelândia. Passando pra saber se você precisa de alguma coisa 🙂`}
            onContato={(tipo) => onContato('carteira', cliente.codigoCliente, tipo)}
          />
        ))
      )}
    </>
  );
}

type ModoFiltroSemComprador = 'todas' | 'controladas' | 'proprio_cpf';

// Contagem "sem identificação" certa pro modo ativo — usada tanto pra
// filtrar quem aparece na lista quanto (dentro de LinhaVendedorSemComprador)
// pro número mostrado no card de cada vendedor.
function contagemSemIdentificacao(v: IdentificacaoCompradorVendedor, modo: ModoFiltroSemComprador): number {
  if (modo === 'controladas') return v.vendasControladasSemIdentificacao;
  if (modo === 'proprio_cpf') return v.vendasProprioCpf;
  return v.vendasSemIdentificacao;
}

// Drill-down do card "Venda controlada sem comprador": clica no
// vendedor, expande as vendas específicas (nota, data, produto,
// motivo) — mesmo padrão de LinhaClienteComHistorico acima, mas sem
// ação de WhatsApp (não faz sentido aqui, é autoconferência/cobrança
// interna, não contato com cliente).
function LinhaVendedorSemComprador({
  vendedor,
  modo,
}: {
  vendedor: IdentificacaoCompradorVendedor;
  modo: ModoFiltroSemComprador;
}) {
  const { profile } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [vendas, setVendas] = useState<VendaSemIdentificacaoComprador[]>([]);
  const [carregando, setCarregando] = useState(false);

  const alternar = async () => {
    if (aberto) {
      setAberto(false);
      return;
    }
    setAberto(true);
    if (vendas.length > 0 || !profile) return;
    setCarregando(true);
    try {
      setVendas(await repository.getVendasSemIdentificacaoComprador(profile, vendedor.codigoVendedor));
    } finally {
      setCarregando(false);
    }
  };

  // Uma busca só (cacheada em `vendas`, todo tipo de venda) — trocar o
  // filtro reaplica em cima do que já veio, sem buscar de novo.
  // "proprio_cpf" usa o mesmo total de "todas" (não é recortado por
  // tipo de produto, é recortado por motivo).
  const total = modo === 'controladas' ? vendedor.totalVendasControladas : vendedor.totalVendas;
  const semIdentificacao = contagemSemIdentificacao(vendedor, modo);
  const percentual =
    modo === 'controladas'
      ? vendedor.percentualControladasSemIdentificacao
      : modo === 'proprio_cpf'
        ? vendedor.percentualProprioCpf
        : vendedor.percentualSemIdentificacao;
  const vendasVisiveis =
    modo === 'controladas'
      ? vendas.filter((v) => v.controlado)
      : modo === 'proprio_cpf'
        ? vendas.filter((v) => v.motivo === 'proprio_cpf')
        : vendas;

  const sufixoDetalhe =
    modo === 'controladas' ? ' de controlado' : modo === 'proprio_cpf' ? ' com CPF próprio' : '';

  return (
    <View>
      <Pressable style={styles.itemRow} onPress={alternar}>
        <View style={styles.itemInfo}>
          <Text style={styles.itemNome}>{vendedor.nomeVendedor}</Text>
          <Text style={styles.itemDetalhe}>
            {semIdentificacao} de {total} vendas{sufixoDetalhe}
          </Text>
        </View>
        <View style={styles.itemAcoes}>
          <Text style={styles.percentualDestaque}>{percentual.toFixed(0)}%</Text>
          <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </View>
      </Pressable>
      {aberto && (
        <View style={styles.historicoPainel}>
          {carregando ? (
            <ActivityIndicator style={{ marginTop: 6 }} />
          ) : vendasVisiveis.length === 0 ? (
            <Text style={styles.empty}>Nenhuma venda encontrada.</Text>
          ) : (
            vendasVisiveis.map((v) => (
              <View key={v.itemId} style={styles.historicoRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historicoProduto} numberOfLines={1}>
                    Nota {v.numeroNota} · {v.nomeProduto}
                    {v.controlado ? ' 🔒' : ''}
                  </Text>
                  <Text style={styles.historicoMotivo}>{MOTIVO_LABEL[v.motivo]}</Text>
                </View>
                <Text style={styles.historicoData}>
                  {formatDateBR(v.dataVenda)}
                  {v.horaVenda ? ` ${v.horaVenda.slice(0, 5)}` : ''}
                </Text>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

function mensagemPromocao(alerta: ProdutoPromocaoAlerta, nomeCliente: string, ultimaCompra: string): string {
  const { produto } = alerta;
  return `Olá, ${nomeCurto(nomeCliente)}! 🎉 O ${produto.nome}, que você já levou aqui na Conviva Parquelândia (última vez em ${formatDateBR(
    ultimaCompra
  )}), entrou em promoção: -${produto.percentualDesconto}% — agora por ${formatBRL(
    produto.precoAtual
  )}. Aproveita antes que acabe!`;
}

function diasDesde(dataISO: string, hoje: Date): number {
  const data = new Date(dataISO);
  const hojeSemHora = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((hojeSemHora.getTime() - data.getTime()) / 86400000);
}

interface StatsCarteira {
  valorTotal: number;
  valorMesAtual: number;
  totalClientes: number;
  compraramEsteMes: number;
  contatadosEsteMes: number;
}

// Extraído do card "Carteira de clientes" pra reaproveitar tanto no
// resumo agregado (vendedor, ou gestor antes de separar por vendedor)
// quanto no resumo de UM vendedor específico (gestor, depois de
// clicar — 21/08/2026).
function calcularStatsCarteira(clientes: ClienteCarteira[], contatos: ContatoCliente[], hoje: Date): StatsCarteira {
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).getTime();
  const clientesDaCarteira = new Set(clientes.map((c) => c.codigoCliente));
  const contatadosEsteMes = new Set(
    contatos
      .filter(
        (c) =>
          c.motivo === 'carteira' && clientesDaCarteira.has(c.codigoCliente) && new Date(c.contatadoEm).getTime() >= inicioMes
      )
      .map((c) => c.codigoCliente)
  ).size;
  return {
    valorTotal: clientes.reduce((soma, c) => soma + c.valor6Meses, 0),
    valorMesAtual: clientes.reduce((soma, c) => soma + c.valorMesAtual, 0),
    totalClientes: clientes.length,
    compraramEsteMes: clientes.filter((c) => c.compradoEsteMes).length,
    contatadosEsteMes,
  };
}

const RECEITA_PENDENTE_DIAS = 7;
const CLIENTE_SUMIU_DIAS = 60;
const ANTIBIOTICO_DIAS = 7;
// Depois da janela de exibição, ainda dá mais esse tanto de dias de
// tolerância antes de marcar como "não contatado" — só existe pra não
// perder o registro se a tela ficar uns dias sem ser aberta. Vendas
// mais antigas que ANTIBIOTICO_DIAS + ANTIBIOTICO_TOLERANCIA_DIAS são
// ignoradas de vez (não aparecem, não geram 'nao_contatado') — sem
// isso, o efeito de auto-expiração varria TODO o histórico da view
// (desde 01/07/2026) na primeira vez que a tela carregasse, marcando
// como "perdida" venda de mais de um mês atrás, de antes desse card
// existir (bug encontrado com dado real em 03/08/2026: 43 registros
// criados de uma vez só, contra 18 vendas nos últimos 7 dias).
const ANTIBIOTICO_TOLERANCIA_DIAS = 7;

interface AlertaCardInfo {
  chave: string;
  emoji: string;
  titulo: string;
  contagem: number;
  cor: string;
}

// Tudo que load() busca, num objeto só — permite cachear o resultado
// inteiro e reidratar a tela na hora ao reabrir (stale-while-revalidate,
// ver lib/cache.ts), em vez de começar do zero toda vez.
interface AlertasDados {
  alertasPromocao: ProdutoPromocaoAlerta[];
  clientes: ClienteDoVendedor[];
  clientesValorGeral: ClienteDoVendedor[];
  produtosRecorrentes: ProdutoRecorrenteCliente[];
  receitas: VendaReceitaPendente[];
  antimicrobianos: VendaAntimicrobianoRecente[];
  identificacaoComprador: IdentificacaoCompradorVendedor[];
  metas: MetaVendedor[];
  contatos: ContatoCliente[];
  carteiraClientes: ClienteCarteira[];
  donosCarteira: DonoCarteira[];
  campanhasVendaAdicionalAtivas: CampanhaVendaAdicional[];
  vendasVendaAdicionalPorCampanha: Record<string, VendaVendaAdicional[]>;
}

export function AlertasScreen() {
  const { profile } = useAuth();
  const navigation = useNavigation<any>();
  const [alertasPromocao, setAlertasPromocao] = useState<ProdutoPromocaoAlerta[]>([]);
  const [clientes, setClientes] = useState<ClienteDoVendedor[]>([]);
  const [clientesValorGeral, setClientesValorGeral] = useState<ClienteDoVendedor[]>([]);
  const [produtosRecorrentes, setProdutosRecorrentes] = useState<ProdutoRecorrenteCliente[]>([]);
  const [receitas, setReceitas] = useState<VendaReceitaPendente[]>([]);
  const [antimicrobianos, setAntimicrobianos] = useState<VendaAntimicrobianoRecente[]>([]);
  const [identificacaoComprador, setIdentificacaoComprador] = useState<IdentificacaoCompradorVendedor[]>([]);
  const [filtroSemComprador, setFiltroSemComprador] = useState<ModoFiltroSemComprador>('todas');
  const [metas, setMetas] = useState<MetaVendedor[]>([]);
  const [contatos, setContatos] = useState<ContatoCliente[]>([]);
  const [campanhasVendaAdicionalAtivas, setCampanhasVendaAdicionalAtivas] = useState<CampanhaVendaAdicional[]>([]);
  const [vendasVendaAdicionalPorCampanha, setVendasVendaAdicionalPorCampanha] = useState<Record<string, VendaVendaAdicional[]>>({});
  const [carteiraClientes, setCarteiraClientes] = useState<ClienteCarteira[]>([]);
  const [donosCarteira, setDonosCarteira] = useState<DonoCarteira[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const voltarProsCards = () => {
    setExpandido(null);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  // Chamadores só usam os setState — memoizado com [] porque os
  // setters do useState são estáveis, e é chamado tanto na hidratação
  // do cache quanto no fim de um load() de verdade.
  const aplicarDados = useCallback((d: AlertasDados) => {
    setAlertasPromocao(d.alertasPromocao);
    setClientes(d.clientes);
    setClientesValorGeral(d.clientesValorGeral);
    setProdutosRecorrentes(d.produtosRecorrentes);
    setReceitas(d.receitas);
    setAntimicrobianos(d.antimicrobianos);
    setIdentificacaoComprador(d.identificacaoComprador);
    setMetas(d.metas);
    setContatos(d.contatos);
    setCarteiraClientes(d.carteiraClientes);
    setDonosCarteira(d.donosCarteira);
    setCampanhasVendaAdicionalAtivas(d.campanhasVendaAdicionalAtivas);
    setVendasVendaAdicionalPorCampanha(d.vendasVendaAdicionalPorCampanha);
  }, []);

  const load = useCallback(async () => {
    if (!profile) return;
    const hoje = new Date();
    const [promocao, cli, valorGeral, prod, rec, antim, ident, met, cont, carteira, donos] = await Promise.all([
      repository.getProdutosEmPromocao(profile),
      repository.getClientesDoVendedor(profile),
      repository.getClientesValorGeral(profile),
      repository.getProdutosRecorrentesDoVendedor(profile),
      repository.getVendasComReceita(profile),
      repository.getVendasAntimicrobianoRecente(profile),
      repository.getIdentificacaoCompradorPorVendedor(profile),
      repository.getMetas(profile, hoje.getFullYear(), hoje.getMonth() + 1),
      repository.getContatosRecentes(profile),
      // Sem codigoVendedor: vendedor traz a própria carteira, gestor
      // traz a de todo mundo somada (card de Alertas é um resumo geral
      // — o detalhe por vendedor fica na aba "Carteira de clientes").
      repository.getCarteiraClientes(profile),
      // Quem é dono de cada cliente em QUALQUER carteira (não só a do
      // vendedor logado) — usado no card "Cliente de alto valor
      // sumindo" pra avisar se o cliente já é acompanhado por alguém.
      repository.getDonosCarteira(profile),
    ]);

    // Venda adicional: só as campanhas ativas hoje interessam pro card
    // de Alertas — busca as vendas de cada uma já aqui (não é lazy
    // como o histórico de cliente, porque o número do card precisa da
    // soma antes mesmo de expandir).
    const todasCampanhasVA = await repository.getCampanhasVendaAdicional(profile);
    const hojeIso = todayISO();
    const ativasVA = todasCampanhasVA.filter((c) => campanhaAtiva(c, hojeIso));
    const vendasPorCampanhaVA: Record<string, VendaVendaAdicional[]> = {};
    await Promise.all(
      ativasVA.map(async (c) => {
        vendasPorCampanhaVA[c.id] = await repository.getVendasVendaAdicional(profile, c.id);
      })
    );

    const dados: AlertasDados = {
      alertasPromocao: promocao,
      clientes: cli,
      clientesValorGeral: valorGeral,
      produtosRecorrentes: prod,
      receitas: rec,
      antimicrobianos: antim,
      identificacaoComprador: ident,
      metas: met,
      contatos: cont,
      carteiraClientes: carteira,
      donosCarteira: donos,
      campanhasVendaAdicionalAtivas: ativasVA,
      vendasVendaAdicionalPorCampanha: vendasPorCampanhaVA,
    };
    aplicarDados(dados);
    cacheSet(`alertas:${profile.id}`, dados);
  }, [profile, aplicarDados]);

  // Registra a tentativa de contato e já suprime da lista na hora
  // (otimista) — ver lib/contatos.ts pra janela de cada motivo.
  const registrarContatoAlerta = (
    motivo: MotivoContato,
    codigoCliente: number,
    tipoContato: TipoContato,
    codigoProduto: number | null = null
  ) => {
    if (!profile) return;
    const chaveCache = `alertas:${profile.id}`;
    const novo: ContatoCliente = { codigoCliente, motivo, codigoProduto, contatadoEm: new Date().toISOString() };
    setContatos((atual) => [...atual, novo]);
    const cacheado = cacheGet<AlertasDados>(chaveCache);
    if (cacheado) cacheSet(chaveCache, { ...cacheado, contatos: [...cacheado.contatos, novo] });
    repository
      .registrarContato(profile, { codigoCliente, motivo, tipoContato, codigoProduto, codigoVendedor: profile.codigoVendedor })
      .catch(() => {
        setContatos((atual) => atual.filter((c) => c !== novo));
        const atual = cacheGet<AlertasDados>(chaveCache);
        if (atual) cacheSet(chaveCache, { ...atual, contatos: atual.contatos.filter((c) => c !== novo) });
      });
  };

  // Stale-while-revalidate: se já tem resultado em cache dessa sessão
  // (ver lib/cache.ts), mostra na hora sem spinner e atualiza por trás;
  // só bloqueia a tela com loading na primeira vez sem nada em cache.
  useEffect(() => {
    if (!profile) return;
    const cacheado = cacheGet<AlertasDados>(`alertas:${profile.id}`);
    if (cacheado) {
      aplicarDados(cacheado);
      setLoading(false);
    } else {
      setLoading(true);
    }
    load().finally(() => setLoading(false));
  }, [load, profile, aplicarDados]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const hoje = new Date();

  const usoContinuoAtrasado = useMemo(
    () =>
      produtosRecorrentes
        .filter((p) => p.atrasado && !foiContatadoRecentemente(contatos, p.codigoCliente, 'uso_continuo', p.codigoProduto))
        .sort((a, b) => b.diasDesdeUltimaCompra - a.diasDesdeUltimaCompra),
    [produtosRecorrentes, contatos]
  );

  // Estatísticas do card "Carteira de clientes" — valorTotal é o
  // valor6Meses de cada cliente (já soma qualquer vendedor, ver
  // comentário de vw_carteira_clientes), não all-time. valorMesAtual é
  // só o mês corrente (diferente do 6 meses). contatadosEsteMes conta
  // cliente distinto contatado (ligação/whatsapp) por motivo 'carteira'
  // dentro do mês corrente — não usa foiContatadoRecentemente porque
  // aqui não é suspensão de lista, é estatística pura (10/08/2026).
  const carteiraStats = useMemo(() => calcularStatsCarteira(carteiraClientes, contatos, hoje), [carteiraClientes, contatos, hoje]);

  // Gestor vê o card "Carteira de clientes" separado por vendedor
  // (21/08/2026, pedido explícito) — em vez da lista combinada de
  // todo mundo, mostra os nomes primeiro; clicar num nome abre o
  // resumo+lista SÓ daquele vendedor. nomeVendedor vem de
  // donosCarteira (mesma tabela carteira_clientes, sem o recorte por
  // vendedor da RLS) — não de getVendedoresAtivos, pra não precisar de
  // outro fetch.
  const carteiraPorVendedor = useMemo(() => {
    if (profile?.role !== 'gestor') return [];
    const nomePorCodigo = new Map(donosCarteira.map((d) => [d.codigoVendedor, d.nomeVendedor]));
    const porVendedor = new Map<number, ClienteCarteira[]>();
    for (const c of carteiraClientes) {
      if (!porVendedor.has(c.codigoVendedor)) porVendedor.set(c.codigoVendedor, []);
      porVendedor.get(c.codigoVendedor)!.push(c);
    }
    return Array.from(porVendedor.entries())
      .map(([codigoVendedor, clientes]) => ({
        codigoVendedor,
        nomeVendedor: nomePorCodigo.get(codigoVendedor) ?? `Vendedor ${codigoVendedor}`,
        clientes,
        stats: calcularStatsCarteira(clientes, contatos, hoje),
      }))
      .sort((a, b) => a.nomeVendedor.localeCompare(b.nomeVendedor));
  }, [profile, carteiraClientes, donosCarteira, contatos, hoje]);
  const [vendedorCarteiraAberto, setVendedorCarteiraAberto] = useState<number | null>(null);
  // Produto em promoção: card colapsado mostra só nome/desconto/qtd
  // vendida, clica pra abrir a lista de clientes (antes vinha tudo
  // aberto de uma vez, poluindo a tela com produto muito comprado).
  const [produtoPromocaoAberto, setProdutoPromocaoAberto] = useState<number | null>(null);
  // Venda Adicional (21/08/2026): ranking mostra só posição+nome por
  // padrão — clicar no nome abre o resumo (quantidade + valor) daquele
  // vendedor. Chave `${campanhaId}:${codigoVendedor}` porque várias
  // campanhas ativas podem estar na tela ao mesmo tempo, cada uma com
  // seu próprio ranking independente.
  const [linhaVAAberta, setLinhaVAAberta] = useState<string | null>(null);

  const diaDoMes = hoje.getDate();
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const percentualMesDecorrido = (diaDoMes / diasNoMes) * 100;
  const metasEmRisco = useMemo(
    () =>
      metas
        .map((m) => ({
          meta: m,
          percentualAtingido: m.valorMetaMensal > 0 ? (m.valorRealizadoMensal / m.valorMetaMensal) * 100 : 0,
        }))
        .filter((x) => x.meta.valorMetaMensal > 0 && x.percentualAtingido < percentualMesDecorrido - 10)
        .sort((a, b) => a.percentualAtingido - b.percentualAtingido),
    [metas, percentualMesDecorrido]
  );

  const receitasPendentesAntigas = useMemo(
    () =>
      receitas
        .filter((r) => !r.receitaAnexada)
        .map((r) => ({ item: r, dias: diasDesde(r.dataVenda, hoje) }))
        .filter((x) => x.dias >= RECEITA_PENDENTE_DIAS)
        .sort((a, b) => b.dias - a.dias),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [receitas]
  );

  const donoPorCliente = useMemo(
    () => new Map(donosCarteira.map((d) => [d.codigoCliente, d.nomeVendedor])),
    [donosCarteira]
  );

  // clientesValorGeral (não `clientes`, que é escopado por vendedor) —
  // achado 09/08/2026: usando a lista por vendedor, um cliente que
  // comprou recentemente com OUTRO vendedor entrava como "sumindo" na
  // lista de quem não foi o vendedor da última compra, porque
  // valorTotal/ultimaCompra daquela lista já vêm recortados pra 1
  // vendedor só. É oportunidade de contato pra qualquer atendente,
  // então soma qualquer vendedor mesmo.
  const clientesAltoValorSumindo = useMemo(() => {
    const comValor = clientesValorGeral.filter((c) => c.valorTotal > 0).sort((a, b) => b.valorTotal - a.valorTotal);
    const corteTop25 = comValor[Math.floor(comValor.length * 0.25)]?.valorTotal ?? 0;
    return comValor
      .filter(
        (c) =>
          c.valorTotal >= corteTop25 &&
          c.ultimaCompra &&
          diasDesde(c.ultimaCompra, hoje) >= CLIENTE_SUMIU_DIAS &&
          !foiContatadoRecentemente(contatos, c.codigo, 'alto_valor_sumindo')
      )
      .sort((a, b) => b.valorTotal - a.valorTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientesValorGeral, contatos]);

  // Mesma lista de alertasPromocao, só tirando quem já foi contatado
  // sobre ESSE produto especificamente — contatar sobre um produto não
  // deve esconder o cliente de outro produto em promoção ao mesmo tempo.
  const alertasPromocaoFiltrados = useMemo(
    () =>
      alertasPromocao.map((alerta) => ({
        ...alerta,
        clientes: alerta.clientes.filter(
          (cliente) => !foiContatadoRecentemente(contatos, cliente.codigoCliente, 'promocao', alerta.produto.codigo)
        ),
      })),
    [alertasPromocao, contatos]
  );

  // Fonte: vw_vendas_antimicrobiano_recente (categoria/grupo do
  // catálogo, não tipo_lista='T' — esse tinha gap de cadastro real,
  // confirmado com dado de produção 03/08/2026: produto duplicado no
  // Trier, a entrada mal cadastrada é a que aparece na venda). Dedupe
  // por (cliente, produto) — se comprou o mesmo antibiótico 2x na
  // janela, mantém só a venda mais recente pra contagem de dias.
  // [10/08/2026] telefone vem de `clientesValorGeral` (QUALQUER
  // vendedor, ver getClientesValorGeral), não de `clientes` — esse é
  // escopado só pro vendedor logado (vw_clientes_por_vendedor), mas a
  // lista de antibiótico mostra venda de QUALQUER vendedor da equipe.
  // Usar `clientes` fazia o telefone sumir sempre que o antibiótico foi
  // vendido por outro vendedor (cliente não constava no mapa, mesmo
  // tendo telefone cadastrado) — mesmo bug já corrigido antes pro card
  // "Cliente de alto valor sumindo" (ver getClientesValorGeral).
  const antibioticosPorCliente = useMemo(() => {
    const clientesPorCodigo = new Map(clientesValorGeral.map((c) => [c.codigo, c]));
    const porChave = new Map<
      string,
      { codigoCliente: number; codigoProduto: number; nomeCliente: string; nomeProduto: string; telefone: string | null; dias: number }
    >();
    for (const r of antimicrobianos) {
      if (r.codigoCliente == null) continue;
      const dias = diasDesde(r.dataVenda, hoje);
      if (dias > ANTIBIOTICO_DIAS + ANTIBIOTICO_TOLERANCIA_DIAS) continue;
      const chave = `${r.codigoCliente}:${r.codigoProduto}`;
      const existente = porChave.get(chave);
      if (existente && existente.dias <= dias) continue;
      porChave.set(chave, {
        codigoCliente: r.codigoCliente,
        codigoProduto: r.codigoProduto,
        nomeCliente: r.nomeCliente,
        nomeProduto: r.nomeProduto,
        telefone: clientesPorCodigo.get(r.codigoCliente)?.telefone ?? null,
        dias,
      });
    }
    return Array.from(porChave.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [antimicrobianos, clientesValorGeral]);

  const antibioticosRecentes = useMemo(
    () =>
      antibioticosPorCliente
        .filter(
          (a) => a.dias <= ANTIBIOTICO_DIAS && !existeRegistroContato(contatos, a.codigoCliente, 'antibiotico', a.codigoProduto)
        )
        .sort((a, b) => b.dias - a.dias),
    [antibioticosPorCliente, contatos]
  );

  // Passou a janela sem ninguém ligar/mandar WhatsApp — o efeito
  // abaixo grava 'nao_contatado' sozinho pra cada um destes assim que
  // a tela carrega/atualiza.
  const antibioticosExpirados = useMemo(
    () =>
      antibioticosPorCliente.filter(
        (a) => a.dias > ANTIBIOTICO_DIAS && !existeRegistroContato(contatos, a.codigoCliente, 'antibiotico', a.codigoProduto)
      ),
    [antibioticosPorCliente, contatos]
  );

  // Não existe job/cron rodando isso (diferente do fechamento de
  // comissão, que tem função no banco + cron do n8n) — o "relógio" de
  // 7 dias só é conferido quando alguém abre/atualiza a tela de
  // Alertas. Assim que o contato otimista entra em `contatos`
  // (registrarContatoAlerta), o item some de antibioticosExpirados e o
  // efeito não dispara de novo pra ele.
  useEffect(() => {
    if (!profile || antibioticosExpirados.length === 0) return;
    for (const a of antibioticosExpirados) {
      registrarContatoAlerta('antibiotico', a.codigoCliente, 'nao_contatado', a.codigoProduto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [antibioticosExpirados, profile]);

  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingFarmacia />
      </View>
    );
  }

  const cards: AlertaCardInfo[] = [
    { chave: 'uso_continuo', emoji: '🔁', titulo: 'Uso contínuo atrasado', contagem: usoContinuoAtrasado.length, cor: '#9333ea' },
    { chave: 'carteira_clientes', emoji: '👥', titulo: 'Carteira de clientes', contagem: carteiraStats.totalClientes, cor: '#0891b2' },
    { chave: 'meta_risco', emoji: '📉', titulo: 'Meta em risco', contagem: metasEmRisco.length, cor: colors.red },
    { chave: 'receita_pendente', emoji: '💊', titulo: 'Receita pendente há tempo', contagem: receitasPendentesAntigas.length, cor: colors.red },
    {
      chave: 'antibiotico',
      emoji: '🦠',
      titulo: `Antibiótico vendido (${ANTIBIOTICO_DIAS} dias)`,
      contagem: antibioticosRecentes.length,
      cor: '#D97706',
    },
    {
      chave: 'sem_comprador',
      emoji: '🪪',
      titulo: 'Venda sem comprador',
      contagem: identificacaoComprador.reduce((soma, v) => soma + v.vendasSemIdentificacao, 0),
      cor: colors.red,
    },
    { chave: 'alto_valor_sumindo', emoji: '💸', titulo: 'Cliente de alto valor sumindo', contagem: clientesAltoValorSumindo.length, cor: colors.navy },
    { chave: 'promocao', emoji: '🔔', titulo: 'Produto em promoção', contagem: alertasPromocao.length, cor: colors.success },
    {
      chave: 'venda_adicional',
      emoji: '🎁',
      titulo: 'Venda adicional',
      // Gestor vê o total de todo mundo (soma bruta). Vendedor vê só o
      // próprio número — mas precisa ser o MESMO número que aparece no
      // ranking/meta ao abrir (agruparPorVendedor, que respeita o
      // criterio_quantidade da campanha: em 'mesma_venda' o "total" é
      // o maior cupom, não a soma bruta). Somar a quantidade crua
      // direto (sem passar por agruparPorVendedor) batia diferente do
      // que a lista expandida mostrava (achado 03/08/2026: card 169,
      // lista mostrando 123 pra mesma vendedora).
      contagem:
        profile?.role === 'gestor'
          ? Object.values(vendasVendaAdicionalPorCampanha).reduce(
              (soma, vendas) => soma + vendas.reduce((s, v) => s + v.quantidade, 0),
              0
            )
          : campanhasVendaAdicionalAtivas.reduce((soma, campanha) => {
              const vendas = vendasVendaAdicionalPorCampanha[campanha.id] ?? [];
              const meu = agruparPorVendedor(vendas, campanha.criterioQuantidade).find(
                (x) => x.codigoVendedor === profile?.codigoVendedor
              );
              return soma + (meu?.quantidadeTotal ?? 0);
            }, 0),
      cor: '#DB2777',
    },
  ];

  const aoClicarCard = (chave: string) => {
    if (chave === 'uso_continuo') {
      navigation.navigate('MeusClientes', { apenasRecompra: true });
      return;
    }
    if (chave === 'receita_pendente') {
      navigation.navigate('Receitas');
      return;
    }
    if (chave === 'carteira_clientes') setVendedorCarteiraAberto(null);
    if (chave === 'promocao') setProdutoPromocaoAberto(null);
    setExpandido((atual) => (atual === chave ? null : chave));
  };

  return (
    <View style={styles.wrapper}>
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={expandido ? styles.containerContentComFab : undefined}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.subtitle}>Oportunidades de contato e pontos de atenção, atualizados a cada dado novo.</Text>

      <View style={styles.grid}>
        {cards.map((c) => (
          <Pressable
            key={c.chave}
            style={[styles.cardAlerta, expandido === c.chave && styles.cardAlertaAtivo]}
            onPress={() => aoClicarCard(c.chave)}
          >
            <View style={[styles.cardAccent, { backgroundColor: c.cor }]} />
            <View style={styles.cardTextos}>
              <Text style={styles.cardContagem}>{c.contagem}</Text>
              <Text style={styles.cardTitulo}>{c.titulo}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      {expandido === 'carteira_clientes' && (
        <Card>
          <Text style={styles.listaTitulo}>Carteira de clientes</Text>
          {profile?.role === 'gestor' ? (
            vendedorCarteiraAberto == null ? (
              carteiraPorVendedor.length === 0 ? (
                <Text style={styles.empty}>Nenhum cliente na carteira ainda.</Text>
              ) : (
                carteiraPorVendedor.map((v) => (
                  <Pressable
                    key={v.codigoVendedor}
                    style={styles.itemRow}
                    onPress={() => setVendedorCarteiraAberto(v.codigoVendedor)}
                  >
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemNome}>{v.nomeVendedor}</Text>
                      <Text style={styles.itemDetalhe}>
                        <Text style={styles.vendedorStatNumero}>{v.stats.totalClientes}</Text>{' '}
                        {v.stats.totalClientes === 1 ? 'cliente' : 'clientes'} ·{' '}
                        <Text style={styles.vendedorStatNumero}>{v.stats.compraramEsteMes}</Text> compraram este mês
                        ·{' '}
                        <Text style={styles.vendedorStatNumero}>{formatBRL(v.stats.valorMesAtual)}</Text> este mês
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Pressable>
                ))
              )
            ) : (
              (() => {
                const vendedorAtual = carteiraPorVendedor.find((v) => v.codigoVendedor === vendedorCarteiraAberto);
                if (!vendedorAtual) return null;
                return (
                  <View>
                    <Pressable style={styles.voltar} onPress={() => setVendedorCarteiraAberto(null)} hitSlop={8}>
                      <Ionicons name="arrow-back" size={18} color={colors.navy} />
                      <Text style={styles.voltarTexto} numberOfLines={1}>
                        {vendedorAtual.nomeVendedor}
                      </Text>
                    </Pressable>
                    <ResumoCarteira
                      stats={vendedorAtual.stats}
                      clientes={vendedorAtual.clientes}
                      onContato={registrarContatoAlerta}
                    />
                  </View>
                );
              })()
            )
          ) : (
            <ResumoCarteira stats={carteiraStats} clientes={carteiraClientes} onContato={registrarContatoAlerta} />
          )}
        </Card>
      )}

      {expandido === 'meta_risco' && (
        <Card>
          <Text style={styles.listaTitulo}>
            Abaixo do ritmo esperado ({Math.round(percentualMesDecorrido)}% do mês já passou)
          </Text>
          {metasEmRisco.length === 0 ? (
            <Text style={styles.empty}>Ninguém em risco no momento.</Text>
          ) : (
            metasEmRisco.map(({ meta, percentualAtingido }) => (
              <View key={meta.codigoVendedor} style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemNome}>{meta.nomeVendedor}</Text>
                  <Text style={styles.itemDetalhe}>
                    {percentualAtingido.toFixed(0)}% da meta · {formatBRL(meta.valorRealizadoMensal)} de{' '}
                    {formatBRL(meta.valorMetaMensal)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      )}

      {expandido === 'sem_comprador' && (
        <Card>
          <Text style={styles.listaTitulo}>Venda sem identificação real do comprador (desde julho/2026)</Text>
          <Text style={styles.listaSubtitulo}>
            Sem cliente na venda, ou cliente cadastrado é o próprio vendedor.
          </Text>
          <View style={styles.filtroRow}>
            <Pressable
              style={[styles.filtroChip, filtroSemComprador === 'todas' && styles.filtroChipAtivo]}
              onPress={() => setFiltroSemComprador('todas')}
            >
              <Text style={[styles.filtroChipTexto, filtroSemComprador === 'todas' && styles.filtroChipTextoAtivo]}>
                Todas as vendas
              </Text>
            </Pressable>
            <Pressable
              style={[styles.filtroChip, filtroSemComprador === 'controladas' && styles.filtroChipAtivo]}
              onPress={() => setFiltroSemComprador('controladas')}
            >
              <Text
                style={[styles.filtroChipTexto, filtroSemComprador === 'controladas' && styles.filtroChipTextoAtivo]}
              >
                🔒 Só controlados
              </Text>
            </Pressable>
            <Pressable
              style={[styles.filtroChip, filtroSemComprador === 'proprio_cpf' && styles.filtroChipAtivo]}
              onPress={() => setFiltroSemComprador('proprio_cpf')}
            >
              <Text
                style={[styles.filtroChipTexto, filtroSemComprador === 'proprio_cpf' && styles.filtroChipTextoAtivo]}
              >
                🪪 Só próprio CPF
              </Text>
            </Pressable>
          </View>
          {identificacaoComprador.filter((v) => contagemSemIdentificacao(v, filtroSemComprador) > 0).length === 0 ? (
            <Text style={styles.empty}>Nenhuma pendência — todo mundo identificando o comprador certinho.</Text>
          ) : (
            identificacaoComprador
              .filter((v) => contagemSemIdentificacao(v, filtroSemComprador) > 0)
              .map((v) => <LinhaVendedorSemComprador key={v.codigoVendedor} vendedor={v} modo={filtroSemComprador} />)
          )}
        </Card>
      )}

      {expandido === 'alto_valor_sumindo' && (
        <Card>
          <Text style={styles.listaTitulo}>Clientes de alto valor sem comprar há {CLIENTE_SUMIU_DIAS}+ dias</Text>
          {clientesAltoValorSumindo.length === 0 ? (
            <Text style={styles.empty}>Nenhum cliente de alto valor sumiu recentemente.</Text>
          ) : (
            clientesAltoValorSumindo.map((c) => (
              <LinhaClienteComHistorico
                key={c.codigo}
                codigoCliente={c.codigo}
                nome={c.nome}
                telefone={c.telefone}
                detalhe={`${formatBRL(c.valorTotal)} no total${c.ultimaCompra ? ` · última compra em ${formatDateBR(c.ultimaCompra)}` : ''}`}
                donoCarteira={donoPorCliente.get(c.codigo)}
                mensagemWhatsapp={`Olá, ${nomeCurto(c.nome)}! Aqui é ${nomeCurto(profile?.nome ?? '')} da Farmácia Conviva Parquelândia 💊 Sentimos sua falta — podemos ajudar em algo?`}
                onContato={(tipo) => registrarContatoAlerta('alto_valor_sumindo', c.codigo, tipo)}
              />
            ))
          )}
        </Card>
      )}

      {expandido === 'antibiotico' && (
        <Card>
          <Text style={styles.listaTitulo}>Antibiótico vendido nos últimos {ANTIBIOTICO_DIAS} dias</Text>
          <Text style={styles.listaSubtitulo}>
            Sem contato em {ANTIBIOTICO_DIAS} dias, o item sai da lista e fica registrado como "não contatado".
          </Text>
          {antibioticosRecentes.length === 0 ? (
            <Text style={styles.empty}>Nenhum antibiótico vendido recentemente sem contato.</Text>
          ) : (
            antibioticosRecentes.map((a) => (
              <LinhaClienteComHistorico
                key={`${a.codigoCliente}:${a.codigoProduto}`}
                codigoCliente={a.codigoCliente}
                nome={a.nomeCliente}
                telefone={a.telefone}
                detalhe={`${a.nomeProduto} · ${a.dias === 0 ? 'vendido hoje' : `vendido há ${a.dias} dia${a.dias > 1 ? 's' : ''}`}`}
                mensagemWhatsapp={`Olá, ${nomeCurto(a.nomeCliente)}! Aqui é ${nomeCurto(
                  profile?.nome ?? ''
                )} da Farmácia Conviva Parquelândia 🦠 Notamos que você levou ${a.nomeProduto} há ${a.dias} dia${
                  a.dias > 1 ? 's' : ''
                } — como está indo o tratamento? Qualquer dúvida, é só chamar!`}
                onContato={(tipo) => registrarContatoAlerta('antibiotico', a.codigoCliente, tipo, a.codigoProduto)}
              />
            ))
          )}
        </Card>
      )}

      {expandido === 'promocao' && (
        <>
          {alertasPromocao.length === 0 ? (
            <Card>
              <Text style={styles.empty}>Nenhum produto em promoção no momento.</Text>
            </Card>
          ) : (
            alertasPromocaoFiltrados.map((alerta) => {
              const aberto = produtoPromocaoAberto === alerta.produto.codigo;
              return (
                <Card key={alerta.produto.codigo}>
                  <Pressable
                    onPress={() => setProdutoPromocaoAberto((atual) => (atual === alerta.produto.codigo ? null : alerta.produto.codigo))}
                  >
                    <View style={styles.headerRow}>
                      <Text style={styles.produtoNome}>{alerta.produto.nome}</Text>
                      <View style={styles.descontoBadge}>
                        <Text style={styles.descontoBadgeText}>-{alerta.produto.percentualDesconto}%</Text>
                      </View>
                    </View>

                    <View style={styles.precoQuantidadeRow}>
                      <View style={styles.precoRow}>
                        {alerta.produto.precoAnterior != null && (
                          <Text style={styles.precoAnterior}>{formatBRL(alerta.produto.precoAnterior)}</Text>
                        )}
                        <Text style={styles.precoAtual}>{formatBRL(alerta.produto.precoAtual)}</Text>
                      </View>
                      <View style={styles.quantidadeVendidaRow}>
                        <Text style={styles.clientesTitle}>
                          {alerta.quantidadeVendidaAcao} vendido{alerta.quantidadeVendidaAcao === 1 ? '' : 's'} na ação
                        </Text>
                        <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                      </View>
                    </View>
                  </Pressable>

                  {aberto && alerta.clientes.length > 0 && (
                    <View style={styles.clientesSection}>
                      <Text style={styles.clientesTitle}>Já compraram antes ({alerta.clientes.length})</Text>
                      {alerta.clientes.map((cliente) => (
                        <LinhaClienteComHistorico
                          key={cliente.codigoCliente}
                          codigoCliente={cliente.codigoCliente}
                          nome={cliente.nomeCliente}
                          telefone={cliente.telefone}
                          detalhe={`Última vez em ${formatDateBR(cliente.ultimaCompraProduto)}`}
                          mensagemWhatsapp={mensagemPromocao(alerta, cliente.nomeCliente, cliente.ultimaCompraProduto)}
                          onContato={(tipo) => registrarContatoAlerta('promocao', cliente.codigoCliente, tipo, alerta.produto.codigo)}
                        />
                      ))}
                    </View>
                  )}
                </Card>
              );
            })
          )}
        </>
      )}

      {expandido === 'venda_adicional' && (
        <>
          {campanhasVendaAdicionalAtivas.length === 0 ? (
            <Card>
              <Text style={styles.empty}>Nenhuma campanha de venda adicional ativa no momento.</Text>
            </Card>
          ) : (
            campanhasVendaAdicionalAtivas.map((campanha) => {
              const vendas = (vendasVendaAdicionalPorCampanha[campanha.id] ?? []).slice().sort((a, b) => b.dataVenda.localeCompare(a.dataVenda));
              const parciais =
                campanha.tipoPremiacao === 'ranking'
                  ? calcularRankingVendaAdicional(vendas, campanha)
                  : calcularMetaIndividualVendaAdicional(vendas, campanha);
              // Soma em cima do que já saiu filtrado/agrupado (parciais),
              // não da lista crua — senão "Total vendido" não bate com a
              // soma do ranking abaixo em critérios que excluem linha
              // (ex.: 'venda_com_outros_itens' tira venda que veio
              // sozinha, achado 03/08/2026 com dado real: total mostrava
              // 357 bruto enquanto o ranking somava 236 já filtrado).
              const totalQuantidade = parciais.reduce((s, item) => s + item.quantidadeTotal, 0);
              // Lista só mostra venda que REALMENTE conta pro critério
              // (filtrarVendasQualificadas) — senão aparecia venda de 1
              // unidade numa campanha "mesma_venda" (compre 2) e parecia
              // que ela estava contando, quando nunca contou (achado
              // 03/08/2026). Ranking/parciais acima continua mostrando
              // todo mundo (é o ponto de ter ranking) — só a lista de
              // vendas em si (quem comprou o quê, quando) que só mostra
              // a do próprio vendedor logado; gestor vê a de todo mundo.
              const vendasQualificadas = filtrarVendasQualificadas(vendas, campanha);

              return (
                <Card key={campanha.id}>
                  <Text style={styles.produtoNome}>{campanha.nome}</Text>
                  <Text style={styles.listaSubtitulo}>
                    {campanha.produtos.map((p) => p.nomeProduto).join(', ')} · até {formatDateBR(campanha.dataFim)}
                  </Text>
                  <Text style={styles.itemDetalhe}>
                    {campanha.tipoPremiacao === 'ranking'
                      ? `Prêmio: ${(campanha.premiacaoRanking ?? []).map((p) => `${p.posicao}º ${formatBRL(p.valor)}`).join(' · ')}`
                      : `Prêmio: vendeu ${campanha.metaQuantidade}, ganha ${formatBRL(campanha.premiacaoMetaValor ?? 0)}`}
                    {campanha.criterioQuantidade === 'mesma_venda' ? ' · precisa sair junto na mesma venda' : ''}
                    {campanha.criterioQuantidade === 'venda_com_outros_itens' ? ' · só conta com outro item na venda' : ''}
                  </Text>

                  <View style={styles.clientesSection}>
                    <Text style={styles.clientesTitle}>Total vendido: {totalQuantidade} un.</Text>
                    {parciais.length === 0 ? (
                      <Text style={styles.empty}>Nenhuma venda com vendedor identificado ainda.</Text>
                    ) : (
                      parciais.map((item) => {
                        const chave = `${campanha.id}:${item.codigoVendedor}`;
                        const aberta = linhaVAAberta === chave;
                        const vendasDoVendedor = vendasQualificadas.filter((v) => v.codigoVendedor === item.codigoVendedor);
                        return (
                          <View key={item.codigoVendedor}>
                            <Pressable
                              style={styles.itemRow}
                              onPress={() => setLinhaVAAberta((atual) => (atual === chave ? null : chave))}
                            >
                              <View style={styles.itemInfo}>
                                <Text style={styles.itemNome}>
                                  {'posicao' in item
                                    ? `${item.premio != null ? medalhaPosicao(item.posicao) : `${item.posicao}º`} `
                                    : item.bateu
                                    ? '✅ '
                                    : '▫️ '}
                                  {item.nomeVendedor}
                                </Text>
                                <Text style={styles.itemDetalhe}>
                                  <Text style={styles.vendedorStatNumero}>{item.quantidadeTotal}</Text> un. ·{' '}
                                  <Text style={styles.vendedorStatNumero}>{formatBRL(item.valorTotal)}</Text>
                                  {item.premio != null ? ` · prêmio ${formatBRL(item.premio)}` : ''}
                                </Text>
                              </View>
                              <Ionicons name={aberta ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                            </Pressable>
                            {aberta && (
                              <View style={styles.historicoPainel}>
                                {vendasDoVendedor.length === 0 ? (
                                  <Text style={styles.empty}>Nenhuma venda qualificada encontrada.</Text>
                                ) : (
                                  vendasDoVendedor.map((v) => (
                                    <View key={v.itemId} style={styles.historicoRow}>
                                      <View style={{ flex: 1 }}>
                                        <Text style={styles.historicoProduto} numberOfLines={1}>
                                          {v.quantidade > 1 ? `${v.quantidade}x ` : ''}
                                          {v.nomeProduto}
                                        </Text>
                                        {v.nomeCliente && <Text style={styles.itemDetalhe}>{v.nomeCliente}</Text>}
                                        {v.outrosProdutosNaVenda && (
                                          <Text style={styles.itemDetalhe} numberOfLines={1}>
                                            + {v.outrosProdutosNaVenda}
                                          </Text>
                                        )}
                                      </View>
                                      <Text style={styles.historicoData}>
                                        {formatDateBR(v.dataVenda)}
                                        {v.horaVenda ? ` ${v.horaVenda.slice(0, 5)}` : ''}
                                      </Text>
                                    </View>
                                  ))
                                )}
                              </View>
                            )}
                          </View>
                        );
                      })
                    )}
                  </View>
                </Card>
              );
            })
          )}
        </>
      )}
    </ScrollView>
      {expandido && (
        <Pressable style={styles.fab} onPress={voltarProsCards}>
          <Ionicons name="arrow-up" size={18} color={colors.white} />
          <Text style={styles.fabTexto}>Cards</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  containerContentComFab: { paddingBottom: 72 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.navy,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  fabTexto: { color: colors.white, fontWeight: '700', fontSize: 13 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 16, lineHeight: 18 },
  empty: { color: colors.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cardAlerta: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    minHeight: 84,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  cardAlertaAtivo: { borderWidth: 1.5, borderColor: colors.navy },
  cardAccent: { width: 5, alignSelf: 'stretch', borderRadius: 2, marginRight: 12 },
  cardTextos: { flexShrink: 1 },
  cardContagem: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  cardTitulo: { fontSize: 12.5, color: colors.textSecondary, marginTop: 3, lineHeight: 16 },
  listaTitulo: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 4 },
  voltar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  voltarTexto: { color: colors.navy, fontWeight: '600', fontSize: 14 },
  vendedorStatNumero: { fontWeight: '700', color: colors.navy },
  listaSubtitulo: { fontSize: 11, color: colors.textMuted, marginBottom: 10 },
  carteiraStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  carteiraStatItem: { flex: 1, alignItems: 'center' },
  carteiraStatValor: { fontSize: 15, fontWeight: '700', color: colors.navy },
  carteiraStatLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
  filtroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filtroChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filtroChipAtivo: { backgroundColor: colors.navy, borderColor: colors.navy },
  filtroChipTexto: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  filtroChipTextoAtivo: { color: colors.white },
  percentualDestaque: { fontSize: 16, fontWeight: '700', color: colors.red },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 10,
  },
  itemInfo: { flexShrink: 1 },
  itemNomeLinha: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  itemNome: { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  carteiraBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.navy + '14',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  carteiraBadgeTexto: { fontSize: 10, color: colors.navy, fontWeight: '700' },
  itemDetalhe: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  itemAcoes: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  historicoPainel: {
    paddingLeft: 4,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  historicoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
    gap: 8,
  },
  historicoProduto: { fontSize: 12, color: colors.textPrimary, flex: 1 },
  historicoMotivo: { fontSize: 11, color: colors.red, marginTop: 1 },
  historicoData: { fontSize: 12, color: colors.textSecondary },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  produtoNome: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, flexShrink: 1, marginRight: 8 },
  descontoBadge: { backgroundColor: colors.red, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  descontoBadgeText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  precoQuantidadeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 4,
  },
  precoRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  quantidadeVendidaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  precoAnterior: { fontSize: 13, color: colors.textMuted, textDecorationLine: 'line-through' },
  precoAtual: { fontSize: 18, fontWeight: '700', color: colors.success },
  clientesSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  clientesTitle: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
});
