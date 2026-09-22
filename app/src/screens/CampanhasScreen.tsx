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
import { colors } from '../theme/colors';
import { formatBRL, formatDateBR, parseDecimalBR, todayISO } from '../lib/format';
import { alertar, confirmar } from '../lib/alert';
import { MACRO_GRUPO_LABEL, MacroGrupo, ORDEM_MACRO_GRUPOS } from '../lib/macroGrupo';
import { MODELO_CAMPANHA_LABEL, nomeSugeridoPorModelo, ORDEM_MODELOS_CAMPANHA } from '../lib/modeloCampanha';
import { aplicarMascaraMoeda, moedaParaTexto } from '../lib/moeda';
import {
  Campanha,
  CampanhaProduto,
  ModeloCampanha,
  ModoSugestaoCampanha,
  ProdutoCatalogo,
  ProdutoElegibilidade,
} from '../types/domain';

type Modo = 'lista' | 'nova';
const TODOS_OS_GRUPOS = '__todos__';
const PERSONALIZADO = '__personalizado__';

function round2(valor: number): number {
  return Math.round(valor * 100) / 100;
}
type SelecaoModelo = ModeloCampanha | typeof PERSONALIZADO;

const OPCOES_MODO_SUGESTAO: { chave: ModoSugestaoCampanha; label: string; descricao: string }[] = [
  {
    chave: 'popularidade',
    label: '🔥 Populares',
    descricao: 'Prioriza quem já vende bem e sustenta desconto sem perder margem.',
  },
  {
    chave: 'liquidacao',
    label: '📦 Estoque parado',
    descricao: 'Busca produto sem venda recente mas ainda em estoque, priorizando quem tem mais capital parado.',
  },
];

function somarDias(iso: string, dias: number): string {
  const data = new Date(`${iso}T00:00:00`);
  data.setDate(data.getDate() + dias);
  return data.toISOString().slice(0, 10);
}

