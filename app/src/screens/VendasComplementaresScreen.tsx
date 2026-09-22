import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { repository } from '../data';
import { Card } from '../components/Card';
import { CalendarioPeriodo } from '../components/CalendarioPeriodo';
import { colors } from '../theme/colors';
import { formatBRL, formatDateBR, parseDecimalBR, todayISO } from '../lib/format';
import { aplicarMascaraMoeda, moedaParaTexto } from '../lib/moeda';
import { alertar, confirmar } from '../lib/alert';
import {
  agruparResultadoComplementarPorDia,
  agruparVendasPorDiaDoVendedor,
  calcularRankingComplementar,
  medalhaPosicaoComplementar,
  totalComplementarPorVendedor,
} from '../lib/vendaComplementar';
import {
  CampanhaComplementar,
  ItemVendaComplementar,
  OfertaComplementarDia,
  VendaComplementarMarcada,
  VendedorAtivo,
} from '../types/domain';

// Mesmo critério de semana do mês usado no resto do app (Metas/Desempenho):
// dia 1-7 = semana 1, 8-14 = semana 2, 15-21 = semana 3, 22-fim = semana 4.
function semanaDoDia(dia: number): number {
  if (dia <= 7) return 1;
  if (dia <= 14) return 2;
  if (dia <= 21) return 3;
  return 4;
}

// Fallback pra quando ainda não existe campanha configurada: semana
// vigente do mês (mesmo critério de semanaDoDia), só pra tela não ficar
// vazia antes do gestor cadastrar um período.
function periodoSemanaAtual(): { inicio: string; fim: string } {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const ultimoDiaMes = new Date(ano, mes + 1, 0).getDate();
  const semana = semanaDoDia(hoje.getDate());
  const diaInicio = (semana - 1) * 7 + 1;
  const diaFim = semana === 4 ? ultimoDiaMes : Math.min(semana * 7, ultimoDiaMes);
  return {
    inicio: new Date(ano, mes, diaInicio).toISOString().slice(0, 10),
    fim: new Date(ano, mes, diaFim).toISOString().slice(0, 10),
  };
}

