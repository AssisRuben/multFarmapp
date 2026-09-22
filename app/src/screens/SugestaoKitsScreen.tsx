import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { repository } from '../data';
import { Card } from '../components/Card';
import { CalendarioPeriodo } from '../components/CalendarioPeriodo';
import { ComparativoCustoVenda } from '../components/ComparativoCustoVenda';
import { colors } from '../theme/colors';
import { formatBRL, formatDateBR, formatDecimalBR, parseDecimalBR, todayISO } from '../lib/format';
import { alertar, confirmar } from '../lib/alert';
import { MACRO_GRUPO_LABEL, MacroGrupo, ORDEM_MACRO_GRUPOS } from '../lib/macroGrupo';
import { resolverCodigosSeed } from '../lib/afinidadeKits';
import {
  calcularKitPercentualSustentavel,
  calcularKitPrecoFixoSustentavel,
  descricaoKit,
  descricaoKitMultiProduto,
  margemResultanteKitMultiProduto,
  margemResultanteKitProdutoUnico,
} from '../lib/kits';
import {
  CampanhaProduto,
  KitMultiProduto,
  KitPromocao,
  ProdutoCatalogo,
  ProdutoElegibilidade,
  SugestaoParAfinidade,
  TipoPrecificacaoKit,
} from '../types/domain';

type ModoKit = 'diferentes' | 'mesmo_item';

// Sugestão de kit de produto ÚNICO (leve N, pague menos) — mesmo
// espírito de ItemSugerido (par de afinidade), mas pra 1 produto só.
// Gerado a partir de sugerirProdutosCampanha (mesmo motor que Campanhas
// já usa, modo 'popularidade'), reaproveitando margem mínima/desconto
// alvo já configurados — pedido explícito 02/09/2026: "rode da mesma
// forma buscando por margem e por desconto alvo".
interface ItemSugeridoMesmo {
  chave: string;
  codigoProduto: number;
  codigoBarras: string;
  nomeProduto: string;
  precoRegular: number;
  custoMedio: number;
  quantidadeVendida30d: number;
  selecionado: boolean;
  quantidadeMinima: number;
  tipoPrecificacao: TipoPrecificacaoKit;
  percentualDescontoItem: number;
  precoFixo: number;
}

function produtoParaCalculoMesmo(item: ItemSugeridoMesmo) {
  return [{ precoVenda: item.precoRegular, custoMedio: item.custoMedio, quantidade: item.quantidadeMinima }];
}

function itemMesmoParaKit(item: ItemSugeridoMesmo): KitPromocao {
  return {
    quantidadeMinima: item.quantidadeMinima,
    tipoPrecificacao: item.tipoPrecificacao,
    percentualDescontoItem: item.tipoPrecificacao === 'percentual' ? item.percentualDescontoItem : null,
    precoFixo: item.tipoPrecificacao === 'preco_fixo' ? item.precoFixo : null,
  };
}

function round2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function somarDias(iso: string, dias: number): string {
  const data = new Date(`${iso}T00:00:00`);
  data.setDate(data.getDate() + dias);
  return data.toISOString().slice(0, 10);
}

// Sugestão de par + edição antes de virar KitMultiProduto de verdade —
// mesmo espírito de CampanhaProduto em CampanhasScreen (a sugestão
// "crua" já vem com um preço calculado, mas o gestor pode mexer antes
// de salvar).
interface ItemSugerido extends SugestaoParAfinidade {
  chave: string;
  selecionado: boolean;
  tipoPrecificacao: TipoPrecificacaoKit;
  percentualDescontoItem: number;
  precoFixo: number;
}

function totalRegularDoPar(item: SugestaoParAfinidade): number {
  return item.precoRegularSeed + item.precoRegularParceiro;
}

function produtosParaCalculo(item: SugestaoParAfinidade) {
  return [
    { precoVenda: item.precoRegularSeed, custoMedio: item.custoMedioSeed, quantidade: 1 },
    { precoVenda: item.precoRegularParceiro, custoMedio: item.custoMedioParceiro, quantidade: 1 },
  ];
}

// Único lugar que monta um KitMultiProduto a partir de um par
// sugerido/editado — usado tanto na prévia (texto ao vivo) quanto no
// salvar(), pra não ter duas montagens que podem divergir silenciosamente.
function itemParaKit(item: ItemSugerido, dataInicio: string, dataFim: string): KitMultiProduto {
  return {
    id: '',
    nome: null,
    tipoPrecificacao: item.tipoPrecificacao,
    percentualDescontoItem: item.tipoPrecificacao === 'percentual' ? item.percentualDescontoItem : null,
    precoFixo: item.tipoPrecificacao === 'preco_fixo' ? item.precoFixo : null,
    quantidadeCartazes: 1,
    dataInicio,
    dataFim,
    produtos: [
      {
        codigoProduto: item.codigoProdutoSeed,
        nomeProduto: item.nomeProdutoSeed,
        quantidade: 1,
        precoRegular: item.precoRegularSeed,
        custoMedio: item.custoMedioSeed,
      },
      {
        codigoProduto: item.codigoProdutoParceiro,
        nomeProduto: item.nomeProdutoParceiro,
        quantidade: 1,
        precoRegular: item.precoRegularParceiro,
        custoMedio: item.custoMedioParceiro,
      },
    ],
  };
}