export function CampanhasScreen() {
  const { profile } = useAuth();
  const [modo, setModo] = useState<Modo>('lista');

  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [loadingLista, setLoadingLista] = useState(true);

  const [nome, setNome] = useState('');
  const [dataInicio, setDataInicio] = useState(todayISO());
  const [dataFim, setDataFim] = useState(somarDias(todayISO(), 7));
  const [calendarioAberto, setCalendarioAberto] = useState(false);
  const [margemMinima, setMargemMinima] = useState('20');
  const [descontoAlvo, setDescontoAlvo] = useState('15');
  const [quantidadeMaxima, setQuantidadeMaxima] = useState('10');
  const [gerando, setGerando] = useState(false);
  // Diferencia "ainda não gerou nada" (não mostra seção) de "gerou e
  // não achou nenhum produto elegível" (mostra seção com aviso) — sem
  // isso, um critério restritivo demais (margem mínima alta, modelo
  // temático sem produto no grupo) fazia o botão "Gerar sugestão"
  // parecer não fazer nada: setItens([]) some a seção inteira sem
  // nenhum feedback (achado 23/08/2026).
  const [gerada, setGerada] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [itens, setItens] = useState<CampanhaProduto[]>([]);
  // Texto BRUTO do campo "Preço promocional", por produto — desacoplado
  // de item.precoPromocional (number). Sem isso, o TextInput reformatava
  // o valor a cada tecla via String(number): digitar "12," virava
  // Number("12.") = 12, o value voltava "12" e a vírgula suid ia embora
  // na hora, tornando impossível digitar decimal (achado 26/08/2026).
  const [textosPreco, setTextosPreco] = useState<Record<number, string>>({});
  const [editandoId, setEditandoId] = useState<string | null>(null);
  // Essa tela não edita kit multi-produto (isso é feito em Cartazetes/
  // Sugestão de kits) — mas precisa preservar os kits que a campanha
  // JÁ tinha ao salvar uma edição de produtos, senão salvarCampanha
  // (que substitui kits por completo) apagaria eles silenciosamente.
  const [kitsExistentes, setKitsExistentes] = useState<Campanha['kits']>([]);
  const [modoSugestao, setModoSugestao] = useState<ModoSugestaoCampanha>('popularidade');
  const [macroGrupoFiltro, setMacroGrupoFiltro] = useState<MacroGrupo | typeof TODOS_OS_GRUPOS>(TODOS_OS_GRUPOS);
  const [modeloSelecionado, setModeloSelecionado] = useState<SelecaoModelo>(PERSONALIZADO);
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[]>([]);
  const [buscaProduto, setBuscaProduto] = useState('');

  const escolherModelo = (selecao: SelecaoModelo) => {
    setModeloSelecionado(selecao);
    if (selecao !== PERSONALIZADO) setNome(nomeSugeridoPorModelo(selecao));
  };

  const carregarLista = useCallback(async () => {
    if (!profile) return;
    setLoadingLista(true);
    setCampanhas(await repository.getCampanhas(profile));
    setLoadingLista(false);
  }, [profile]);

  useEffect(() => {
    carregarLista();
  }, [carregarLista]);

  const gerarSugestao = async () => {
    if (!profile) return;
    const usaModeloFixo = modeloSelecionado !== PERSONALIZADO;
    const params = {
      margemMinimaPct: Number(margemMinima.replace(',', '.')) || 0,
      descontoAlvoPct: Number(descontoAlvo.replace(',', '.')) || 0,
      quantidadeMaxima: Number(quantidadeMaxima) || 10,
      modo: usaModeloFixo ? undefined : modoSugestao,
      macroGrupo: usaModeloFixo ? undefined : macroGrupoFiltro === TODOS_OS_GRUPOS ? undefined : macroGrupoFiltro,
      modelo: usaModeloFixo ? modeloSelecionado : undefined,
    };
    setGerando(true);
    try {
      const sugestoes = await repository.sugerirProdutosCampanha(profile, params);
      setItens(sugestoes.map((s) => mapearSugestaoParaItem(s, dataInicio, dataFim)));
      setTextosPreco({});
      setGerada(true);
    } catch (erro) {
      alertar('Erro ao gerar sugestão', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setGerando(false);
    }
  };

  const removerItem = (codigoProduto: number) => {
    setItens((atual) => atual.filter((i) => i.codigoProduto !== codigoProduto));
  };

  // Complementa a sugestão automática (e a edição de campanha já
  // salva): busca no catálogo por nome OU código e adiciona na hora,
  // usando o desconto alvo já configurado pra sugerir o preço
  // promocional — editável depois, igual aos itens vindos da sugestão.
  const resultadosBuscaProduto =
    buscaProduto.trim().length < 2
      ? []
      : catalogo
          .filter((p) => {
            const termo = buscaProduto.trim().toLowerCase();
            return p.nome.toLowerCase().includes(termo) || String(p.codigo).includes(termo);
          })
          .filter((p) => !itens.some((i) => i.codigoProduto === p.codigo))
          .slice(0, 8);

  const adicionarProdutoManual = (produto: ProdutoCatalogo) => {
    const descontoPct = Number(descontoAlvo.replace(',', '.')) || 0;
    const precoPromocional = Math.max(0, produto.precoVenda * (1 - descontoPct / 100));
    setItens((atual) => [
      ...atual,
      {
        codigoProduto: produto.codigo,
        codigoBarras: produto.codigoBarras,
        nomeProduto: produto.nome,
        precoRegular: produto.precoVenda,
        custoMedio: produto.custoMedio,
        precoPromocional: Number(precoPromocional.toFixed(2)),
        percentualDesconto: descontoPct,
        quantidadeCartazes: 1,
        dataInicio,
        dataFim,
        tipoPromocao: 'unitario',
        kit: null,
      },
    ]);
    setBuscaProduto('');
  };

  const ajustarPreco = (codigoProduto: number, texto: string) => {
    // Máscara de centavos (lib/moeda.ts): dígito digitado sempre vira
    // centavo, sem precisar digitar vírgula — string sempre bem-formada,
    // então o valor numérico já pode ser atualizado junto, sem o
    // desalinhamento de digitação que exigia o estado de texto bruto
    // separado antes disso (achado 26/08/2026).
    const textoMascarado = aplicarMascaraMoeda(texto);
    setTextosPreco((atual) => ({ ...atual, [codigoProduto]: textoMascarado }));
    // Number(texto.replace(',', '.')) quebra a partir de R$1.000 (o
    // ponto de milhar vira um segundo ponto decimal, Number() dá NaN) —
    // mesmo achado do lote de Metas (26/08/2026), ver lib/moeda.ts.
    const precoPromocional = parseDecimalBR(textoMascarado);
    setItens((atual) =>
      atual.map((i) => {
        if (i.codigoProduto !== codigoProduto) return i;
        // % desconto precisa refletir o preço de verdade digitado, não
        // ficar preso no valor sugerido/alvo original — achado
        // 01-02/09/2026 (independente, duas vezes): depois de editar o
        // preço na mão, o card continuava mostrando o desconto alvo
        // (ex.: 15%) igual pra todo produto, e o cartaz saía com "% OFF"
        // e "DE" errados (mesma fórmula usada em CartazetesScreen pra
        // manter De/Por/Desconto em sincronia).
        const percentualDesconto =
          i.precoRegular > 0 ? round2(((i.precoRegular - precoPromocional) / i.precoRegular) * 100) : 0;
        return { ...i, precoPromocional, percentualDesconto };
      })
    );
  };

  const resetFormulario = () => {
    setEditandoId(null);
    setNome('');
    setDataInicio(todayISO());
    setDataFim(somarDias(todayISO(), 7));
    setItens([]);
    setKitsExistentes([]);
    setTextosPreco({});
    setModoSugestao('popularidade');
    setMacroGrupoFiltro(TODOS_OS_GRUPOS);
    setModeloSelecionado(PERSONALIZADO);
    setBuscaProduto('');
    setGerada(false);
  };

  const abrirNova = async () => {
    resetFormulario();
    setModo('nova');
    if (catalogo.length === 0 && profile) {
      setCatalogo(await repository.getCatalogoProdutos(profile));
    }
  };

  const abrirEdicao = async (campanha: Campanha) => {
    setEditandoId(campanha.id);
    setNome(campanha.nome);
    setDataInicio(campanha.dataInicio);
    setDataFim(campanha.dataFim);
    // Otimista com o que já tinha da lista — a lista agora é "leve"
    // (não resolve nome/código de barras, só usados na edição), então
    // busca a campanha completa em seguida e substitui.
    setItens(campanha.produtos);
    setKitsExistentes(campanha.kits);
    setTextosPreco({});
    setModo('nova');
    if (catalogo.length === 0 && profile) {
      setCatalogo(await repository.getCatalogoProdutos(profile));
    }
    if (!profile) return;
    try {
      const completa = await repository.getCampanha(profile, campanha.id);
      if (completa) {
        setItens(completa.produtos);
        setKitsExistentes(completa.kits);
      }
    } catch {
      // mantém o que já tinha (nomes podem vir vazios da lista leve)
    }
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
    // Campanha só-de-kit (criada via Sugestão de kits, produtos: [])
    // é válida — só bloqueia se não sobrou NEM produto NEM kit nenhum.
    if (itens.length === 0 && kitsExistentes.length === 0) {
      alertar('Sem produtos', 'Gere a sugestão e mantenha pelo menos 1 produto antes de salvar.');
      return;
    }

    setSalvando(true);
    try {
      await repository.salvarCampanha(profile, {
        id: editandoId ?? undefined,
        nome: nome.trim(),
        dataInicio,
        dataFim,
        produtos: itens,
        kits: kitsExistentes,
      });
      setModo('lista');
      resetFormulario();
      await carregarLista();
    } catch (erro) {
      alertar('Erro ao salvar campanha', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = (campanha: Campanha) => {
    confirmar(
      'Excluir campanha',
      `Excluir "${campanha.nome}"?`,
      async () => {
        try {
          await repository.excluirCampanha(campanha.id);
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
          <Text style={styles.voltarTexto}>Campanhas</Text>
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
        </Card>

        {!editandoId && (
          <Card>
            <Text style={styles.cardTitulo}>Critérios de sugestão</Text>

            <Text style={styles.rotulo}>Modelo de campanha</Text>
            <Text style={styles.explicacaoModo}>
              Escolha uma campanha fixa (já define sozinha quais produtos entram) ou "Personalizado" pra montar os
              critérios na mão.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.espacado}>
              <View style={styles.filtroRow}>
                {ORDEM_MODELOS_CAMPANHA.map((modelo) => (
                  <Pressable
                    key={modelo}
                    style={[styles.filtroChip, modeloSelecionado === modelo && styles.filtroChipAtivo]}
                    onPress={() => escolherModelo(modelo)}
                  >
                    <Text style={[styles.filtroChipTexto, modeloSelecionado === modelo && styles.filtroChipTextoAtivo]}>
                      {MODELO_CAMPANHA_LABEL[modelo]}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  style={[styles.filtroChip, modeloSelecionado === PERSONALIZADO && styles.filtroChipAtivo]}
                  onPress={() => escolherModelo(PERSONALIZADO)}
                >
                  <Text style={[styles.filtroChipTexto, modeloSelecionado === PERSONALIZADO && styles.filtroChipTextoAtivo]}>
                    Personalizado
                  </Text>
                </Pressable>
              </View>
            </ScrollView>

            {modeloSelecionado === PERSONALIZADO && (
              <>
                <Text style={[styles.rotulo, styles.espacado]}>Tipo de sugestão</Text>
                <View style={styles.filtroRow}>
                  {OPCOES_MODO_SUGESTAO.map((opcao) => (
                    <Pressable
                      key={opcao.chave}
                      style={[styles.filtroChip, modoSugestao === opcao.chave && styles.filtroChipAtivo]}
                      onPress={() => setModoSugestao(opcao.chave)}
                    >
                      <Text style={[styles.filtroChipTexto, modoSugestao === opcao.chave && styles.filtroChipTextoAtivo]}>
                        {opcao.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.explicacaoModo}>
                  {OPCOES_MODO_SUGESTAO.find((o) => o.chave === modoSugestao)?.descricao}
                </Text>

                <Text style={[styles.rotulo, styles.espacado]}>Grupo (opcional — campanha temática)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.filtroRow}>
                    <Pressable
                      style={[styles.filtroChip, macroGrupoFiltro === TODOS_OS_GRUPOS && styles.filtroChipAtivo]}
                      onPress={() => setMacroGrupoFiltro(TODOS_OS_GRUPOS)}
                    >
                      <Text
                        style={[styles.filtroChipTexto, macroGrupoFiltro === TODOS_OS_GRUPOS && styles.filtroChipTextoAtivo]}
                      >
                        Todos os grupos
                      </Text>
                    </Pressable>
                    {ORDEM_MACRO_GRUPOS.map((macro) => (
                      <Pressable
                        key={macro}
                        style={[styles.filtroChip, macroGrupoFiltro === macro && styles.filtroChipAtivo]}
                        onPress={() => setMacroGrupoFiltro(macro)}
                      >
                        <Text style={[styles.filtroChipTexto, macroGrupoFiltro === macro && styles.filtroChipTextoAtivo]}>
                          {MACRO_GRUPO_LABEL[macro]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}

            <Text style={[styles.rotulo, styles.espacado]}>Margem mínima (%)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={margemMinima} onChangeText={setMargemMinima} />
            <Text style={[styles.rotulo, styles.espacado]}>Desconto alvo (%)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={descontoAlvo} onChangeText={setDescontoAlvo} />
            <Text style={[styles.rotulo, styles.espacado]}>Quantidade máxima de produtos</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={quantidadeMaxima} onChangeText={setQuantidadeMaxima} />

            <Pressable style={styles.botaoGerar} onPress={gerarSugestao} disabled={gerando}>
              {gerando ? <ActivityIndicator color={colors.white} /> : <Text style={styles.botaoGerarTexto}>Gerar sugestão</Text>}
            </Pressable>
          </Card>
        )}

        <Card>
          <Text style={styles.cardTitulo}>Adicionar produto manualmente</Text>
          <TextInput
            style={styles.input}
            placeholder="Buscar produto pelo nome ou código"
            value={buscaProduto}
            onChangeText={setBuscaProduto}
          />
          {resultadosBuscaProduto.map((p) => (
            <Pressable key={p.codigo} style={styles.resultadoBusca} onPress={() => adicionarProdutoManual(p)}>
              <Text style={styles.resultadoBuscaTexto} numberOfLines={1}>
                {p.nome} · cód. {p.codigo}
              </Text>
              <Ionicons name="add-circle" size={20} color={colors.navy} />
            </Pressable>
          ))}
        </Card>

        {(itens.length > 0 || editandoId || gerada) && (
          <>
            <Text style={styles.sectionTitulo}>
              {editandoId ? `Produtos da campanha (${itens.length})` : `Produtos sugeridos (${itens.length})`}
            </Text>
            {itens.length === 0 && (
              <Card>
                <Text style={styles.empty}>
                  Nenhum produto elegível com esses critérios — tente reduzir a margem mínima, aumentar o desconto
                  alvo ou trocar o grupo/modelo.
                </Text>
              </Card>
            )}
            {itens.map((item) => (
              <Card key={item.codigoProduto}>
                <View style={styles.itemHeader}>
                  <Text style={styles.itemNome} numberOfLines={2}>{item.nomeProduto}</Text>
                  <Pressable onPress={() => removerItem(item.codigoProduto)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={colors.red} />
                  </Pressable>
                </View>
                <View style={styles.itemLinha}>
                  <Text style={styles.itemLabel}>Preço regular</Text>
                  <Text style={styles.itemValor}>{formatBRL(item.precoRegular)}</Text>
                </View>
                <View style={styles.itemLinha}>
                  <Text style={styles.itemLabel}>% desconto</Text>
                  <Text style={styles.itemValor}>{item.percentualDesconto.toFixed(1)}%</Text>
                </View>
                <View style={styles.itemLinha}>
                  <Text style={styles.itemLabel}>Preço promocional</Text>
                  <TextInput
                    style={styles.inputPreco}
                    keyboardType="numeric"
                    value={textosPreco[item.codigoProduto] ?? moedaParaTexto(item.precoPromocional)}
                    onChangeText={(texto) => ajustarPreco(item.codigoProduto, texto)}
                  />
                </View>
              </Card>
            ))}

            <Pressable style={styles.botaoSalvar} onPress={salvar} disabled={salvando}>
              {salvando ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.botaoGerarTexto}>{editandoId ? 'Salvar alterações' : 'Salvar campanha'}</Text>
              )}
            </Pressable>
          </>
        )}

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
      </KeyboardAvoidingView>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>📢 Promoções avulsas</Text>
      <Text style={styles.subtitle}>
        Promoções avulsas fora do encarte — sugeridas por margem, estoque e venda recente.
      </Text>

      <Pressable style={styles.botaoNova} onPress={abrirNova}>
        <Ionicons name="add" size={18} color={colors.white} />
        <Text style={styles.botaoGerarTexto}>Nova campanha</Text>
      </Pressable>

      {loadingLista ? (
        <ActivityIndicator style={{ marginTop: 16 }} />
      ) : campanhas.length === 0 ? (
        <Card>
          <Text style={styles.empty}>Nenhuma campanha criada ainda.</Text>
        </Card>
      ) : (
        campanhas.map((campanha) => {
          const totalCartazes = campanha.produtos.reduce((acc, p) => acc + p.quantidadeCartazes, 0);
          return (
            <Card key={campanha.id}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemNome}>{campanha.nome}</Text>
                <View style={styles.acoes}>
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
                {campanha.produtos.length} produto(s) · {totalCartazes} cartaz(es)
              </Text>
              <Text style={styles.campanhaDesempenho}>
                {campanha.quantidadeVendida ?? 0} vendido{(campanha.quantidadeVendida ?? 0) === 1 ? '' : 's'} ·{' '}
                {formatBRL(campanha.valorVendido ?? 0)}
              </Text>
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

function mapearSugestaoParaItem(sugestao: ProdutoElegibilidade, dataInicio: string, dataFim: string): CampanhaProduto {
  return {
    codigoProduto: sugestao.produto.codigo,
    codigoBarras: sugestao.produto.codigoBarras,
    nomeProduto: sugestao.produto.nome,
    precoRegular: sugestao.produto.precoVenda,
    custoMedio: sugestao.produto.custoMedio,
    precoPromocional: sugestao.precoSugerido,
    percentualDesconto: sugestao.percentualDescontoSugerido,
    quantidadeCartazes: 1,
    dataInicio,
    dataFim,
    tipoPromocao: 'unitario',
    kit: null,
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  // "Adicionar produto manualmente" pode ficar o último card da tela (sem
  // itens gerados ainda) — sem espaço extra pra rolar, o teclado cobre o
  // campo e nada empurra o conteúdo pra cima dele.
  espacoInferiorExtra: { paddingBottom: 100 },
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
  botaoGerarTexto: { color: colors.white, fontWeight: '700', fontSize: 14 },
  empty: { color: colors.textSecondary },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 },
  acoes: { flexDirection: 'row', gap: 14 },
  itemNome: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  campanhaPeriodo: { fontSize: 12, color: colors.textSecondary, marginBottom: 2 },
  campanhaResumo: { fontSize: 12, color: colors.textMuted },
  campanhaDesempenho: { fontSize: 12, fontWeight: '700', color: colors.navy, marginTop: 2 },
  cardTitulo: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  rotulo: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  espacado: { marginTop: 10 },
  filtroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
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
  explicacaoModo: { fontSize: 11, color: colors.textMuted, marginTop: 6, lineHeight: 15 },
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
  botaoGerar: { backgroundColor: colors.navy, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  sectionTitulo: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 4, marginBottom: 8 },
  itemLinha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  itemLabel: { fontSize: 13, color: colors.textSecondary },
  itemValor: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  inputPreco: {
    backgroundColor: colors.background,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 13,
    color: colors.textPrimary,
    width: 90,
    textAlign: 'right',
  },
  botaoSalvar: { backgroundColor: colors.success, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 4, marginBottom: 24 },
});