const MESES_ABREVIADOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function diasDoPeriodo(inicioIso: string, fimIso: string): { dia: number; mes: string; iso: string }[] {
  const dias: { dia: number; mes: string; iso: string }[] = [];
  const cursor = new Date(`${inicioIso}T00:00:00`);
  const fim = new Date(`${fimIso}T00:00:00`);
  while (cursor <= fim) {
    dias.push({ dia: cursor.getDate(), mes: MESES_ABREVIADOS[cursor.getMonth()], iso: cursor.toISOString().slice(0, 10) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

// Período vigente pro seletor de dias: o da campanha de ranking que
// estiver ativa hoje (é o gestor quem escolhe data_inicio/data_fim ao
// cadastrar) — só cai pra "semana atual" se ainda não existe nenhuma
// campanha cadastrada.
interface PeriodoCampanha {
  inicio: string;
  fim: string;
  temCampanha: boolean;
  campanha: CampanhaComplementar | null;
}

function usePeriodoVigente(): PeriodoCampanha {
  const { profile } = useAuth();
  const [periodo, setPeriodo] = useState<PeriodoCampanha>(() => ({
    ...periodoSemanaAtual(),
    temCampanha: false,
    campanha: null,
  }));

  useEffect(() => {
    if (!profile) return;
    repository
      .getCampanhasComplementares(profile)
      .then((campanhas) => {
        const hoje = todayISO();
        const vigente = campanhas.find((c) => c.dataInicio <= hoje && hoje <= c.dataFim);
        if (vigente) {
          setPeriodo({ inicio: vigente.dataInicio, fim: vigente.dataFim, temCampanha: true, campanha: vigente });
        }
      })
      .catch(() => {});
  }, [profile]);

  return periodo;
}

// Mesma ideia, mas pro gestor: se não tem campanha ativa HOJE (pode
// ser uma campanha futura ainda não começou, ou uma que já encerrou),
// cai pra campanha mais recente CADASTRADA em vez de "semana atual" —
// senão o gestor não conseguia nem navegar até os dias da própria
// campanha que ele configurou, só editar dias fora dela.
function usePeriodoCampanhaGestor(): PeriodoCampanha {
  const { profile } = useAuth();
  const [periodo, setPeriodo] = useState<PeriodoCampanha>(() => ({
    ...periodoSemanaAtual(),
    temCampanha: false,
    campanha: null,
  }));

  useEffect(() => {
    if (!profile) return;
    repository
      .getCampanhasComplementares(profile)
      .then((campanhas) => {
        if (campanhas.length === 0) return;
        const hoje = todayISO();
        const vigente = campanhas.find((c) => c.dataInicio <= hoje && hoje <= c.dataFim);
        const escolhida = vigente ?? campanhas[0];
        setPeriodo({ inicio: escolhida.dataInicio, fim: escolhida.dataFim, temCampanha: true, campanha: escolhida });
      })
      .catch(() => {});
  }, [profile]);

  return periodo;
}

// Dia selecionado sempre "encaixado" dentro do período vigente — some
// pro dia de hoje quando ele está no período, senão cai pro início.
// Usado tanto pela aba do vendedor quanto pela do gestor.
function useDiaNoPeriodo(inicio: string, fim: string): [string, (iso: string) => void] {
  const [diaSelecionado, setDiaSelecionado] = useState(todayISO());

  useEffect(() => {
    setDiaSelecionado((atual) => {
      if (atual >= inicio && atual <= fim) return atual;
      const hoje = todayISO();
      return hoje >= inicio && hoje <= fim ? hoje : inicio;
    });
  }, [inicio, fim]);

  return [diaSelecionado, setDiaSelecionado];
}

function SeletorDia({
  inicio,
  fim,
  selecionado,
  onSelecionar,
}: {
  inicio: string;
  fim: string;
  selecionado: string;
  onSelecionar: (iso: string) => void;
}) {
  const dias = useMemo(() => diasDoPeriodo(inicio, fim), [inicio, fim]);
  const hojeIso = todayISO();
  const { width } = useWindowDimensions();
  // ~7 dias visíveis por vez (respiro nas laterais da tela, 16 de
  // padding de cada lado) — cresce em tablet, encolhe em tela estreita,
  // sem passar dos limites pra não ficar minúsculo nem gigante.
  const larguraChip = Math.round(Math.min(68, Math.max(56, (width - 32 - 8 * 6) / 7)));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.seletorDiaWrap}
      contentContainerStyle={styles.seletorDiaConteudo}
    >
      {dias.map(({ dia, mes, iso }) => (
        <Pressable
          key={iso}
          style={[styles.diaBotao, { width: larguraChip }, selecionado === iso && styles.diaBotaoAtivo]}
          onPress={() => onSelecionar(iso)}
        >
          <Text style={[styles.diaTextoDia, selecionado === iso && styles.diaTextoAtivo]}>{dia}</Text>
          <Text style={[styles.diaTextoMes, selecionado === iso && styles.diaTextoAtivo]}>{mes}</Text>
          {iso === hojeIso && <View style={[styles.diaPontoHoje, selecionado === iso && styles.diaPontoHojeAtivo]} />}
        </Pressable>
      ))}
    </ScrollView>
  );
}

interface GrupoNota {
  vendaId: string;
  itens: ItemVendaComplementar[];
}

function agruparPorNota(itens: ItemVendaComplementar[]): GrupoNota[] {
  const porNota = new Map<string, ItemVendaComplementar[]>();
  for (const item of itens) {
    const lista = porNota.get(item.vendaId) ?? [];
    lista.push(item);
    porNota.set(item.vendaId, lista);
  }
  return [...porNota.entries()].map(([vendaId, itensDaNota]) => ({ vendaId, itens: itensDaNota }));
}

function CardNota({
  grupo,
  marcados,
  editavel,
  onAlternar,
}: {
  grupo: GrupoNota;
  marcados: Set<string>;
  editavel: boolean;
  onAlternar: (itemId: string) => void;
}) {
  const { itens } = grupo;
  return (
    <Card>
      {itens[0].numeroNota != null && <Text style={styles.notaCabecalho}>Nota {itens[0].numeroNota}</Text>}
      <Text style={styles.notaCliente} numberOfLines={1}>
        {itens[0].codigoCliente != null
          ? `${itens[0].codigoCliente} · ${itens[0].nomeCliente ?? 'Cliente'}`
          : 'Sem cliente identificado'}
      </Text>
      {itens.map((item) => {
        const marcado = marcados.has(item.itemId);
        return (
          <Pressable
            key={item.itemId}
            style={styles.itemLinha}
            onPress={() => editavel && onAlternar(item.itemId)}
            disabled={!editavel}
          >
            <Ionicons
              name={marcado ? 'checkbox' : 'square-outline'}
              size={20}
              color={marcado ? colors.navy : colors.textMuted}
            />
            <Text style={styles.itemProduto} numberOfLines={1}>
              {item.nomeProduto}
            </Text>
            <Text style={styles.itemValor}>{formatBRL(item.valor)}</Text>
          </Pressable>
        );
      })}
    </Card>
  );
}

const FRASES_SALVO = [
  'Agora, você se garantiu! 🎉',
  'Isso aí, mais um pra conta do prêmio! 💰',
  'Vendeu, marcou, ganhou! 🏆',
  'Boa! O ranking já sentiu essa. 📈',
  'Na conta do prêmio, hein! 😎',
  'Mandou bem — o pódio agradece. 🥇',
];

interface InfoModalSalvo {
  quantidade: number;
  valor: number;
  frase: string;
}

function ModalSalvo({ info, onClose }: { info: InfoModalSalvo | null; onClose: () => void }) {
  return (
    <Modal visible={info != null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalSalvoFundo} onPress={onClose}>
        <Pressable style={styles.modalSalvoCartao} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalSalvoEmoji}>🎉</Text>
          <Text style={styles.modalSalvoFrase}>{info?.frase}</Text>
          {info && (
            <Text style={styles.modalSalvoResumo}>
              {info.quantidade} {info.quantidade === 1 ? 'item marcado' : 'itens marcados'} · {formatBRL(info.valor)}
            </Text>
          )}
          <Pressable style={styles.modalSalvoBotao} onPress={onClose}>
            <Text style={styles.botaoTexto}>Fechar</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// "Viewer": lista dos itens do dia (rolando dentro do próprio espaço)
// com o botão Salvar fixo embaixo, fora da rolagem — reaproveitada
// pelo vendedor (sempre o próprio código) e pelo gestor (ao abrir o
// card de um vendedor). onSalvar avisa o pai (ex.: pra atualizar o
// CardResumoCampanha na hora, sem precisar sair e voltar da tela).
function ItensDoDia({
  codigoVendedor,
  diaSelecionado,
  editavel,
  metaClientesOfertadosDia,
  onSalvar,
  cabecalho,
}: {
  codigoVendedor: number;
  diaSelecionado: string;
  editavel: boolean;
  metaClientesOfertadosDia?: number | null;
  onSalvar?: () => void;
  // Conteúdo (seletor de dia, resumo da campanha etc.) que precisa
  // rolar JUNTO com a lista de notas — indo como ListHeaderComponent
  // do FlatList em vez de sibling fixo, senão em telas com bastante
  // conteúdo (ex.: campanha com muitos dias de resultado) ele fica
  // fora da área que rola e trava o scroll da tela inteira.
  cabecalho?: React.ReactNode;
}) {
  const { profile } = useAuth();
  const [itens, setItens] = useState<ItemVendaComplementar[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [clientesOfertadosTexto, setClientesOfertadosTexto] = useState('0');
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [modalSalvo, setModalSalvo] = useState<InfoModalSalvo | null>(null);

  const carregar = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const [dados, ofertados] = await Promise.all([
        repository.getItensVendaComplementarDia(profile, diaSelecionado, codigoVendedor),
        repository.getOfertaComplementarDia(profile, diaSelecionado, codigoVendedor),
      ]);
      setItens(dados);
      setMarcados(new Set(dados.filter((d) => d.marcado).map((d) => d.itemId)));
      setClientesOfertadosTexto(String(ofertados));
    } finally {
      setLoading(false);
    }
  }, [profile, diaSelecionado, codigoVendedor]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const alternarItem = (itemId: string) => {
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(itemId)) novo.delete(itemId);
      else novo.add(itemId);
      return novo;
    });
  };

  // Soma ao vivo do que está marcado agora — atualiza a cada toque,
  // antes mesmo de salvar (pedido explícito do usuário).
  const resumoSelecao = useMemo(() => {
    const selecionados = itens.filter((i) => marcados.has(i.itemId));
    return {
      quantidade: selecionados.length,
      valor: selecionados.reduce((soma, i) => soma + i.valor, 0),
    };
  }, [itens, marcados]);

  const salvar = async () => {
    if (!profile) return;
    setSalvando(true);
    try {
      const clientesOfertados = Math.max(0, Number(clientesOfertadosTexto.replace(/\D/g, '')) || 0);
      await Promise.all([
        repository.salvarVendasComplementaresDia(profile, diaSelecionado, codigoVendedor, [...marcados]),
        repository.salvarOfertaComplementarDia(profile, diaSelecionado, codigoVendedor, clientesOfertados),
      ]);
      setModalSalvo({
        quantidade: resumoSelecao.quantidade,
        valor: resumoSelecao.valor,
        frase: FRASES_SALVO[Math.floor(Math.random() * FRASES_SALVO.length)],
      });
      await carregar();
      onSalvar?.();
    } catch (erro) {
      alertar('Erro ao salvar', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const grupos = useMemo(() => agruparPorNota(itens), [itens]);

  if (loading) {
    return (
      <View style={styles.telaFlex}>
        {cabecalho}
        <ActivityIndicator style={{ marginTop: 16 }} />
      </View>
    );
  }

  return (
    <View style={styles.telaFlex}>
      <FlatList
        style={styles.listaFlex}
        contentContainerStyle={styles.listaConteudo}
        data={grupos}
        keyExtractor={(g) => g.vendaId}
        renderItem={({ item }) => <CardNota grupo={item} marcados={marcados} editavel={editavel} onAlternar={alternarItem} />}
        ListHeaderComponent={
          <>
            {cabecalho}
            <Card>
              <Text style={styles.rotulo}>Clientes ofertados hoje</Text>
              {editavel ? (
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={clientesOfertadosTexto}
                  onChangeText={(texto) => setClientesOfertadosTexto(texto.replace(/\D/g, ''))}
                  placeholder="0"
                />
              ) : (
                <Text style={styles.campoSomenteLeitura}>{clientesOfertadosTexto}</Text>
              )}
              {metaClientesOfertadosDia != null && (
                <Text style={styles.hint}>
                  Meta da campanha: oferecer o complementar a pelo menos {metaClientesOfertadosDia}{' '}
                  {metaClientesOfertadosDia === 1 ? 'cliente' : 'clientes'} por dia.
                </Text>
              )}
            </Card>
          </>
        }
        ListEmptyComponent={
          <Card>
            <Text style={styles.empty}>Nenhuma venda nesse dia.</Text>
          </Card>
        }
      />
      {editavel && (
        <View style={styles.rodapeFixo}>
          <Text style={styles.resumoSelecaoTexto}>
            {resumoSelecao.quantidade > 0
              ? `${resumoSelecao.quantidade} ${resumoSelecao.quantidade === 1 ? 'item selecionado' : 'itens selecionados'} · ${formatBRL(resumoSelecao.valor)}`
              : 'Nenhum item selecionado ainda'}
          </Text>
          <Pressable style={styles.botaoSalvar} onPress={salvar} disabled={salvando}>
            {salvando ? <ActivityIndicator color={colors.white} /> : <Text style={styles.botaoTexto}>Salvar</Text>}
          </Pressable>
        </View>
      )}
      <ModalSalvo info={modalSalvo} onClose={() => setModalSalvo(null)} />
    </View>
  );
}

// Card fixo embaixo do seletor de dia: info da campanha (período,
// pisos, premiação) + desempenho de TODOS os vendedores no período —
// mesma conta de AndamentoCampanha, só que sempre visível (não precisa
// clicar "ver ranking") nas telas principais de vendedor e gestor.
function CardResumoCampanha({ campanha }: { campanha: CampanhaComplementar }) {
  const { profile } = useAuth();
  const [vendas, setVendas] = useState<VendaComplementarMarcada[]>([]);
  const [ofertas, setOfertas] = useState<OfertaComplementarDia[]>([]);
  const [vendedores, setVendedores] = useState<VendedorAtivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [diaAberto, setDiaAberto] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setLoading(true);
    Promise.all([
      repository.getVendasComplementaresCampanha(profile, campanha.id),
      repository.getOfertaComplementarPeriodo(profile, campanha.dataInicio, campanha.dataFim),
      repository.getVendedoresAtivos(profile),
    ])
      .then(([vendasResp, ofertasResp, vendedoresResp]) => {
        setVendas(vendasResp);
        setOfertas(ofertasResp);
        setVendedores(vendedoresResp);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [profile, campanha.id, campanha.dataInicio, campanha.dataFim]);

  const ranking = useMemo(() => calcularRankingComplementar(vendas, campanha), [vendas, campanha]);
  const resultadoPorDia = useMemo(
    () => agruparResultadoComplementarPorDia(vendas, ofertas, vendedores),
    [vendas, ofertas, vendedores]
  );
  const totalPeriodo = useMemo(
    () => totalComplementarPorVendedor(vendas, ofertas, vendedores),
    [vendas, ofertas, vendedores]
  );

  return (
    <Card>
      <Text style={styles.cardTitulo}>
        {formatDateBR(campanha.dataInicio)} a {formatDateBR(campanha.dataFim)}
      </Text>
      <Text style={styles.campanhaResumo}>
        ranking: {(campanha.premiacaoRanking ?? []).map((p) => `${p.posicao}º ${formatBRL(p.valor)}`).join(', ')}
        {campanha.valorMinimo != null ? ` · mínimo ${formatBRL(campanha.valorMinimo)}` : ''}
        {campanha.quantidadeMinima != null ? ` · mín. ${campanha.quantidadeMinima} itens` : ''}
        {campanha.metaClientesOfertadosDia != null ? ` · meta ${campanha.metaClientesOfertadosDia} clientes/dia` : ''}
      </Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 8 }} />
      ) : ranking.length === 0 ? (
        <Text style={[styles.empty, styles.espacado]}>Ninguém marcou venda complementar ainda nesse período.</Text>
      ) : (
        <View style={styles.espacado}>
          {ranking.map((item) => (
            <View key={item.codigoVendedor} style={styles.andamentoLinha}>
              <Text style={styles.andamentoNome} numberOfLines={1}>
                {item.premio != null ? medalhaPosicaoComplementar(item.posicao) : `${item.posicao}º`}{' '}
                {item.nomeVendedor}
              </Text>
              <Text style={styles.andamentoValor}>
                {formatBRL(item.valorTotal)} · {item.quantidadeTotal} {item.quantidadeTotal === 1 ? 'item' : 'itens'}
                {item.premio != null ? ` · ${formatBRL(item.premio)}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      {!loading && resultadoPorDia.length > 0 && (
        <View style={styles.espacado}>
          <Text style={styles.cardTitulo}>Resultado por dia</Text>
          {resultadoPorDia.map((grupo) => {
            const aberto = diaAberto === grupo.data;
            return (
              <View key={grupo.data} style={styles.resultadoDiaBloco}>
                <Pressable
                  style={styles.resultadoDiaToggle}
                  onPress={() => setDiaAberto(aberto ? null : grupo.data)}
                >
                  <Text style={styles.resultadoDiaData}>{formatDateBR(grupo.data)}</Text>
                  <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={16} color={colors.navy} />
                </Pressable>
                {aberto && (
                  <View>
                    {grupo.itens.map((item) => (
                      <View key={item.codigoVendedor} style={styles.andamentoLinha}>
                        <Text style={styles.andamentoNome} numberOfLines={1}>
                          {item.nomeVendedor}
                        </Text>
                        <Text style={styles.andamentoValor}>
                          {item.clientesOfertados != null ? `${item.clientesOfertados} ofertados` : 'sem info'} ·{' '}
                          {item.quantidadeItens} {item.quantidadeItens === 1 ? 'item' : 'itens'} ·{' '}
                          {formatBRL(item.valorVenda)}
                        </Text>
                      </View>
                    ))}

                    <Text style={styles.resultadoTotalTitulo}>Total do período</Text>
                    {totalPeriodo.map((item) => (
                      <View key={item.codigoVendedor} style={styles.andamentoLinha}>
                        <Text style={styles.andamentoNome} numberOfLines={1}>
                          {item.nomeVendedor}
                        </Text>
                        <Text style={styles.andamentoValor}>
                          {item.clientesOfertados != null ? `${item.clientesOfertados} ofertados` : 'sem info'} ·{' '}
                          {item.quantidadeItens} {item.quantidadeItens === 1 ? 'item' : 'itens'} ·{' '}
                          {formatBRL(item.valorVenda)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

// Aba do vendedor: seletor de dia + viewer dos próprios itens.
// Qualquer dia dentro do período do ranking é editável (liberado
// 01/09/2026 — antes só dava pra marcar o dia de hoje).
function TelaVendedor({ codigoVendedor }: { codigoVendedor: number }) {
  const { inicio, fim, temCampanha, campanha } = usePeriodoVigente();
  const [diaSelecionado, setDiaSelecionado] = useDiaNoPeriodo(inicio, fim);
  const editavel = true;
  // Muda a cada "Salvar" bem-sucedido — vira key do card, forçando ele
  // a buscar de novo e refletir na hora o que acabou de ser marcado.
  const [versaoResumo, setVersaoResumo] = useState(0);

  return (
    <View style={styles.telaFlex}>
      <ItensDoDia
        codigoVendedor={codigoVendedor}
        diaSelecionado={diaSelecionado}
        editavel={editavel}
        metaClientesOfertadosDia={campanha?.metaClientesOfertadosDia}
        onSalvar={() => setVersaoResumo((v) => v + 1)}
        cabecalho={
          <>
            <SeletorDia inicio={inicio} fim={fim} selecionado={diaSelecionado} onSelecionar={setDiaSelecionado} />
            {campanha && <CardResumoCampanha key={versaoResumo} campanha={campanha} />}
            {!temCampanha && (
              <Text style={styles.hintSomenteLeitura}>Nenhum período de ranking cadastrado ainda — mostrando a semana atual.</Text>
            )}
          </>
        }
      />
    </View>
  );
}

interface ResumoVendedorDia {
  codigoVendedor: number;
  nomeVendedor: string;
  faturamentoLiquido: number;
  qtdNotas: number;
}

function CardResumoVendedor({ resumo, onPress }: { resumo: ResumoVendedorDia; onPress: () => void }) {
  return (
    <Card onPress={onPress}>
      <View style={styles.resumoLinha}>
        <Text style={styles.resumoNome} numberOfLines={1}>
          {resumo.nomeVendedor}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
      <View style={styles.resumoLinha}>
        <Text style={styles.resumoValor}>{formatBRL(resumo.faturamentoLiquido)}</Text>
        <Text style={styles.resumoNotas}>
          {resumo.qtdNotas} {resumo.qtdNotas === 1 ? 'nota' : 'notas'}
        </Text>
      </View>
    </Card>
  );
}

// Aba "Marcar" do gestor: seletor de dia + card de resumo (faturamento
// do dia) por vendedor, do maior pro menor — tocar um card abre o
// viewer (ItensDoDia) daquele vendedor. Gestor marca/desmarca
// qualquer dia, não só hoje.
function TelaGestorMarcar() {
  const { profile } = useAuth();
  const { inicio, fim, temCampanha, campanha } = usePeriodoCampanhaGestor();
  const [diaSelecionado, setDiaSelecionado] = useDiaNoPeriodo(inicio, fim);
  const [vendedores, setVendedores] = useState<VendedorAtivo[]>([]);
  const [resumos, setResumos] = useState<ResumoVendedorDia[]>([]);
  const [loadingResumo, setLoadingResumo] = useState(true);
  const [vendedorAberto, setVendedorAberto] = useState<number | null>(null);
  // Muda a cada "Salvar" bem-sucedido no viewer de um vendedor — vira
  // key do card, forçando ele a buscar de novo assim que o gestor
  // volta pra lista.
  const [versaoResumo, setVersaoResumo] = useState(0);

  useEffect(() => {
    if (!profile) return;
    repository.getVendedoresAtivos(profile).then(setVendedores);
  }, [profile]);

  useEffect(() => {
    if (!profile || vendedores.length === 0) return;
    setLoadingResumo(true);
    repository
      .getMetricasVendedorPeriodo(profile, diaSelecionado, diaSelecionado)
      .then((metricas) => {
        const porVendedor = new Map(metricas.map((m) => [m.codigoVendedor, m]));
        const lista: ResumoVendedorDia[] = vendedores.map((v) => ({
          codigoVendedor: v.codigo,
          nomeVendedor: v.nome,
          faturamentoLiquido: porVendedor.get(v.codigo)?.faturamentoLiquido ?? 0,
          qtdNotas: porVendedor.get(v.codigo)?.qtdNotas ?? 0,
        }));
        lista.sort((a, b) => b.faturamentoLiquido - a.faturamentoLiquido);
        setResumos(lista);
      })
      .catch((erro) => {
        alertar('Erro ao carregar', erro instanceof Error ? erro.message : 'Tente novamente.');
      })
      .finally(() => setLoadingResumo(false));
  }, [profile, diaSelecionado, vendedores]);

  if (vendedorAberto != null) {
    const vendedorNome = vendedores.find((v) => v.codigo === vendedorAberto)?.nome ?? 'Vendedor';
    return (
      <View style={styles.telaFlex}>
        <ItensDoDia
          codigoVendedor={vendedorAberto}
          diaSelecionado={diaSelecionado}
          editavel
          metaClientesOfertadosDia={campanha?.metaClientesOfertadosDia}
          onSalvar={() => setVersaoResumo((v) => v + 1)}
          cabecalho={
            <>
              <Pressable style={styles.voltar} onPress={() => setVendedorAberto(null)} hitSlop={8}>
                <Ionicons name="arrow-back" size={18} color={colors.navy} />
                <Text style={styles.voltarTexto} numberOfLines={1}>
                  {vendedorNome}
                </Text>
              </Pressable>
              <SeletorDia inicio={inicio} fim={fim} selecionado={diaSelecionado} onSelecionar={setDiaSelecionado} />
            </>
          }
        />
      </View>
    );
  }

  return (
    <View style={styles.telaFlex}>
      <FlatList
        style={styles.listaFlex}
        contentContainerStyle={styles.listaConteudo}
        data={resumos}
        keyExtractor={(r) => String(r.codigoVendedor)}
        renderItem={({ item }) => (
          <CardResumoVendedor resumo={item} onPress={() => setVendedorAberto(item.codigoVendedor)} />
        )}
        ListHeaderComponent={
          <>
            <SeletorDia inicio={inicio} fim={fim} selecionado={diaSelecionado} onSelecionar={setDiaSelecionado} />
            {campanha && <CardResumoCampanha key={versaoResumo} campanha={campanha} />}
            {!temCampanha && (
              <Text style={styles.hintSomenteLeitura}>Nenhum período de ranking cadastrado ainda — mostrando a semana atual.</Text>
            )}
          </>
        }
        ListEmptyComponent={
          loadingResumo ? (
            <ActivityIndicator style={{ marginTop: 16 }} />
          ) : (
            <Card>
              <Text style={styles.empty}>Nenhum vendedor ativo.</Text>
            </Card>
          )
        }
      />
    </View>
  );
}

function somarDias(iso: string, dias: number): string {
  const data = new Date(`${iso}T00:00:00`);
  data.setDate(data.getDate() + dias);
  return data.toISOString().slice(0, 10);
}

// Andamento/ranking de uma campanha já cadastrada, mesmo padrão de
// AndamentoCampanha em VendaAdicionalScreen.
function AndamentoCampanha({ campanha }: { campanha: CampanhaComplementar }) {
  const { profile } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [vendas, setVendas] = useState<VendaComplementarMarcada[]>([]);
  const [ofertas, setOfertas] = useState<OfertaComplementarDia[]>([]);
  const [vendedores, setVendedores] = useState<VendedorAtivo[]>([]);
  const [carregando, setCarregando] = useState(false);
  // Qual dia (de qual vendedor) está expandido mostrando os produtos —
  // chave `${codigoVendedor}:${data}`, um painel só compartilhado entre
  // todos os vendedores dessa campanha.
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  // Qual vendedor está com a lista de dias aberta — por padrão o
  // resultado por dia fica escondido, só aparece ao clicar no nome
  // (pedido 01/09/2026: por dia era ruído demais, só o total interessa
  // de cara).
  const [vendedorAberto, setVendedorAberto] = useState<number | null>(null);

  const alternar = async () => {
    if (aberto) {
      setAberto(false);
      return;
    }
    setAberto(true);
    if (vendas.length > 0 || !profile) return;
    setCarregando(true);
    try {
      const [vendasResp, ofertasResp, vendedoresResp] = await Promise.all([
        repository.getVendasComplementaresCampanha(profile, campanha.id),
        repository.getOfertaComplementarPeriodo(profile, campanha.dataInicio, campanha.dataFim),
        repository.getVendedoresAtivos(profile),
      ]);
      setVendas(vendasResp);
      setOfertas(ofertasResp);
      setVendedores(vendedoresResp);
    } finally {
      setCarregando(false);
    }
  };

  // Ofertados somados no período inteiro por vendedor — não tem no
  // ranking em si (calcularRankingComplementar só conhece venda
  // marcada), pedido explícito 24/08/2026 pra aparecer junto de
  // itens/valor, sem quebrar por dia.
  const ofertadosPorVendedor = useMemo(() => {
    const totais = totalComplementarPorVendedor(vendas, ofertas, vendedores);
    return new Map(totais.map((t) => [t.codigoVendedor, t.clientesOfertados]));
  }, [vendas, ofertas, vendedores]);

  return (
    <View>
      <Pressable style={styles.andamentoToggle} onPress={alternar}>
        <Text style={styles.andamentoToggleTexto}>Ver ranking</Text>
        <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={26} color={colors.navy} />
      </Pressable>
      {aberto && (
        <View style={styles.andamentoPainel}>
          {carregando ? (
            <ActivityIndicator style={{ marginTop: 6 }} />
          ) : vendas.length === 0 ? (
            <Text style={styles.empty}>Nenhuma venda complementar marcada nesse período ainda.</Text>
          ) : (
            calcularRankingComplementar(vendas, campanha).map((item) => {
              const diasDoVendedor = agruparVendasPorDiaDoVendedor(vendas, item.codigoVendedor);
              const ofertados = ofertadosPorVendedor.get(item.codigoVendedor) ?? null;
              const vendedorEstaAberto = vendedorAberto === item.codigoVendedor;
              return (
                <View key={item.codigoVendedor} style={styles.andamentoBloco}>
                  <Pressable
                    style={styles.andamentoLinha}
                    onPress={() =>
                      setVendedorAberto((atual) => (atual === item.codigoVendedor ? null : item.codigoVendedor))
                    }
                  >
                    <Text style={styles.andamentoNome} numberOfLines={1}>
                      {item.premio != null ? medalhaPosicaoComplementar(item.posicao) : `${item.posicao}º`}{' '}
                      {item.nomeVendedor}
                    </Text>
                    <View style={styles.andamentoValorRow}>
                      <Text style={styles.andamentoValor}>
                        {ofertados != null ? `${ofertados} ofertados · ` : ''}
                        {item.quantidadeTotal} {item.quantidadeTotal === 1 ? 'item' : 'itens'} · {formatBRL(item.valorTotal)}
                        {item.premio != null ? ` · ${formatBRL(item.premio)}` : ''}
                      </Text>
                      <Ionicons
                        name={vendedorEstaAberto ? 'chevron-up' : 'chevron-down'}
                        size={24}
                        color={colors.textMuted}
                      />
                    </View>
                  </Pressable>
                  {vendedorEstaAberto &&
                    diasDoVendedor.map((dia) => {
                      const chave = `${item.codigoVendedor}:${dia.data}`;
                      const diaEstaAberto = diaAberto === chave;
                      return (
                        <View key={dia.data} style={styles.diaVendedorBloco}>
                          <Pressable
                            style={styles.diaVendedorLinha}
                            onPress={() => setDiaAberto((atual) => (atual === chave ? null : chave))}
                          >
                            <View style={styles.diaVendedorInfo}>
                              <Text style={styles.resultadoDiaData}>{formatDateBR(dia.data)}</Text>
                              <Text style={styles.andamentoValor}>
                                {dia.atendimentos} {dia.atendimentos === 1 ? 'atendimento' : 'atendimentos'} ·{' '}
                                {dia.quantidadeItens} {dia.quantidadeItens === 1 ? 'item' : 'itens'} ·{' '}
                                {formatBRL(dia.valorVenda)}
                              </Text>
                            </View>
                            <Ionicons
                              name={diaEstaAberto ? 'chevron-up' : 'chevron-down'}
                              size={20}
                              color={colors.textMuted}
                            />
                          </Pressable>
                          {diaEstaAberto && <Text style={styles.andamentoProdutos}>{dia.produtos}</Text>}
                        </View>
                      );
                    })}
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

function TelaRankingGestor() {
  const { profile } = useAuth();
  const [modo, setModo] = useState<'lista' | 'nova'>('lista');
  const [campanhas, setCampanhas] = useState<CampanhaComplementar[]>([]);
  const [loadingLista, setLoadingLista] = useState(true);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [dataInicio, setDataInicio] = useState(todayISO());
  const [dataFim, setDataFim] = useState(somarDias(todayISO(), 30));
  const [calendarioAberto, setCalendarioAberto] = useState(false);
  const [valorMinimo, setValorMinimo] = useState('');
  const [quantidadeMinima, setQuantidadeMinima] = useState('');
  const [metaClientesOfertadosDia, setMetaClientesOfertadosDia] = useState('10');
  const [premios, setPremios] = useState([200, 100, 50].map(moedaParaTexto));
  const [salvando, setSalvando] = useState(false);

  const carregarLista = useCallback(async () => {
    if (!profile) return;
    setLoadingLista(true);
    try {
      setCampanhas(await repository.getCampanhasComplementares(profile));
    } catch (erro) {
      alertar('Erro ao carregar', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setLoadingLista(false);
    }
  }, [profile]);

  useEffect(() => {
    carregarLista();
  }, [carregarLista]);

  const limparFormulario = () => {
    setDataInicio(todayISO());
    setDataFim(somarDias(todayISO(), 30));
    setValorMinimo('');
    setQuantidadeMinima('');
    setMetaClientesOfertadosDia('10');
    setPremios([200, 100, 50].map(moedaParaTexto));
  };

  const abrirNova = () => {
    setEditandoId(null);
    limparFormulario();
    setModo('nova');
  };

  const abrirEdicao = (campanha: CampanhaComplementar) => {
    setEditandoId(campanha.id);
    setDataInicio(campanha.dataInicio);
    setDataFim(campanha.dataFim);
    setValorMinimo(campanha.valorMinimo != null ? moedaParaTexto(campanha.valorMinimo) : '');
    setQuantidadeMinima(campanha.quantidadeMinima != null ? String(campanha.quantidadeMinima) : '');
    setMetaClientesOfertadosDia(campanha.metaClientesOfertadosDia != null ? String(campanha.metaClientesOfertadosDia) : '');
    const porPosicao = new Map((campanha.premiacaoRanking ?? []).map((p) => [p.posicao, p.valor]));
    setPremios([1, 2, 3].map((posicao) => {
      const valor = porPosicao.get(posicao);
      return valor != null ? moedaParaTexto(valor) : '';
    }));
    setModo('nova');
  };

  const salvar = async () => {
    if (!profile) return;
    const premiacaoRanking = premios
      .map((valor, index) => ({ posicao: index + 1, valor: parseDecimalBR(valor) }))
      .filter((p) => p.valor > 0);
    if (premiacaoRanking.length === 0) {
      alertar('Premiação vazia', 'Preencha pelo menos o prêmio do 1º lugar.');
      return;
    }
    const valorMinimoTexto = valorMinimo.trim();
    let valorMinimoInput: number | null = null;
    if (valorMinimoTexto) {
      valorMinimoInput = parseDecimalBR(valorMinimoTexto);
      if (valorMinimoInput <= 0) {
        alertar('Mínimo inválido', 'O valor mínimo precisa ser maior que 0 (ou deixe em branco pra não ter piso).');
        return;
      }
    }
    const quantidadeMinimaTexto = quantidadeMinima.trim();
    let quantidadeMinimaInput: number | null = null;
    if (quantidadeMinimaTexto) {
      quantidadeMinimaInput = Math.trunc(Number(quantidadeMinimaTexto)) || 0;
      if (quantidadeMinimaInput <= 0) {
        alertar('Quantidade inválida', 'A quantidade mínima precisa ser maior que 0 (ou deixe em branco pra não ter piso).');
        return;
      }
    }
    const metaClientesTexto = metaClientesOfertadosDia.trim();
    let metaClientesInput: number | null = null;
    if (metaClientesTexto) {
      metaClientesInput = Math.trunc(Number(metaClientesTexto)) || 0;
      if (metaClientesInput <= 0) {
        alertar('Meta inválida', 'A meta de clientes ofertados por dia precisa ser maior que 0 (ou deixe em branco pra não ter meta).');
        return;
      }
    }

    setSalvando(true);
    try {
      await repository.salvarCampanhaComplementar(profile, {
        id: editandoId ?? undefined,
        dataInicio,
        dataFim,
        valorMinimo: valorMinimoInput,
        quantidadeMinima: quantidadeMinimaInput,
        metaClientesOfertadosDia: metaClientesInput,
        premiacaoRanking,
      });
      setModo('lista');
      setEditandoId(null);
      limparFormulario();
      await carregarLista();
    } catch (erro) {
      alertar('Erro ao salvar', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = (campanha: CampanhaComplementar) => {
    confirmar(
      'Excluir período',
      'Excluir esse período de ranking? O histórico de acompanhamento some junto.',
      async () => {
        try {
          await repository.excluirCampanhaComplementar(campanha.id);
          await carregarLista();
        } catch (erro) {
          alertar('Erro ao excluir', erro instanceof Error ? erro.message : 'Tente novamente.');
        }
      },
      { textoConfirmar: 'Excluir', destrutivo: true }
    );
  };

  if (modo === 'nova') {
    return (
      <ScrollView style={styles.telaFlex} contentContainerStyle={styles.formConteudo}>
        <Pressable style={styles.voltar} onPress={() => setModo('lista')} hitSlop={8}>
          <Ionicons name="arrow-back" size={18} color={colors.navy} />
          <Text style={styles.voltarTexto}>Ranking e premiação</Text>
        </Pressable>

        <Card>
          <Text style={styles.cardTitulo}>Período</Text>
          <Pressable style={styles.botaoPeriodo} onPress={() => setCalendarioAberto(true)}>
            <Ionicons name="calendar-outline" size={18} color={colors.navy} />
            <Text style={styles.botaoPeriodoTexto}>
              {dataInicio === dataFim ? formatDateBR(dataInicio) : `${formatDateBR(dataInicio)} até ${formatDateBR(dataFim)}`}
            </Text>
          </Pressable>
        </Card>

        <Card>
          <Text style={styles.cardTitulo}>Premiação</Text>
          <Text style={styles.hint}>
            Ranqueado pela soma do valor de tudo que cada vendedor marcou como complementar no período.
          </Text>
          {['1º lugar', '2º lugar', '3º lugar'].map((rotulo, index) => (
            <View key={rotulo} style={styles.semanaInputRow}>
              <Text style={styles.semanaRotulo}>{rotulo}</Text>
              <TextInput
                style={[styles.input, styles.inputSemana]}
                keyboardType="numeric"
                value={premios[index]}
                onChangeText={(texto) =>
                  setPremios((atual) => atual.map((v, i) => (i === index ? aplicarMascaraMoeda(texto) : v)))
                }
                placeholder="R$"
              />
            </View>
          ))}
          <Text style={[styles.rotulo, styles.espacado]}>Valor mínimo pra concorrer (opcional)</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={valorMinimo}
            onChangeText={(texto) => setValorMinimo(aplicarMascaraMoeda(texto))}
            placeholder="250,00"
          />
          <Text style={styles.hint}>Quem vender menos que isso em complementares não entra no ranking.</Text>

          <Text style={[styles.rotulo, styles.espacado]}>Quantidade mínima de itens (opcional)</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={quantidadeMinima}
            onChangeText={setQuantidadeMinima}
            placeholder="5"
          />
          <Text style={styles.hint}>Quem marcar menos itens que isso não entra no ranking (some com o valor mínimo, se os dois estiverem preenchidos).</Text>
        </Card>

        <Card>
          <Text style={styles.cardTitulo}>Meta de oferta</Text>
          <Text style={styles.hint}>
            Quantos clientes o vendedor deve oferecer o complementar por dia — informativo, não dá pra controlar se ele
            realmente ofereceu. O próprio vendedor informa esse número na aba dele.
          </Text>
          <Text style={styles.rotulo}>Clientes ofertados por dia (opcional)</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={metaClientesOfertadosDia}
            onChangeText={setMetaClientesOfertadosDia}
            placeholder="10"
          />
        </Card>

        <Pressable style={styles.botaoSalvar} onPress={salvar} disabled={salvando}>
          {salvando ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.botaoTexto}>{editandoId ? 'Salvar alterações' : 'Salvar período'}</Text>
          )}
        </Pressable>

        <CalendarioPeriodo
          visible={calendarioAberto}
          onClose={() => setCalendarioAberto(false)}
          permitirDatasFuturas
          onConfirmar={(inicio, fim) => {
            setDataInicio(inicio);
            setDataFim(fim);
          }}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.telaFlex} contentContainerStyle={styles.formConteudo}>
      <Pressable style={styles.botaoNova} onPress={abrirNova}>
        <Ionicons name="add" size={18} color={colors.white} />
        <Text style={styles.botaoTexto}>Novo período de premiação</Text>
      </Pressable>

      {loadingLista ? (
        <ActivityIndicator style={{ marginTop: 16 }} />
      ) : campanhas.length === 0 ? (
        <Card>
          <Text style={styles.empty}>Nenhum período cadastrado ainda.</Text>
        </Card>
      ) : (
        campanhas.map((campanha) => (
          <Card key={campanha.id}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemNome}>
                {formatDateBR(campanha.dataInicio)} a {formatDateBR(campanha.dataFim)}
              </Text>
              <View style={styles.itemAcoes}>
                <Pressable onPress={() => abrirEdicao(campanha)} hitSlop={8}>
                  <Ionicons name="pencil-outline" size={18} color={colors.navy} />
                </Pressable>
                <Pressable onPress={() => excluir(campanha)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={colors.red} />
                </Pressable>
              </View>
            </View>
            <Text style={styles.campanhaResumo}>
              ranking: {(campanha.premiacaoRanking ?? []).map((p) => `${p.posicao}º ${formatBRL(p.valor)}`).join(', ')}
              {campanha.valorMinimo != null ? ` · mínimo ${formatBRL(campanha.valorMinimo)}` : ''}
              {campanha.quantidadeMinima != null ? ` · mín. ${campanha.quantidadeMinima} itens` : ''}
              {campanha.metaClientesOfertadosDia != null ? ` · meta ${campanha.metaClientesOfertadosDia} clientes/dia` : ''}
            </Text>
            <AndamentoCampanha campanha={campanha} />
          </Card>
        ))
      )}
    </ScrollView>
  );
}

function TelaGestor() {
  const [aba, setAba] = useState<'marcar' | 'ranking'>('marcar');

  return (
    <View style={styles.telaFlex}>
      <View style={styles.segmentedWrap}>
        <Pressable style={[styles.segmentButton, aba === 'marcar' && styles.segmentButtonAtivo]} onPress={() => setAba('marcar')}>
          <Text style={[styles.segmentText, aba === 'marcar' && styles.segmentTextAtivo]}>Marcar por vendedor</Text>
        </Pressable>
        <Pressable style={[styles.segmentButton, aba === 'ranking' && styles.segmentButtonAtivo]} onPress={() => setAba('ranking')}>
          <Text style={[styles.segmentText, aba === 'ranking' && styles.segmentTextAtivo]}>Ranking e premiação</Text>
        </Pressable>
      </View>

      {aba === 'marcar' ? <TelaGestorMarcar /> : <TelaRankingGestor />}
    </View>
  );
}

export function VendasComplementaresScreen() {
  const { profile } = useAuth();
  const ehGestor = profile?.role === 'gestor';

  return (
    <KeyboardAvoidingView style={styles.telaFlex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.container}>
        <Text style={styles.title}>🧩 Vendas Complementares</Text>
        <Text style={styles.subtitle}>
          {ehGestor
            ? 'Acompanhe o que cada vendedor marcou como venda complementar, e configure o ranking de premiação.'
            : 'Marque quais itens das suas vendas de hoje foram venda complementar (upsell).'}
        </Text>

        {ehGestor ? (
          <TelaGestor />
        ) : profile?.codigoVendedor != null ? (
          <TelaVendedor codigoVendedor={profile.codigoVendedor} />
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 16, lineHeight: 18 },
  empty: { color: colors.textSecondary },
  telaFlex: { flex: 1 },
  listaFlex: { flex: 1 },
  listaConteudo: { paddingBottom: 12 },
  formConteudo: { paddingBottom: 24 },
  rodapeFixo: {
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  resumoSelecaoTexto: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSalvoFundo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  modalSalvoCartao: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 24,
    width: '85%',
    maxWidth: 340,
    alignItems: 'center',
  },
  modalSalvoEmoji: { fontSize: 44, marginBottom: 10 },
  modalSalvoFrase: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  modalSalvoResumo: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 20 },
  modalSalvoBotao: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  seletorDiaWrap: { marginBottom: 12, flexGrow: 0 },
  seletorDiaConteudo: { gap: 8, paddingRight: 8 },
  diaBotao: {
    height: 80,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  diaBotaoAtivo: { backgroundColor: colors.navy, borderColor: colors.navy },
  diaTextoDia: { fontSize: 21, fontWeight: '700', color: colors.textPrimary },
  diaTextoMes: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase' },
  diaTextoAtivo: { color: colors.white },
  diaPontoHoje: { position: 'absolute', bottom: 6, width: 4, height: 4, borderRadius: 2, backgroundColor: colors.navy },
  diaPontoHojeAtivo: { backgroundColor: colors.white },
  hintSomenteLeitura: { fontSize: 12, color: colors.textMuted, marginBottom: 8, fontStyle: 'italic' },
  notaCabecalho: { fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  notaCliente: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  itemLinha: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  itemProduto: { flex: 1, fontSize: 13, color: colors.textPrimary },
  itemValor: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  botaoSalvar: {
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  botaoTexto: { color: colors.white, fontWeight: '700', fontSize: 14 },
  botaoNova: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 16,
  },
  segmentedWrap: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
  },
  segmentButton: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentButtonAtivo: { backgroundColor: colors.navy },
  segmentText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  segmentTextAtivo: { color: colors.white },
  resumoLinha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resumoNome: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  resumoValor: { fontSize: 15, fontWeight: '700', color: colors.navy, marginTop: 4 },
  resumoNotas: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  voltar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  voltarTexto: { color: colors.navy, fontWeight: '600', fontSize: 14, flexShrink: 1 },
  cardTitulo: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  rotulo: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  campoSomenteLeitura: { fontSize: 15, color: colors.textPrimary, fontWeight: '700' },
  espacado: { marginTop: 10 },
  hint: { fontSize: 11, color: colors.textMuted, marginBottom: 8, lineHeight: 15 },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  botaoPeriodo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.border,
  },
  botaoPeriodoTexto: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  semanaInputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  semanaRotulo: { fontSize: 12, color: colors.textSecondary, width: 64 },
  inputSemana: { flex: 1 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 },
  itemNome: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  itemAcoes: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  campanhaResumo: { fontSize: 12, color: colors.textMuted },
  andamentoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 12,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  andamentoToggleTexto: { fontSize: 14, fontWeight: '600', color: colors.navy },
  andamentoPainel: { marginTop: 6 },
  andamentoBloco: { paddingVertical: 4 },
  andamentoLinha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  andamentoNome: { flex: 1, fontSize: 12, color: colors.textPrimary },
  andamentoValor: { fontSize: 12, color: colors.textSecondary },
  andamentoValorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  andamentoProdutos: { fontSize: 11, color: colors.textMuted, marginTop: 2, marginLeft: 10 },
  diaVendedorBloco: { marginTop: 2 },
  diaVendedorLinha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 10,
  },
  diaVendedorInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  resultadoDiaBloco: { marginTop: 8 },
  resultadoDiaToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  resultadoDiaData: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  resultadoTotalTitulo: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginTop: 8, marginBottom: 2 },
});
