import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { repository } from '../data';
import { Card } from '../components/Card';
import { CalendarioPeriodo } from '../components/CalendarioPeriodo';
import { SeletorHorario } from '../components/SeletorHorario';
import { colors } from '../theme/colors';
import { formatBRL, formatDateBR, parseDecimalBR, todayISO } from '../lib/format';
import { alertar, confirmar } from '../lib/alert';
import { calcularMetaIndividualVendaAdicional, calcularRankingVendaAdicional, medalhaPosicao } from '../lib/vendaAdicional';
import { aplicarMascaraMoeda, moedaParaTexto } from '../lib/moeda';
import {
  CampanhaVendaAdicional,
  CriterioQuantidadeVendaAdicional,
  ProdutoCatalogo,
  TipoPremiacaoVendaAdicional,
  VendaVendaAdicional,
} from '../types/domain';

type Modo = 'lista' | 'nova';

function somarDias(iso: string, dias: number): string {
  const data = new Date(`${iso}T00:00:00`);
  data.setDate(data.getDate() + dias);
  return data.toISOString().slice(0, 10);
}

// Andamento de uma campanha já cadastrada — busca as vendas só quando
// o gestor expande o card, mesmo padrão "lazy" usado em Alertas.
function AndamentoCampanha({ campanha }: { campanha: CampanhaVendaAdicional }) {
  const { profile } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [vendas, setVendas] = useState<VendaVendaAdicional[]>([]);
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
      setVendas(await repository.getVendasVendaAdicional(profile, campanha.id));
    } finally {
      setCarregando(false);
    }
  };

  // Calculado sempre (não só dentro do JSX) pra dar pra checar
  // .length === 0 e mostrar uma mensagem clara. calcularRankingVendaAdicional
  // sempre traz TODO MUNDO que vendeu, ranqueado (mesmo quem não bateu
  // o mínimo pra concorrer) — só o prêmio em si fica condicionado ao
  // mínimo (21/08/2026, revertendo o filtro que escondia quem não
  // batia, que fazia o painel parecer vazio/quebrado com venda real
  // registrada).
  const parciais =
    campanha.tipoPremiacao === 'ranking'
      ? calcularRankingVendaAdicional(vendas, campanha)
      : calcularMetaIndividualVendaAdicional(vendas, campanha);

  return (
    <View>
      <Pressable style={styles.andamentoToggle} onPress={alternar}>
        <Text style={styles.andamentoToggleTexto}>Ver andamento</Text>
        <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={16} color={colors.navy} />
      </Pressable>
      {aberto && (
        <View style={styles.andamentoPainel}>
          {carregando ? (
            <ActivityIndicator style={{ marginTop: 6 }} />
          ) : vendas.length === 0 ? (
            <Text style={styles.empty}>Nenhuma venda registrada nessa campanha ainda.</Text>
          ) : parciais.length === 0 ? (
            <Text style={styles.empty}>Nenhuma venda com vendedor identificado ainda.</Text>
          ) : (
            <>
              {campanha.criterioQuantidade === 'mesma_venda' && (
                <Text style={styles.hint}>Considerando o maior cupom individual de cada vendedor, não a soma do período.</Text>
              )}
              {campanha.criterioQuantidade === 'venda_com_outros_itens' && (
                <Text style={styles.hint}>Contando só venda que veio com outro item junto — quem comprou sozinho não entra na conta.</Text>
              )}
              {campanha.tipoPremiacao === 'ranking'
                ? parciais.map((item) => (
                    <View key={item.codigoVendedor} style={styles.andamentoLinha}>
                      <Text style={styles.andamentoNome} numberOfLines={1}>
                        {'posicao' in item
                          ? `${item.premio != null ? medalhaPosicao(item.posicao) : `${item.posicao}º`} `
                          : ''}
                        {item.nomeVendedor}
                      </Text>
                      <Text style={styles.andamentoValor}>
                        {item.quantidadeTotal} un. · {formatBRL(item.valorTotal)}
                        {'premio' in item && item.premio != null ? ` · ${formatBRL(item.premio)}` : ''}
                      </Text>
                    </View>
                  ))
                : parciais.map((item) => (
                    <View key={item.codigoVendedor} style={styles.andamentoLinha}>
                      <Text style={styles.andamentoNome} numberOfLines={1}>
                        {'bateu' in item && item.bateu ? '✅' : '▫️'} {item.nomeVendedor}
                      </Text>
                      <Text style={styles.andamentoValor}>
                        {item.quantidadeTotal} de {campanha.metaQuantidade} · {formatBRL(item.valorTotal)}
                        {'premio' in item && item.premio != null ? ` · ${formatBRL(item.premio)}` : ''}
                      </Text>
                    </View>
                  ))}
            </>
          )}
        </View>
      )}
    </View>
  );
}