interface CardParSugeridoProps {
  item: ItemSugerido;
  dataInicio: string;
  dataFim: string;
  onToggle: (chave: string) => void;
  onAlternarTipo: (chave: string, tipo: TipoPrecificacaoKit) => void;
  valorExibido: (item: ItemSugerido) => string;
  onDigitarValor: (chave: string, texto: string) => void;
  onConfirmarValor: (chave: string) => void;
}

// Um card por par sugerido — usado tanto na seção "Selecionados"
// quanto em "Pares sugeridos" (mesmo componente, só muda em qual lista
// está). Nome do produto vem acompanhado do código (02/09/2026,
// pedido explícito): o catálogo real tem VÁRIOS códigos com o mesmo
// nome de produto (lotes/fornecedores diferentes na Trier) — sem o
// código, não dá pra saber qual custo específico está sendo usado.
function CardParSugerido({
  item,
  dataInicio,
  dataFim,
  onToggle,
  onAlternarTipo,
  valorExibido,
  onDigitarValor,
  onConfirmarValor,
}: CardParSugeridoProps) {
  const { totalCusto, precoFinal, margemPct } = margemResultanteKitMultiProduto(itemParaKit(item, dataInicio, dataFim));
  return (
    <Card>
      <Pressable style={styles.itemHeaderRow} onPress={() => onToggle(item.chave)}>
        <Ionicons
          name={item.selecionado ? 'checkbox' : 'square-outline'}
          size={22}
          color={item.selecionado ? colors.navy : colors.textMuted}
        />
        <View style={styles.itemHeaderTexto}>
          <Text style={styles.itemNome} numberOfLines={2}>
            {item.nomeProdutoSeed} ({item.codigoProdutoSeed}) + {item.nomeProdutoParceiro} ({item.codigoProdutoParceiro})
          </Text>
          <Text style={styles.itemSubinfo}>
            {item.coOcorrencias} venda(s) juntos · lift {item.lift.toFixed(2)} · {formatBRL(totalRegularDoPar(item))} juntos
          </Text>
          <Text style={[styles.margemTexto, margemPct < 0 && styles.margemTextoNegativa]}>
            Preço de compra {formatBRL(totalCusto)} · margem {margemPct.toLocaleString('pt-BR')}%
          </Text>
        </View>
      </Pressable>

      {item.selecionado && (
        <View style={styles.painelExpandido}>
          <Text style={styles.campoLabel}>Tipo de preço</Text>
          <View style={styles.grupoGrid}>
            <Pressable
              style={[styles.chip, item.tipoPrecificacao === 'percentual' && styles.chipAtivo]}
              onPress={() => onAlternarTipo(item.chave, 'percentual')}
            >
              <Text style={[styles.chipTexto, item.tipoPrecificacao === 'percentual' && styles.chipTextoAtivo]}>
                % de desconto no combo
              </Text>
            </Pressable>
            <Pressable
              style={[styles.chip, item.tipoPrecificacao === 'preco_fixo' && styles.chipAtivo]}
              onPress={() => onAlternarTipo(item.chave, 'preco_fixo')}
            >
              <Text style={[styles.chipTexto, item.tipoPrecificacao === 'preco_fixo' && styles.chipTextoAtivo]}>
                Preço fixo do combo
              </Text>
            </Pressable>
          </View>

          <Text style={styles.campoLabel}>{item.tipoPrecificacao === 'percentual' ? 'Desconto (%)' : 'Preço fixo (R$)'}</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={valorExibido(item)}
            onChangeText={(texto) => onDigitarValor(item.chave, texto)}
            onBlur={() => onConfirmarValor(item.chave)}
          />

          <Text style={styles.previaTexto}>{descricaoKitMultiProduto(itemParaKit(item, dataInicio, dataFim))}</Text>
          <Text style={styles.margemTexto}>
            {item.nomeProdutoSeed} ({item.codigoProdutoSeed}) {formatBRL(item.custoMedioSeed)} + {item.nomeProdutoParceiro} (
            {item.codigoProdutoParceiro}) {formatBRL(item.custoMedioParceiro)}
          </Text>
          <ComparativoCustoVenda custo={totalCusto} venda={precoFinal} legenda="por kit" />
        </View>
      )}
    </Card>
  );
}

interface CardProdutoSugeridoMesmoProps {
  item: ItemSugeridoMesmo;
  onToggle: (chave: string) => void;
  onAlternarTipo: (chave: string, tipo: TipoPrecificacaoKit) => void;
  valorExibido: (item: ItemSugeridoMesmo, campo: 'quantidade' | 'valor') => string;
  onDigitarQuantidade: (chave: string, texto: string) => void;
  onConfirmarQuantidade: (chave: string) => void;
  onDigitarValor: (chave: string, texto: string) => void;
  onConfirmarValor: (chave: string) => void;
}