export function VendaAdicionalScreen() {
  const { profile } = useAuth();
  const [modo, setModo] = useState<Modo>('lista');

  const [campanhas, setCampanhas] = useState<CampanhaVendaAdicional[]>([]);
  const [loadingLista, setLoadingLista] = useState(true);
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[]>([]);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [dataInicio, setDataInicio] = useState(todayISO());
  const [dataFim, setDataFim] = useState(somarDias(todayISO(), 7));
  const [horarioLembrete, setHorarioLembrete] = useState('');
  const [calendarioAberto, setCalendarioAberto] = useState(false);
  const [relogioAberto, setRelogioAberto] = useState(false);
  const [buscaProduto, setBuscaProduto] = useState('');
  const [produtosSelecionados, setProdutosSelecionados] = useState<{ codigoProduto: number; nomeProduto: string }[]>([]);
  const [tipoPremiacao, setTipoPremiacao] = useState<TipoPremiacaoVendaAdicional>('ranking');
  const [criterioQuantidade, setCriterioQuantidade] = useState<CriterioQuantidadeVendaAdicional>('acumulado_periodo');
  const [premiosRanking, setPremiosRanking] = useState([200, 100, 50].map(moedaParaTexto));
  const [minimoParaConcorrer, setMinimoParaConcorrer] = useState('');
  const [metaQuantidade, setMetaQuantidade] = useState('5');
  const [premiacaoMetaValor, setPremiacaoMetaValor] = useState(moedaParaTexto(50));
  const [salvando, setSalvando] = useState(false);

  const carregarLista = useCallback(async () => {
    if (!profile) return;
    setLoadingLista(true);
    setCampanhas(await repository.getCampanhasVendaAdicional(profile));
    setLoadingLista(false);
  }, [profile]);

  useEffect(() => {
    carregarLista();
  }, [carregarLista]);

  const abrirNova = async () => {
    setEditandoId(null);
    limparFormulario();
    setModo('nova');
    if (catalogo.length === 0 && profile) {
      setCatalogo(await repository.getCatalogoProdutos(profile));
    }
  };

  const abrirEdicao = async (campanha: CampanhaVendaAdicional) => {
    setEditandoId(campanha.id);
    setNome(campanha.nome);
    setDataInicio(campanha.dataInicio);
    setDataFim(campanha.dataFim);
    setHorarioLembrete(campanha.horarioLembrete ?? '');
    setProdutosSelecionados(campanha.produtos);
    setTipoPremiacao(campanha.tipoPremiacao);
    setCriterioQuantidade(campanha.criterioQuantidade);
    if (campanha.tipoPremiacao === 'ranking') {
      const porPosicao = new Map((campanha.premiacaoRanking ?? []).map((p) => [p.posicao, p.valor]));
      setPremiosRanking([1, 2, 3].map((posicao) => {
        const valor = porPosicao.get(posicao);
        return valor != null ? moedaParaTexto(valor) : '';
      }));
      setMinimoParaConcorrer(campanha.minimoParaConcorrer != null ? String(campanha.minimoParaConcorrer) : '');
    } else {
      setMetaQuantidade(String(campanha.metaQuantidade ?? ''));
      setPremiacaoMetaValor(moedaParaTexto(campanha.premiacaoMetaValor ?? 0));
    }
    setModo('nova');
    if (catalogo.length === 0 && profile) {
      setCatalogo(await repository.getCatalogoProdutos(profile));
    }
  };

  const resultadosBusca =
    buscaProduto.trim().length < 2
      ? []
      : catalogo
          .filter((p) => {
            const termo = buscaProduto.trim().toLowerCase();
            return p.nome.toLowerCase().includes(termo) || String(p.codigo).includes(termo);
          })
          .filter((p) => !produtosSelecionados.some((s) => s.codigoProduto === p.codigo))
          .slice(0, 8);

  const adicionarProduto = (produto: ProdutoCatalogo) => {
    setProdutosSelecionados((atual) => [...atual, { codigoProduto: produto.codigo, nomeProduto: produto.nome }]);
    setBuscaProduto('');
  };

  const removerProduto = (codigoProduto: number) => {
    setProdutosSelecionados((atual) => atual.filter((p) => p.codigoProduto !== codigoProduto));
  };

  const limparFormulario = () => {
    setNome('');
    setDataInicio(todayISO());
    setDataFim(somarDias(todayISO(), 7));
    setHorarioLembrete('');
    setProdutosSelecionados([]);
    setTipoPremiacao('ranking');
    setCriterioQuantidade('acumulado_periodo');
    setPremiosRanking(['200', '100', '50']);
    setMinimoParaConcorrer('');
    setMetaQuantidade('5');
    setPremiacaoMetaValor('50');
  };

  const salvar = async () => {
    if (!profile) return;
    if (!nome.trim()) {
      alertar('Nome obrigatório', 'Dê um nome pra campanha antes de salvar.');
      return;
    }
    if (dataFim < dataInicio) {
      alertar('Datas inválidas', 'A data de fim precisa ser igual ou depois da data de início.');
      return;
    }
    if (produtosSelecionados.length === 0) {
      alertar('Sem produtos', 'Busque e adicione pelo menos 1 produto antes de salvar.');
      return;
    }

    let premiacaoRanking: { posicao: number; valor: number }[] | null = null;
    let minimoParaConcorrerInput: number | null = null;
    let metaQuantidadeInput: number | null = null;
    let premiacaoMetaValorInput: number | null = null;

    if (tipoPremiacao === 'ranking') {
      premiacaoRanking = premiosRanking
        .map((valor, index) => ({ posicao: index + 1, valor: parseDecimalBR(valor) }))
        .filter((p) => p.valor > 0);
      if (premiacaoRanking.length === 0) {
        alertar('Premiação vazia', 'Preencha pelo menos o prêmio do 1º lugar.');
        return;
      }
      const minimoTexto = minimoParaConcorrer.trim();
      if (minimoTexto) {
        minimoParaConcorrerInput = Number(minimoTexto) || 0;
        if (minimoParaConcorrerInput <= 0) {
          alertar('Mínimo inválido', 'O mínimo pra concorrer precisa ser maior que 0 (ou deixe em branco pra não ter piso).');
          return;
        }
      }
    } else {
      metaQuantidadeInput = Number(metaQuantidade) || 0;
      premiacaoMetaValorInput = parseDecimalBR(premiacaoMetaValor);
      if (metaQuantidadeInput <= 0 || premiacaoMetaValorInput <= 0) {
        alertar('Meta inválida', 'Preencha a quantidade meta e o valor do prêmio.');
        return;
      }
    }

    setSalvando(true);
    try {
      await repository.salvarCampanhaVendaAdicional(profile, {
        id: editandoId ?? undefined,
        nome: nome.trim(),
        dataInicio,
        dataFim,
        tipoPremiacao,
        criterioQuantidade,
        metaQuantidade: metaQuantidadeInput,
        premiacaoMetaValor: premiacaoMetaValorInput,
        premiacaoRanking,
        minimoParaConcorrer: minimoParaConcorrerInput,
        horarioLembrete: horarioLembrete.trim() || null,
        codigosProduto: produtosSelecionados.map((p) => p.codigoProduto),
      });
      setModo('lista');
      setEditandoId(null);
      limparFormulario();
      await carregarLista();
    } catch (erro) {
      alertar('Erro ao salvar campanha', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = (campanha: CampanhaVendaAdicional) => {
    confirmar(
      'Excluir campanha',
      `Excluir "${campanha.nome}"? A premiação e o histórico de acompanhamento somem junto.`,
      async () => {
        try {
          await repository.excluirCampanhaVendaAdicional(campanha.id);
          await carregarLista();
        } catch (erro) {
          alertar('Erro ao excluir campanha', erro instanceof Error ? erro.message : 'Tente novamente.');
        }
      },
      { textoConfirmar: 'Excluir', destrutivo: true }
    );
  };

  if (modo === 'nova') {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.container} contentContainerStyle={styles.espacoInferiorExtra} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.voltar} onPress={() => setModo('lista')} hitSlop={8}>
          <Ionicons name="arrow-back" size={18} color={colors.navy} />
          <Text style={styles.voltarTexto}>Venda adicional</Text>
        </Pressable>

        <Text style={styles.title}>{editandoId ? 'Editar campanha' : 'Nova campanha'}</Text>

        <Card>
          <Text style={styles.cardTitulo}>Cabeçalho</Text>
          <TextInput style={styles.input} placeholder="Nome da campanha" value={nome} onChangeText={setNome} />

          <Text style={[styles.rotulo, styles.espacado]}>Período</Text>
          <Pressable style={styles.botaoPeriodo} onPress={() => setCalendarioAberto(true)}>
            <Ionicons name="calendar-outline" size={18} color={colors.navy} />
            <Text style={styles.botaoPeriodoTexto}>
              {dataInicio === dataFim ? formatDateBR(dataInicio) : `${formatDateBR(dataInicio)} até ${formatDateBR(dataFim)}`}
            </Text>
          </Pressable>

          <Text style={[styles.rotulo, styles.espacado]}>Horário do lembrete (opcional)</Text>
          <Pressable style={styles.botaoPeriodo} onPress={() => setRelogioAberto(true)}>
            <Ionicons name="time-outline" size={18} color={colors.navy} />
            <Text style={styles.botaoPeriodoTexto}>{horarioLembrete || 'Nenhum horário escolhido'}</Text>
          </Pressable>
          <Text style={styles.hint}>Reservado pra um lembrete futuro no celular do vendedor — ainda não envia nada.</Text>
        </Card>

        <Card>
          <Text style={styles.cardTitulo}>Produtos da campanha</Text>
          <TextInput
            style={styles.input}
            placeholder="Buscar produto pelo nome ou código"
            value={buscaProduto}
            onChangeText={setBuscaProduto}
          />
          {resultadosBusca.map((p) => (
            <Pressable key={p.codigo} style={styles.resultadoBusca} onPress={() => adicionarProduto(p)}>
              <Text style={styles.resultadoBuscaTexto} numberOfLines={1}>
                {p.nome} · cód. {p.codigo}
              </Text>
              <Ionicons name="add-circle" size={20} color={colors.navy} />
            </Pressable>
          ))}

          {produtosSelecionados.length > 0 && (
            <View style={styles.espacado}>
              {produtosSelecionados.map((p) => (
                <View key={p.codigoProduto} style={styles.produtoSelecionadoLinha}>
                  <Text style={styles.produtoSelecionadoTexto} numberOfLines={1}>{p.nomeProduto}</Text>
                  <Pressable onPress={() => removerProduto(p.codigoProduto)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={colors.red} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card>
          <Text style={styles.cardTitulo}>Premiação</Text>
          <View style={styles.segmentedWrap}>
            <Pressable
              style={[styles.segmentButton, tipoPremiacao === 'ranking' && styles.segmentButtonAtivo]}
              onPress={() => setTipoPremiacao('ranking')}
            >
              <Text style={[styles.segmentText, tipoPremiacao === 'ranking' && styles.segmentTextAtivo]}>Ranking</Text>
            </Pressable>
            <Pressable
              style={[styles.segmentButton, tipoPremiacao === 'meta_individual' && styles.segmentButtonAtivo]}
              onPress={() => setTipoPremiacao('meta_individual')}
            >
              <Text style={[styles.segmentText, tipoPremiacao === 'meta_individual' && styles.segmentTextAtivo]}>
                Meta individual
              </Text>
            </Pressable>
          </View>

          <Text style={[styles.rotulo, styles.espacado]}>Como contar a quantidade</Text>
          <View style={styles.segmentedWrap}>
            <Pressable
              style={[styles.segmentButton, criterioQuantidade === 'acumulado_periodo' && styles.segmentButtonAtivo]}
              onPress={() => setCriterioQuantidade('acumulado_periodo')}
            >
              <Text style={[styles.segmentText, criterioQuantidade === 'acumulado_periodo' && styles.segmentTextAtivo]}>
                Soma do período
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segmentButton, criterioQuantidade === 'mesma_venda' && styles.segmentButtonAtivo]}
              onPress={() => setCriterioQuantidade('mesma_venda')}
            >
              <Text style={[styles.segmentText, criterioQuantidade === 'mesma_venda' && styles.segmentTextAtivo]}>
                2+ na mesma venda
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segmentButton, criterioQuantidade === 'venda_com_outros_itens' && styles.segmentButtonAtivo]}
              onPress={() => setCriterioQuantidade('venda_com_outros_itens')}
            >
              <Text style={[styles.segmentText, criterioQuantidade === 'venda_com_outros_itens' && styles.segmentTextAtivo]}>
                Com outro item
              </Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>
            {criterioQuantidade === 'acumulado_periodo'
              ? 'Conta tudo que o vendedor vender ao longo do período, mesmo em vendas separadas. Ex.: campanha padrão de um ou mais produtos.'
              : criterioQuantidade === 'mesma_venda'
              ? 'Só conta se 2+ unidades do MESMO produto saírem juntas na mesma venda (mesmo cupom). Ex.: campanha "compre 2" de um produto único.'
              : 'Só conta a venda se ela tiver OUTRO item além do produto da campanha — quem levou só ele sozinho não conta. Ex.: "adicional bebê" (pomada, lenço, chupeta) — vale como venda adicional só se veio junto com outra coisa.'}
          </Text>

          {tipoPremiacao === 'ranking' ? (
            <>
              <Text style={styles.hint}>Os primeiros colocados por quantidade vendida ganham o prêmio da posição.</Text>
              {['1º lugar', '2º lugar', '3º lugar'].map((rotulo, index) => (
                <View key={rotulo} style={styles.semanaInputRow}>
                  <Text style={styles.semanaRotulo}>{rotulo}</Text>
                  <TextInput
                    style={[styles.input, styles.inputSemana]}
                    keyboardType="numeric"
                    value={premiosRanking[index]}
                    onChangeText={(texto) =>
                      setPremiosRanking((atual) => atual.map((v, i) => (i === index ? aplicarMascaraMoeda(texto) : v)))
                    }
                    placeholder="R$"
                  />
                </View>
              ))}
              <Text style={[styles.rotulo, styles.espacado]}>Mínimo pra concorrer (opcional)</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={minimoParaConcorrer}
                onChangeText={setMinimoParaConcorrer}
                placeholder="Ex.: 5 — deixe em branco pra não ter piso"
              />
              <Text style={styles.hint}>Quem vender menos que isso não entra no ranking, mesmo tendo vendido alguma coisa.</Text>
            </>
          ) : (
            <>
              <Text style={styles.hint}>Todo vendedor que bater a quantidade abaixo ganha o mesmo prêmio.</Text>
              <Text style={[styles.rotulo, styles.espacado]}>Quantidade pra bater</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={metaQuantidade} onChangeText={setMetaQuantidade} />
              <Text style={[styles.rotulo, styles.espacado]}>Valor do prêmio</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={premiacaoMetaValor}
                onChangeText={(texto) => setPremiacaoMetaValor(aplicarMascaraMoeda(texto))}
                placeholder="R$"
              />
            </>
          )}
        </Card>

        <Pressable style={styles.botaoSalvar} onPress={salvar} disabled={salvando}>
          {salvando ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.botaoTexto}>{editandoId ? 'Salvar alterações' : 'Salvar campanha'}</Text>
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

        <SeletorHorario
          visible={relogioAberto}
          onClose={() => setRelogioAberto(false)}
          valorInicial={horarioLembrete}
          onConfirmar={setHorarioLembrete}
        />
      </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>🎁 Venda adicional</Text>
      <Text style={styles.subtitle}>Incentivo pontual pra empurrar produto específico — em ranking ou meta individual.</Text>

      <Pressable style={styles.botaoNova} onPress={abrirNova}>
        <Ionicons name="add" size={18} color={colors.white} />
        <Text style={styles.botaoTexto}>Nova campanha</Text>
      </Pressable>

      {loadingLista ? (
        <ActivityIndicator style={{ marginTop: 16 }} />
      ) : campanhas.length === 0 ? (
        <Card>
          <Text style={styles.empty}>Nenhuma campanha criada ainda.</Text>
        </Card>
      ) : (
        campanhas.map((campanha) => (
          <Card key={campanha.id}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemNome}>{campanha.nome}</Text>
              <View style={styles.itemAcoes}>
                <Pressable onPress={() => abrirEdicao(campanha)} hitSlop={8}>
                  <Ionicons name="pencil-outline" size={18} color={colors.navy} />
                </Pressable>
                <Pressable onPress={() => excluir(campanha)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={colors.red} />
                </Pressable>
              </View>
            </View>
            <Text style={styles.campanhaPeriodo}>
              {formatDateBR(campanha.dataInicio)} a {formatDateBR(campanha.dataFim)}
            </Text>
            <Text style={styles.campanhaResumo}>
              {campanha.produtos.length} produto(s) ·{' '}
              {campanha.tipoPremiacao === 'ranking'
                ? `ranking: ${(campanha.premiacaoRanking ?? []).map((p) => `${p.posicao}º ${formatBRL(p.valor)}`).join(', ')}`
                : `meta individual: ${campanha.metaQuantidade} un. = ${formatBRL(campanha.premiacaoMetaValor ?? 0)}`}
              {campanha.criterioQuantidade === 'mesma_venda' ? ' · na mesma venda' : ''}
              {campanha.criterioQuantidade === 'venda_com_outros_itens' ? ' · com outro item' : ''}
            </Text>
            <AndamentoCampanha campanha={campanha} />
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 16, lineHeight: 18 },
  voltar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  voltarTexto: { color: colors.navy, fontWeight: '600', fontSize: 14 },
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
  botaoTexto: { color: colors.white, fontWeight: '700', fontSize: 14 },
  empty: { color: colors.textSecondary },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 },
  itemNome: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  itemAcoes: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  campanhaPeriodo: { fontSize: 12, color: colors.textSecondary, marginBottom: 2 },
  campanhaResumo: { fontSize: 12, color: colors.textMuted },
  cardTitulo: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  rotulo: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
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
  // "1º/2º/3º lugar" (Premiação) pode ficar perto do fim da tela sem
  // espaço de rolagem sobrando — sem isso o teclado cobria o campo.
  espacoInferiorExtra: { paddingBottom: 100 },
  resultadoBusca: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  resultadoBuscaTexto: { flex: 1, fontSize: 13, color: colors.textPrimary, marginRight: 8 },
  produtoSelecionadoLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  produtoSelecionadoTexto: { flex: 1, fontSize: 13, color: colors.textPrimary, marginRight: 8, fontWeight: '600' },
  segmentedWrap: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  segmentButton: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentButtonAtivo: { backgroundColor: colors.navy },
  segmentText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  segmentTextAtivo: { color: colors.white },
  semanaInputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  semanaRotulo: { fontSize: 12, color: colors.textSecondary, width: 64 },
  inputSemana: { flex: 1 },
  botaoSalvar: { backgroundColor: colors.success, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 4, marginBottom: 24 },
  andamentoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  andamentoToggleTexto: { fontSize: 12, fontWeight: '600', color: colors.navy },
  andamentoPainel: { marginTop: 6 },
  andamentoLinha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, gap: 8 },
  andamentoNome: { flex: 1, fontSize: 12, color: colors.textPrimary },
  andamentoValor: { fontSize: 12, color: colors.textSecondary },
});