// Análogo a CardParSugerido, só que pra kit de produto ÚNICO — mesma
// mecânica de seleção/edição, um produto só em vez de um par.
function CardProdutoSugeridoMesmo({
  item,
  onToggle,
  onAlternarTipo,
  valorExibido,
  onDigitarQuantidade,
  onConfirmarQuantidade,
  onDigitarValor,
  onConfirmarValor,
}: CardProdutoSugeridoMesmoProps) {
  const { totalCusto, totalPago } = margemResultanteKitProdutoUnico(itemMesmoParaKit(item), item.precoRegular, item.custoMedio);
  const margemPct = totalPago > 0 ? round2(((totalPago - totalCusto) / totalPago) * 100) : 0;
  return (
    <Card>
      <Pressable style={styles.itemHeaderRow} onPress={() => onToggle(item.chave)}>
        <Ionicons
          name={item.selecionado ? 'checkbox' : 'square-outline'}
          size={22}
          color={item.selecionado ? colors.navy : colors.textMuted}
        />
        <View style={styles.itemHeaderTexto}>
          <Text style={styles.itemNome} numberOfLines={2}>
            {item.nomeProduto} ({item.codigoProduto})
          </Text>
          <Text style={styles.itemSubinfo}>
            {item.quantidadeVendida30d} vendido(s) em 30d · {formatBRL(item.precoRegular)} cada
          </Text>
          <Text style={[styles.margemTexto, margemPct < 0 && styles.margemTextoNegativa]}>
            Preço de compra {formatBRL(totalCusto)} · margem {margemPct.toLocaleString('pt-BR')}%
          </Text>
        </View>
      </Pressable>

      {item.selecionado && (
        <View style={styles.painelExpandido}>
          <Text style={styles.campoLabel}>Quantos itens no kit</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={valorExibido(item, 'quantidade')}
            onChangeText={(texto) => onDigitarQuantidade(item.chave, texto)}
            onBlur={() => onConfirmarQuantidade(item.chave)}
          />

          <Text style={[styles.campoLabel, styles.grupoLabelEspacado]}>Tipo de preço</Text>
          <View style={styles.grupoGrid}>
            <Pressable
              style={[styles.chip, item.tipoPrecificacao === 'percentual' && styles.chipAtivo]}
              onPress={() => onAlternarTipo(item.chave, 'percentual')}
            >
              <Text style={[styles.chipTexto, item.tipoPrecificacao === 'percentual' && styles.chipTextoAtivo]}>
                % no {item.quantidadeMinima}º item
              </Text>
            </Pressable>
            <Pressable
              style={[styles.chip, item.tipoPrecificacao === 'preco_fixo' && styles.chipAtivo]}
              onPress={() => onAlternarTipo(item.chave, 'preco_fixo')}
            >
              <Text style={[styles.chipTexto, item.tipoPrecificacao === 'preco_fixo' && styles.chipTextoAtivo]}>
                Preço fixo pra {item.quantidadeMinima}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.campoLabel}>
            {item.tipoPrecificacao === 'preco_fixo' ? `Preço fixo (R$) pras ${item.quantidadeMinima} unidades` : 'Desconto (%) no último item'}
          </Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={valorExibido(item, 'valor')}
            onChangeText={(texto) => onDigitarValor(item.chave, texto)}
            onBlur={() => onConfirmarValor(item.chave)}
          />

          <Text style={styles.previaTexto}>{descricaoKit(itemMesmoParaKit(item))}</Text>
          <ComparativoCustoVenda custo={totalCusto} venda={totalPago} legenda={`por ${item.quantidadeMinima} unidades`} />
        </View>
      )}
    </Card>
  );
}

export function SugestaoKitsScreen() {
  const { profile } = useAuth();
  const [modo, setModo] = useState<ModoKit>('diferentes');
  const [macroGrupo, setMacroGrupo] = useState<MacroGrupo | null>(null);
  const [margemMinima, setMargemMinima] = useState('20');
  const [descontoAlvo, setDescontoAlvo] = useState('20');
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[]>([]);
  const [gerando, setGerando] = useState(false);
  const [gerada, setGerada] = useState(false);
  const [itens, setItens] = useState<ItemSugerido[]>([]);
  // Buffer de texto por par, desacoplado do número guardado em itens —
  // sem isso, digitar "12," recalculava na hora via parseDecimalBR e o
  // TextInput reformatava de volta pra "12", comendo a vírgula antes
  // do usuário terminar de digitar o decimal (mesmo achado 26/08/2026
  // documentado em CampanhasScreen.textosPreco/CartazetesScreen.kitBuffers).
  const [valorBuffer, setValorBuffer] = useState<Record<string, string>>({});

  // Modo "Mesmo item" — kit de produto único (leve N, pague menos),
  // pedido explícito 02/09/2026. Reusa os MESMOS campos de filtro do
  // modo "Itens diferentes" (categoria/margem mínima/desconto alvo) +
  // "quantos são" — "Gerar sugestões" roda igual, só que via
  // sugerirProdutosCampanha (mesmo motor de Campanhas, modo
  // 'popularidade') em vez da RPC de afinidade, pedido explícito
  // 02/09/2026 ("rode da mesma forma buscando por margem e desconto alvo").
  const [quantidadeKit, setQuantidadeKit] = useState('3');
  const [itensMesmoProduto, setItensMesmoProduto] = useState<ItemSugeridoMesmo[]>([]);
  const [geradaMesmo, setGeradaMesmo] = useState(false);
  const [valorBufferMesmo, setValorBufferMesmo] = useState<Record<string, string>>({});
  const [quantidadeBufferMesmo, setQuantidadeBufferMesmo] = useState<Record<string, string>>({});

  const [nome, setNome] = useState('');
  const [dataInicio, setDataInicio] = useState(todayISO());
  const [dataFim, setDataFim] = useState(somarDias(todayISO(), 7));
  const [calendarioAberto, setCalendarioAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const alternarSelecionadoMesmo = (chave: string) => {
    setItensMesmoProduto((atual) => atual.map((i) => (i.chave === chave ? { ...i, selecionado: !i.selecionado } : i)));
  };

  const alternarTipoMesmo = (chave: string, tipo: TipoPrecificacaoKit) => {
    setItensMesmoProduto((atual) => atual.map((i) => (i.chave === chave ? { ...i, tipoPrecificacao: tipo } : i)));
    setValorBufferMesmo((atual) => {
      const { [chave]: _removido, ...resto } = atual;
      return resto;
    });
  };

  const valorExibidoMesmo = (item: ItemSugeridoMesmo, campo: 'quantidade' | 'valor'): string => {
    if (campo === 'quantidade') return quantidadeBufferMesmo[item.chave] ?? String(item.quantidadeMinima);
    const digitado = valorBufferMesmo[item.chave];
    if (digitado !== undefined) return digitado;
    return item.tipoPrecificacao === 'percentual' ? formatDecimalBR(item.percentualDescontoItem) : formatDecimalBR(item.precoFixo);
  };

  const digitarQuantidadeMesmo = (chave: string, texto: string) => {
    setQuantidadeBufferMesmo((atual) => ({ ...atual, [chave]: texto }));
  };

  // Mesmo padrão de confirmarKitQuantidade (CartazetesScreen) — só
  // atualiza a quantidade, não recalcula o valor sozinho (o gestor
  // ajusta o desconto/preço fixo à parte se quiser).
  const confirmarQuantidadeMesmo = (chave: string) => {
    const texto = quantidadeBufferMesmo[chave];
    if (texto !== undefined) {
      const quantidade = Math.max(2, Math.round(parseDecimalBR(texto)) || 2);
      setItensMesmoProduto((atual) => atual.map((i) => (i.chave === chave ? { ...i, quantidadeMinima: quantidade } : i)));
    }
    setQuantidadeBufferMesmo((atual) => {
      const { [chave]: _removido, ...resto } = atual;
      return resto;
    });
  };

  const digitarValorMesmo = (chave: string, texto: string) => {
    setValorBufferMesmo((atual) => ({ ...atual, [chave]: texto }));
  };

  const confirmarValorMesmo = (chave: string) => {
    const texto = valorBufferMesmo[chave];
    if (texto !== undefined) {
      const digitado = parseDecimalBR(texto);
      setItensMesmoProduto((atual) =>
        atual.map((i) => {
          if (i.chave !== chave) return i;
          if (i.tipoPrecificacao === 'percentual') {
            return { ...i, percentualDescontoItem: Math.min(100, Math.max(0, round2(digitado))) };
          }
          return { ...i, precoFixo: Math.max(0.01, round2(digitado)) };
        })
      );
    }
    setValorBufferMesmo((atual) => {
      const { [chave]: _removido, ...resto } = atual;
      return resto;
    });
  };

  const gerarSugestoesMesmoItem = async () => {
    if (!profile || !macroGrupo) return;
    setGerando(true);
    try {
      const margemMinimaPct = parseDecimalBR(margemMinima) || 0;
      const descontoAlvoPct = parseDecimalBR(descontoAlvo) || 0;
      const quantidadeMinima = Math.max(2, Math.round(parseDecimalBR(quantidadeKit)) || 2);
      const sugestoes = await repository.sugerirProdutosCampanha(profile, {
        margemMinimaPct,
        descontoAlvoPct,
        quantidadeMaxima: 20,
        modo: 'popularidade',
        macroGrupo,
      });
      if (sugestoes.length === 0) {
        alertar('Nenhum produto nessa categoria', 'Escolha outra categoria — não achei produto elegível pra sugerir kit.');
        setItensMesmoProduto((atual) => atual.filter((i) => i.selecionado));
        setGeradaMesmo(true);
        return;
      }
      const itensGerados: ItemSugeridoMesmo[] = sugestoes.map((s: ProdutoElegibilidade) => {
        const base = { precoVenda: s.produto.precoVenda, custoMedio: s.produto.custoMedio, quantidade: quantidadeMinima };
        const { percentualDesconto } = calcularKitPercentualSustentavel([base], descontoAlvoPct, margemMinimaPct);
        const { precoFixo } = calcularKitPrecoFixoSustentavel([base], margemMinimaPct);
        return {
          chave: String(s.produto.codigo),
          codigoProduto: s.produto.codigo,
          codigoBarras: s.produto.codigoBarras,
          nomeProduto: s.produto.nome,
          precoRegular: s.produto.precoVenda,
          custoMedio: s.produto.custoMedio,
          quantidadeVendida30d: s.quantidadeVendida30d,
          selecionado: false,
          quantidadeMinima,
          tipoPrecificacao: 'percentual',
          percentualDescontoItem: percentualDesconto,
          precoFixo,
        };
      });
      // Mesmo critério de gerarSugestoes (afinidade): gerar de novo não
      // apaga quem já estava selecionado, só descarta o "lixo" não
      // selecionado da geração anterior.
      setItensMesmoProduto((atual) => {
        const selecionadosAtuais = atual.filter((i) => i.selecionado);
        const chavesJaSelecionadas = new Set(selecionadosAtuais.map((i) => i.chave));
        const novos = itensGerados.filter((i) => !chavesJaSelecionadas.has(i.chave));
        return [...selecionadosAtuais, ...novos];
      });
      setGeradaMesmo(true);
    } catch (erro) {
      alertar('Erro ao gerar sugestões', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setGerando(false);
    }
  };

  const gerarSugestoesAfinidade = async () => {
    if (!profile || !macroGrupo) return;
    setGerando(true);
    try {
      let catalogoAtual = catalogo;
      if (catalogoAtual.length === 0) {
        catalogoAtual = await repository.getCatalogoProdutos(profile);
        setCatalogo(catalogoAtual);
      }
      const codigosSeed = resolverCodigosSeed(catalogoAtual, macroGrupo);
      if (codigosSeed.length === 0) {
        alertar('Nenhum produto nessa categoria', 'Escolha outra categoria — o catálogo não tem produto classificado nela.');
        // mantém o que já estava selecionado — só limpa as sugestões
        // não-selecionadas dessa tentativa (não teve nenhuma mesmo).
        setItens((atual) => atual.filter((i) => i.selecionado));
        setGerada(true);
        return;
      }

      const margemMinimaPct = Number(margemMinima.replace(',', '.')) || 0;
      const descontoAlvoPct = Number(descontoAlvo.replace(',', '.')) || 0;
      const sugestoes = await repository.sugerirParesAfinidade(profile, { macroGrupo });
      const itensGerados: ItemSugerido[] = sugestoes.map((s) => {
        const { percentualDesconto } = calcularKitPercentualSustentavel(produtosParaCalculo(s), descontoAlvoPct, margemMinimaPct);
        const { precoFixo } = calcularKitPrecoFixoSustentavel(produtosParaCalculo(s), margemMinimaPct);
        return {
          ...s,
          chave: `${s.codigoProdutoSeed}-${s.codigoProdutoParceiro}`,
          selecionado: false,
          tipoPrecificacao: 'percentual',
          percentualDescontoItem: percentualDesconto,
          precoFixo,
        };
      });
      // Gerar de novo (outra categoria, por ex.) NÃO apaga o que já
      // tinha sido selecionado — pedido explícito, pra dar pra montar
      // vários kits de várias categorias numa campanha só. Só descarta
      // os NÃO selecionados da geração anterior (lixo de navegação).
      setItens((atual) => {
        const selecionadosAtuais = atual.filter((i) => i.selecionado);
        const chavesJaSelecionadas = new Set(selecionadosAtuais.map((i) => i.chave));
        const novos = itensGerados.filter((i) => !chavesJaSelecionadas.has(i.chave));
        return [...selecionadosAtuais, ...novos];
      });
      setGerada(true);
    } catch (erro) {
      alertar('Erro ao gerar sugestões', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setGerando(false);
    }
  };

  // Um botão só (mesma posição/rótulo nos dois modos) — despacha pro
  // motor certo conforme o modo escolhido, pedido explícito 02/09/2026.
  const gerarSugestoes = () => (modo === 'diferentes' ? gerarSugestoesAfinidade() : gerarSugestoesMesmoItem());

  const alternarSelecionado = (chave: string) => {
    setItens((atual) => atual.map((i) => (i.chave === chave ? { ...i, selecionado: !i.selecionado } : i)));
  };

  const alternarTipo = (chave: string, tipo: TipoPrecificacaoKit) => {
    setItens((atual) => atual.map((i) => (i.chave === chave ? { ...i, tipoPrecificacao: tipo } : i)));
    // troca de tipo troca qual campo aparece — limpa o buffer do campo
    // anterior pra não vazar texto de "% desconto" pro campo de preço
    // fixo (ou vice-versa) quando o gestor voltar a editar.
    setValorBuffer((atual) => {
      const { [chave]: _removido, ...resto } = atual;
      return resto;
    });
  };

  const valorExibido = (item: ItemSugerido): string => {
    const digitado = valorBuffer[item.chave];
    if (digitado !== undefined) return digitado;
    return item.tipoPrecificacao === 'percentual'
      ? formatDecimalBR(item.percentualDescontoItem)
      : formatDecimalBR(item.precoFixo);
  };

  const digitarValor = (chave: string, texto: string) => {
    setValorBuffer((atual) => ({ ...atual, [chave]: texto }));
  };

  // Confirma ao sair do campo (onBlur) — mesmo padrão de
  // CartazetesScreen.confirmarValorKit, com clamp nos limites que o
  // banco exige (campanha_kits_precificacao_coerente/checks em
  // migracao_kits_afinidade.sql): percentual 0-100, preço fixo > 0.
  // Sem isso, um valor fora da faixa só falhava no INSERT com um erro
  // de constraint cru, direto pro alerta genérico de "Erro ao salvar".
  const confirmarValor = (chave: string) => {
    const texto = valorBuffer[chave];
    if (texto !== undefined) {
      const digitado = parseDecimalBR(texto);
      setItens((atual) =>
        atual.map((i) => {
          if (i.chave !== chave) return i;
          if (i.tipoPrecificacao === 'percentual') {
            return { ...i, percentualDescontoItem: Math.min(100, Math.max(0, round2(digitado))) };
          }
          return { ...i, precoFixo: Math.max(0.01, round2(digitado)) };
        })
      );
    }
    setValorBuffer((atual) => {
      const { [chave]: _removido, ...resto } = atual;
      return resto;
    });
  };

  const selecionados = itens.filter((i) => i.selecionado);
  const naoSelecionados = itens.filter((i) => !i.selecionado);
  const selecionadosMesmo = itensMesmoProduto.filter((i) => i.selecionado);
  const naoSelecionadosMesmo = itensMesmoProduto.filter((i) => !i.selecionado);

  const salvar = async () => {
    if (!profile) return;
    setSalvando(true);
    try {
      const kits: KitMultiProduto[] = selecionados.map((item) => itemParaKit(item, dataInicio, dataFim));
      // Kit de produto único vira CampanhaProduto com tipoPromocao 'kit'
      // (mesmo formato que CartazetesScreen já grava) — precoPromocional/
      // percentualDesconto aqui são só um resumo pra exibição, quem manda
      // no cartaz de verdade é o objeto `kit`.
      const produtosMesmoItem: CampanhaProduto[] = selecionadosMesmo.map((item) => {
        const kit = itemMesmoParaKit(item);
        const { precoMedioUnidade } = margemResultanteKitProdutoUnico(kit, item.precoRegular, item.custoMedio);
        const percentualDesconto =
          item.precoRegular > 0 ? round2(((item.precoRegular - precoMedioUnidade) / item.precoRegular) * 100) : 0;
        return {
          codigoProduto: item.codigoProduto,
          codigoBarras: item.codigoBarras,
          nomeProduto: item.nomeProduto,
          precoRegular: item.precoRegular,
          custoMedio: item.custoMedio,
          precoPromocional: precoMedioUnidade,
          percentualDesconto,
          quantidadeCartazes: 1,
          dataInicio,
          dataFim,
          tipoPromocao: 'kit',
          kit,
        };
      });
      const totalKits = kits.length + produtosMesmoItem.length;

      await repository.salvarCampanha(profile, { nome: nome.trim(), dataInicio, dataFim, produtos: produtosMesmoItem, kits });
      alertar('Campanha criada', `"${nome.trim()}" criada com ${totalKits} kit(s) — ajuste preço e imprima em Cartazetes.`);
      setNome('');
      setItens([]);
      setItensMesmoProduto([]);
      setGerada(false);
      setGeradaMesmo(false);
      setMacroGrupo(null);
    } catch (erro) {
      alertar('Erro ao salvar campanha', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const totalSelecionado = selecionados.length + selecionadosMesmo.length;

  // Botão "Fechar campanha" pede confirmação antes de gravar — pedido
  // explícito ("quando fechar, confirme"), já que pode juntar kits de
  // várias categorias acumuladas (dos dois modos) e vale um último
  // "tem certeza" antes de criar de vez.
  const confirmarEFechar = () => {
    if (!nome.trim()) {
      alertar('Nome obrigatório', 'Dê um nome pra campanha antes de fechar.');
      return;
    }
    if (dataFim < dataInicio) {
      alertar('Datas inválidas', 'A data de fim precisa ser igual ou depois da data de início.');
      return;
    }
    if (totalSelecionado === 0) {
      alertar('Nenhum kit selecionado', 'Marque pelo menos um kit antes de fechar.');
      return;
    }
    confirmar(
      'Fechar campanha',
      `Confirma criar "${nome.trim()}" com ${totalSelecionado} kit(s)? Depois é só ajustar preço/imprimir em Cartazetes.`,
      salvar,
      { textoConfirmar: 'Fechar campanha' }
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.conteudo}>
      <Text style={styles.title}>🧺 Kits sugeridos</Text>
      <Text style={styles.subtitle}>
        {modo === 'diferentes'
          ? 'Produtos DIFERENTES que os clientes já compram juntos, calculado a partir da venda real — escolha uma categoria pra começar.'
          : 'Kit do MESMO produto (ex.: leve 3, pague 2) — escolha uma categoria e quantos itens por kit pra começar.'}
      </Text>

      <View style={styles.segmentedWrap}>
        <Pressable
          style={[styles.segmentButton, modo === 'diferentes' && styles.segmentButtonAtivo]}
          onPress={() => setModo('diferentes')}
        >
          <Text style={[styles.segmentText, modo === 'diferentes' && styles.segmentTextAtivo]}>Itens diferentes</Text>
        </Pressable>
        <Pressable
          style={[styles.segmentButton, modo === 'mesmo_item' && styles.segmentButtonAtivo]}
          onPress={() => setModo('mesmo_item')}
        >
          <Text style={[styles.segmentText, modo === 'mesmo_item' && styles.segmentTextAtivo]}>Mesmo item</Text>
        </Pressable>
      </View>

      <Card>
        <Text style={styles.cardTitulo}>Categoria</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.filtroRow}>
            {ORDEM_MACRO_GRUPOS.map((grupo) => (
              <Pressable
                key={grupo}
                style={[styles.filtroChip, macroGrupo === grupo && styles.filtroChipAtivo]}
                onPress={() => setMacroGrupo(grupo)}
              >
                <Text style={[styles.filtroChipTexto, macroGrupo === grupo && styles.filtroChipTextoAtivo]}>
                  {MACRO_GRUPO_LABEL[grupo]}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View style={styles.linhaDoisCampos}>
          <View style={styles.campoMetade}>
            <Text style={[styles.rotulo, styles.espacado]}>Margem mínima (%)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={margemMinima} onChangeText={setMargemMinima} />
          </View>
          <View style={styles.campoMetade}>
            <Text style={[styles.rotulo, styles.espacado]}>Desconto alvo (%)</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={descontoAlvo} onChangeText={setDescontoAlvo} />
          </View>
        </View>

        {modo === 'mesmo_item' && (
          <>
            <Text style={[styles.rotulo, styles.espacado]}>Quantos itens no kit</Text>
            <TextInput style={styles.input} keyboardType="numeric" value={quantidadeKit} onChangeText={setQuantidadeKit} />
          </>
        )}

        <Pressable
          style={[styles.botaoGerar, !macroGrupo && styles.botaoDesabilitado]}
          onPress={gerarSugestoes}
          disabled={!macroGrupo || gerando}
        >
          {gerando ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.botaoGerarTexto}>Gerar sugestões</Text>
          )}
        </Pressable>
      </Card>

      {modo === 'diferentes' ? (
        <>
          {selecionados.length > 0 && (
            <>
              <Text style={styles.sectionTitulo}>Selecionados ({selecionados.length})</Text>
              {selecionados.map((item) => (
                <CardParSugerido
                  key={item.chave}
                  item={item}
                  dataInicio={dataInicio}
                  dataFim={dataFim}
                  onToggle={alternarSelecionado}
                  onAlternarTipo={alternarTipo}
                  valorExibido={valorExibido}
                  onDigitarValor={digitarValor}
                  onConfirmarValor={confirmarValor}
                />
              ))}
            </>
          )}

          {gerada && (
            <>
              <Text style={styles.sectionTitulo}>Pares sugeridos ({naoSelecionados.length})</Text>
              {naoSelecionados.length === 0 ? (
                <Card>
                  <Text style={styles.empty}>
                    {itens.length === 0
                      ? 'Nenhum par com co-ocorrência relevante nessa categoria no período analisado.'
                      : 'Todos os pares sugeridos dessa categoria já estão selecionados acima.'}
                  </Text>
                </Card>
              ) : (
                naoSelecionados.map((item) => (
                  <CardParSugerido
                    key={item.chave}
                    item={item}
                    dataInicio={dataInicio}
                    dataFim={dataFim}
                    onToggle={alternarSelecionado}
                    onAlternarTipo={alternarTipo}
                    valorExibido={valorExibido}
                    onDigitarValor={digitarValor}
                    onConfirmarValor={confirmarValor}
                  />
                ))
              )}
            </>
          )}
        </>
      ) : (
        <>
          {selecionadosMesmo.length > 0 && (
            <>
              <Text style={styles.sectionTitulo}>Selecionados ({selecionadosMesmo.length})</Text>
              {selecionadosMesmo.map((item) => (
                <CardProdutoSugeridoMesmo
                  key={item.chave}
                  item={item}
                  onToggle={alternarSelecionadoMesmo}
                  onAlternarTipo={alternarTipoMesmo}
                  valorExibido={valorExibidoMesmo}
                  onDigitarQuantidade={digitarQuantidadeMesmo}
                  onConfirmarQuantidade={confirmarQuantidadeMesmo}
                  onDigitarValor={digitarValorMesmo}
                  onConfirmarValor={confirmarValorMesmo}
                />
              ))}
            </>
          )}

          {geradaMesmo && (
            <>
              <Text style={styles.sectionTitulo}>Produtos sugeridos ({naoSelecionadosMesmo.length})</Text>
              {naoSelecionadosMesmo.length === 0 ? (
                <Card>
                  <Text style={styles.empty}>
                    {itensMesmoProduto.length === 0
                      ? 'Nenhum produto elegível nessa categoria com esses critérios.'
                      : 'Todos os produtos sugeridos dessa categoria já estão selecionados acima.'}
                  </Text>
                </Card>
              ) : (
                naoSelecionadosMesmo.map((item) => (
                  <CardProdutoSugeridoMesmo
                    key={item.chave}
                    item={item}
                    onToggle={alternarSelecionadoMesmo}
                    onAlternarTipo={alternarTipoMesmo}
                    valorExibido={valorExibidoMesmo}
                    onDigitarQuantidade={digitarQuantidadeMesmo}
                    onConfirmarQuantidade={confirmarQuantidadeMesmo}
                    onDigitarValor={digitarValorMesmo}
                    onConfirmarValor={confirmarValorMesmo}
                  />
                ))
              )}
            </>
          )}
        </>
      )}

      {totalSelecionado > 0 && (
        <Card>
          <Text style={styles.cardTitulo}>Fechar campanha com {totalSelecionado} kit(s)</Text>
          <Text style={styles.subinfoFechar}>
            Pode trocar de modo/categoria acima e adicionar mais kits — o que já está selecionado (nos dois modos) fica
            guardado até você fechar.
          </Text>
          <TextInput style={styles.input} placeholder="Nome da campanha" value={nome} onChangeText={setNome} />
          <Text style={[styles.rotulo, styles.espacado]}>Período</Text>
          <Pressable style={styles.botaoPeriodo} onPress={() => setCalendarioAberto(true)}>
            <Ionicons name="calendar-outline" size={18} color={colors.navy} />
            <Text style={styles.botaoPeriodoTexto}>
              {dataInicio === dataFim ? formatDateBR(dataInicio) : `${formatDateBR(dataInicio)} até ${formatDateBR(dataFim)}`}
            </Text>
          </Pressable>

          <Pressable style={styles.botaoGerar} onPress={confirmarEFechar} disabled={salvando}>
            {salvando ? <ActivityIndicator color={colors.white} /> : <Text style={styles.botaoGerarTexto}>Fechar campanha</Text>}
          </Pressable>
        </Card>
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  conteudo: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 14, lineHeight: 18 },
  empty: { color: colors.textSecondary },
  cardTitulo: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  subinfoFechar: { fontSize: 12, color: colors.textSecondary, marginBottom: 10, lineHeight: 17 },
  sectionTitulo: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 16, marginBottom: 8 },
  rotulo: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  espacado: { marginTop: 10 },
  filtroRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  filtroChip: {
    backgroundColor: colors.white,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filtroChipAtivo: { backgroundColor: colors.navy, borderColor: colors.navy },
  filtroChipTexto: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  filtroChipTextoAtivo: { color: colors.white },
  linhaDoisCampos: { flexDirection: 'row', gap: 10 },
  campoMetade: { flex: 1 },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 14,
    color: colors.textPrimary,
    marginTop: 4,
  },
  botaoGerar: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  botaoDesabilitado: { opacity: 0.5 },
  botaoGerarTexto: { color: colors.white, fontWeight: '700', fontSize: 14 },
  itemHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemHeaderTexto: { flex: 1 },
  itemNome: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  itemSubinfo: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  painelExpandido: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  campoLabel: { fontSize: 11, color: colors.textSecondary, marginBottom: 4, marginTop: 8 },
  grupoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.white,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipAtivo: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipTexto: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  chipTextoAtivo: { color: colors.white },
  previaTexto: { fontSize: 12, color: colors.navy, fontWeight: '600', marginTop: 10 },
  margemTexto: { fontSize: 11, color: colors.textMuted, marginTop: 4, lineHeight: 15 },
  margemTextoNegativa: { color: colors.red, fontWeight: '600' },
  botaoPeriodo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
  },
  botaoPeriodoTexto: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  segmentedWrap: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentButton: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segmentButtonAtivo: { backgroundColor: colors.navy },
  segmentText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  segmentTextAtivo: { color: colors.white },
  grupoLabelEspacado: { marginTop: 14 },
});
