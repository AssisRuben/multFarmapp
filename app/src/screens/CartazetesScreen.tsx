import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuth } from '../context/AuthContext';
import { repository } from '../data';
import { Card } from '../components/Card';
import { LoadingFarmacia } from '../components/LoadingFarmacia';
import { ComparativoCustoVenda } from '../components/ComparativoCustoVenda';
import { colors } from '../theme/colors';
import { formatBRL, formatDateBR, formatDateCurtoBR, formatDecimalBR, parseDateBR, parseDecimalBR } from '../lib/format';
import { agruparParaCartazetes } from '../lib/cartazetes';
import { CartazesPorPagina, gerarHtmlCartazes } from '../lib/cartazHtml';
import { gerarTxtTrier } from '../lib/trierTxt';
import { imprimirHtmlNoWeb } from '../lib/printWeb';
import { baixarArquivoTextoNoWeb } from '../lib/downloadWeb';
import { alertar } from '../lib/alert';
import { descricaoKit, descricaoKitMultiProduto, margemResultanteKitMultiProduto, margemResultanteKitProdutoUnico, PRESETS_KIT } from '../lib/kits';
import {
  Campanha,
  CampanhaProduto,
  KitMultiProduto,
  KitPromocao,
  TipoPrecificacaoKit,
  TipoPromocaoProduto,
} from '../types/domain';

function round2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

// Campos do painel expandido que aceitam texto formatado (vírgula
// decimal, data BR) diferente do valor numérico/ISO guardado no item —
// digitação livre num buffer à parte, valor canônico só é recalculado
// ao sair do campo (onBlur). kitQuantidade/kitValor (02/09/2026) são
// do kit de produto único (diferente de CampoEditavelKit mais abaixo,
// que é do kit MULTI-produto, chave por id de kit em vez de
// codigoProduto).
type CampoEditavel = 'de' | 'por' | 'desconto' | 'validadeInicio' | 'validadeFim' | 'kitQuantidade' | 'kitValor';

// Mesmo espírito de CampoEditavel, mas pros campos de kit multi-produto
// (chave é o id do kit, não codigoProduto).
type CampoEditavelKit = 'valor' | 'validadeInicio' | 'validadeFim';

export function CartazetesScreen() {
  const { profile } = useAuth();
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [loading, setLoading] = useState(true);
  const [campanhaSelecionada, setCampanhaSelecionada] = useState<Campanha | null>(null);
  const [itens, setItens] = useState<CampanhaProduto[]>([]);
  const [kits, setKits] = useState<KitMultiProduto[]>([]);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [expandidoKit, setExpandidoKit] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Record<string, Partial<Record<CampoEditavel, string>>>>({});
  const [kitBuffers, setKitBuffers] = useState<Record<string, Partial<Record<CampoEditavelKit, string>>>>({});
  const [processando, setProcessando] = useState<'pdf' | 'txt' | 'campanha' | null>(null);
  const [cartazesPorPagina, setCartazesPorPagina] = useState<CartazesPorPagina>(3);

  const carregar = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setCampanhas(await repository.getCampanhas(profile));
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const selecionar = async (campanha: Campanha) => {
    if (!profile) return;
    // getCampanhas (lista) vem sem nome/código de barras resolvidos, de
    // propósito, pra não buscar o catálogo inteiro só pra listar — usar
    // esse dado direto aqui deixava o cartaz sem nome do produto
    // (achado 01/09/2026). getCampanha busca só os códigos dessa
    // campanha e resolve certo.
    setLoading(true);
    try {
      const resolvida = (await repository.getCampanha(profile, campanha.id)) ?? campanha;
      setCampanhaSelecionada(resolvida);
      setItens(
        resolvida.produtos.map((p) => ({
          ...p,
          // campanhas salvas antes da validade por item existir não têm
          // dataInicio/dataFim no produto — cai pra validade da campanha.
          dataInicio: p.dataInicio || resolvida.dataInicio,
          dataFim: p.dataFim || resolvida.dataFim,
        }))
      );
      setKits(resolvida.kits);
      setExpandido(null);
      setExpandidoKit(null);
      setBuffers({});
      setKitBuffers({});
    } finally {
      setLoading(false);
    }
  };

  const alternarExpandido = (codigoProduto: number) => {
    setExpandido((atual) => (atual === codigoProduto ? null : codigoProduto));
  };

  const alternarExpandidoKit = (kitId: string) => {
    setExpandidoKit((atual) => (atual === kitId ? null : kitId));
  };

  const ajustarQuantidadeKit = (kitId: string, texto: string) => {
    const quantidade = Math.max(1, Number(texto.replace(/\D/g, '')) || 1);
    setKits((atual) => atual.map((k) => (k.id === kitId ? { ...k, quantidadeCartazes: quantidade } : k)));
  };

  // Trocar o tipo de precificação zera o outro campo — evita ficar um
  // valor "fantasma" gravado que não é o tipo ativo (mesmo espírito de
  // alternarTipoPromocao, mas aqui não precisa ficar vazio esperando
  // escolha: já sugere um valor OK de cara a partir do que tinha).
  const alternarTipoPrecificacaoKit = (kitId: string, tipo: TipoPrecificacaoKit) => {
    setKits((atual) =>
      atual.map((k) => {
        if (k.id !== kitId) return k;
        if (tipo === k.tipoPrecificacao) return k;
        const totalRegular = k.produtos.reduce((acc, p) => acc + p.precoRegular * p.quantidade, 0);
        if (tipo === 'preco_fixo') {
          const percentual = k.percentualDescontoItem ?? 0;
          return { ...k, tipoPrecificacao: tipo, precoFixo: round2(totalRegular * (1 - percentual / 100)), percentualDescontoItem: null };
        }
        const precoFixo = k.precoFixo ?? totalRegular;
        const percentual = totalRegular > 0 ? Math.max(0, round2(((totalRegular - precoFixo) / totalRegular) * 100)) : 0;
        return { ...k, tipoPrecificacao: tipo, percentualDescontoItem: percentual, precoFixo: null };
      })
    );
  };

  const valorExibidoKit = (kit: KitMultiProduto, campo: CampoEditavelKit): string => {
    const digitado = kitBuffers[kit.id]?.[campo];
    if (digitado !== undefined) return digitado;
    switch (campo) {
      case 'valor':
        return kit.tipoPrecificacao === 'preco_fixo'
          ? formatDecimalBR(kit.precoFixo ?? 0)
          : formatDecimalBR(kit.percentualDescontoItem ?? 0);
      case 'validadeInicio':
        return formatDateCurtoBR(kit.dataInicio);
      case 'validadeFim':
        return formatDateCurtoBR(kit.dataFim);
      default:
        return '';
    }
  };

  const digitarKit = (kitId: string, campo: CampoEditavelKit, texto: string) => {
    setKitBuffers((atual) => ({ ...atual, [kitId]: { ...atual[kitId], [campo]: texto } }));
  };

  const limparBufferKit = (kitId: string, campo: CampoEditavelKit) => {
    setKitBuffers((atual) => {
      if (!atual[kitId]?.[campo]) return atual;
      const { [campo]: _removido, ...resto } = atual[kitId]!;
      return { ...atual, [kitId]: resto };
    });
  };

  // Clamp nos limites que o banco exige (checks em
  // migracao_kits_afinidade.sql: percentual 0-100, preço fixo > 0) —
  // sem isso um valor fora da faixa só falhava no INSERT com erro de
  // constraint cru, direto pro alerta genérico de "Erro ao salvar".
  const confirmarValorKit = (kitId: string) => {
    const texto = kitBuffers[kitId]?.valor;
    if (texto !== undefined) {
      const digitado = parseDecimalBR(texto);
      setKits((atual) =>
        atual.map((k) =>
          k.id === kitId
            ? k.tipoPrecificacao === 'preco_fixo'
              ? { ...k, precoFixo: Math.max(0.01, round2(digitado)) }
              : { ...k, percentualDescontoItem: Math.min(100, Math.max(0, round2(digitado))) }
            : k
        )
      );
    }
    limparBufferKit(kitId, 'valor');
  };

  const confirmarValidadeKit = (kitId: string, campo: 'dataInicio' | 'dataFim') => {
    const campoBuffer: CampoEditavelKit = campo === 'dataInicio' ? 'validadeInicio' : 'validadeFim';
    const texto = kitBuffers[kitId]?.[campoBuffer];
    if (texto !== undefined) {
      const iso = parseDateBR(texto);
      if (iso) {
        setKits((atual) => atual.map((k) => (k.id === kitId ? { ...k, [campo]: iso } : k)));
      }
    }
    limparBufferKit(kitId, campoBuffer);
  };

  const ajustarQuantidade = (codigoProduto: number, texto: string) => {
    const quantidade = Math.max(1, Number(texto.replace(/\D/g, '')) || 1);
    setItens((atual) => atual.map((i) => (i.codigoProduto === codigoProduto ? { ...i, quantidadeCartazes: quantidade } : i)));
  };

  // Alternar pra "kit" começa sem preset marcado (obriga escolher um
  // antes de fechar o painel — sem isso o cartaz ficaria com "kit"
  // mas nenhum texto de kit pra mostrar). Voltar pra "unitario" limpa
  // o kit salvo (evita ficar um kit "fantasma" gravado sem uso).
  const alternarTipoPromocao = (codigoProduto: number, tipo: TipoPromocaoProduto) => {
    setItens((atual) =>
      atual.map((i) => (i.codigoProduto === codigoProduto ? { ...i, tipoPromocao: tipo, kit: tipo === 'kit' ? i.kit : null } : i))
    );
  };

  const escolherKit = (codigoProduto: number, kit: CampanhaProduto['kit']) => {
    setItens((atual) => atual.map((i) => (i.codigoProduto === codigoProduto ? { ...i, kit } : i)));
  };

  const KIT_PADRAO: KitPromocao = { quantidadeMinima: 2, tipoPrecificacao: 'percentual', percentualDescontoItem: 0, precoFixo: null };

  // Edição manual (02/09/2026, além dos 3 atalhos de PRESETS_KIT) —
  // quantidade mínima e o valor (percentual ou preço fixo, conforme o
  // tipo escolhido) do kit de produto único. Cria um kit com valores
  // padrão se ainda não tinha nenhum (ex.: gestor abriu "Kit" e foi
  // direto editar um campo sem tocar num atalho antes).
  const confirmarKitQuantidade = (codigoProduto: number) => {
    const texto = buffers[String(codigoProduto)]?.kitQuantidade;
    if (texto !== undefined) {
      const quantidade = Math.max(2, Math.round(parseDecimalBR(texto)) || 2);
      setItens((atual) =>
        atual.map((i) => (i.codigoProduto === codigoProduto ? { ...i, kit: { ...(i.kit ?? KIT_PADRAO), quantidadeMinima: quantidade } } : i))
      );
    }
    limparBuffer(codigoProduto, 'kitQuantidade');
  };

  const confirmarKitValor = (codigoProduto: number) => {
    const texto = buffers[String(codigoProduto)]?.kitValor;
    if (texto !== undefined) {
      const digitado = parseDecimalBR(texto);
      setItens((atual) =>
        atual.map((i) => {
          if (i.codigoProduto !== codigoProduto) return i;
          const kitAtual = i.kit ?? KIT_PADRAO;
          if (kitAtual.tipoPrecificacao === 'preco_fixo') {
            return { ...i, kit: { ...kitAtual, precoFixo: Math.max(0.01, round2(digitado)) } };
          }
          return { ...i, kit: { ...kitAtual, percentualDescontoItem: Math.min(100, Math.max(0, round2(digitado))) } };
        })
      );
    }
    limparBuffer(codigoProduto, 'kitValor');
  };

  // Mesmo espírito de alternarTipoPrecificacaoKit (kit multi-produto)
  // — converte o valor pro novo formato em vez de zerar, e limpa o
  // buffer do campo de valor pra não vazar texto do formato anterior.
  const alternarTipoPrecificacaoKitProduto = (codigoProduto: number, tipo: TipoPrecificacaoKit) => {
    setItens((atual) =>
      atual.map((i) => {
        if (i.codigoProduto !== codigoProduto) return i;
        const kitAtual = i.kit ?? KIT_PADRAO;
        if (tipo === kitAtual.tipoPrecificacao) return i;
        const totalRegular = i.precoRegular * kitAtual.quantidadeMinima;
        if (tipo === 'preco_fixo') {
          const percentual = kitAtual.percentualDescontoItem ?? 0;
          return { ...i, kit: { ...kitAtual, tipoPrecificacao: tipo, precoFixo: round2(totalRegular * (1 - percentual / 100)), percentualDescontoItem: null } };
        }
        const precoFixo = kitAtual.precoFixo ?? totalRegular;
        const percentual = totalRegular > 0 ? Math.max(0, round2(((totalRegular - precoFixo) / totalRegular) * 100)) : 0;
        return { ...i, kit: { ...kitAtual, tipoPrecificacao: tipo, percentualDescontoItem: percentual, precoFixo: null } };
      })
    );
    limparBuffer(codigoProduto, 'kitValor');
  };

  // Campos formatados (preço em vírgula, data BR) digitam livre num
  // buffer à parte — o valor no item só é recalculado ao sair do campo,
  // pra não brigar com o usuário no meio da digitação.
  const valorExibido = (item: CampanhaProduto, campo: CampoEditavel): string => {
    const digitado = buffers[String(item.codigoProduto)]?.[campo];
    if (digitado !== undefined) return digitado;
    switch (campo) {
      case 'de':
        return formatDecimalBR(item.precoRegular);
      case 'por':
        return formatDecimalBR(item.precoPromocional);
      case 'desconto':
        return formatDecimalBR(item.percentualDesconto);
      case 'validadeInicio':
        return formatDateCurtoBR(item.dataInicio);
      case 'validadeFim':
        return formatDateCurtoBR(item.dataFim);
      case 'kitQuantidade':
        return String(item.kit?.quantidadeMinima ?? 2);
      case 'kitValor':
        return item.kit?.tipoPrecificacao === 'preco_fixo'
          ? formatDecimalBR(item.kit?.precoFixo ?? 0)
          : formatDecimalBR(item.kit?.percentualDescontoItem ?? 0);
      default:
        return '';
    }
  };

  const digitar = (codigoProduto: number, campo: CampoEditavel, texto: string) => {
    const chave = String(codigoProduto);
    setBuffers((atual) => ({ ...atual, [chave]: { ...atual[chave], [campo]: texto } }));
  };

  const limparBuffer = (codigoProduto: number, campo: CampoEditavel) => {
    const chave = String(codigoProduto);
    setBuffers((atual) => {
      if (!atual[chave]?.[campo]) return atual;
      const { [campo]: _removido, ...resto } = atual[chave]!;
      return { ...atual, [chave]: resto };
    });
  };

  // De/Por/Desconto ficam sempre em sincronia — editar qualquer um dos
  // três recalcula os outros a partir do preço regular como âncora.
  const confirmarDe = (codigoProduto: number) => {
    const texto = buffers[String(codigoProduto)]?.de;
    if (texto !== undefined) {
      const precoRegular = parseDecimalBR(texto);
      setItens((atual) =>
        atual.map((i) => {
          if (i.codigoProduto !== codigoProduto) return i;
          const percentualDesconto = precoRegular > 0 ? round2(((precoRegular - i.precoPromocional) / precoRegular) * 100) : 0;
          return { ...i, precoRegular, percentualDesconto };
        })
      );
    }
    limparBuffer(codigoProduto, 'de');
  };

  const confirmarPor = (codigoProduto: number) => {
    const texto = buffers[String(codigoProduto)]?.por;
    if (texto !== undefined) {
      const precoPromocional = parseDecimalBR(texto);
      setItens((atual) =>
        atual.map((i) => {
          if (i.codigoProduto !== codigoProduto) return i;
          const percentualDesconto = i.precoRegular > 0 ? round2(((i.precoRegular - precoPromocional) / i.precoRegular) * 100) : 0;
          return { ...i, precoPromocional, percentualDesconto };
        })
      );
    }
    limparBuffer(codigoProduto, 'por');
  };

  const confirmarDesconto = (codigoProduto: number) => {
    const texto = buffers[String(codigoProduto)]?.desconto;
    if (texto !== undefined) {
      const percentualDesconto = parseDecimalBR(texto);
      setItens((atual) =>
        atual.map((i) => {
          if (i.codigoProduto !== codigoProduto) return i;
          const precoPromocional = round2(i.precoRegular * (1 - percentualDesconto / 100));
          return { ...i, percentualDesconto, precoPromocional };
        })
      );
    }
    limparBuffer(codigoProduto, 'desconto');
  };

  const confirmarValidade = (codigoProduto: number, campo: 'dataInicio' | 'dataFim') => {
    const campoBuffer: CampoEditavel = campo === 'dataInicio' ? 'validadeInicio' : 'validadeFim';
    const texto = buffers[String(codigoProduto)]?.[campoBuffer];
    if (texto !== undefined) {
      const iso = parseDateBR(texto);
      if (iso) {
        setItens((atual) => atual.map((i) => (i.codigoProduto === codigoProduto ? { ...i, [campo]: iso } : i)));
      }
    }
    limparBuffer(codigoProduto, campoBuffer);
  };

  const grupos = useMemo(() => agruparParaCartazetes(itens), [itens]);
  const totalCartazes =
    grupos.reduce((acc, g) => acc + g.quantidadeCartazes, 0) + kits.reduce((acc, k) => acc + k.quantidadeCartazes, 0);

  // De/Por/Desconto/Validade editados aqui só valiam pra impressão
  // daquele momento — este botão persiste de volta na campanha salva
  // (achado registrado 05/08, resolvido 18/08/2026).
  const salvarNaCampanha = async () => {
    if (!campanhaSelecionada || !profile) return;
    setProcessando('campanha');
    try {
      const salva = await repository.salvarCampanha(profile, {
        id: campanhaSelecionada.id,
        nome: campanhaSelecionada.nome,
        dataInicio: campanhaSelecionada.dataInicio,
        dataFim: campanhaSelecionada.dataFim,
        produtos: itens,
        kits,
      });
      setCampanhaSelecionada(salva);
      setCampanhas((atual) => atual.map((c) => (c.id === salva.id ? salva : c)));
      alertar('Salvo', 'Alterações persistidas na campanha.');
    } catch (erro) {
      alertar('Erro ao salvar campanha', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setProcessando(null);
    }
  };

  const imprimir = async () => {
    if (!campanhaSelecionada || (grupos.length === 0 && kits.length === 0)) return;
    setProcessando('pdf');
    try {
      const html = gerarHtmlCartazes(grupos, kits, cartazesPorPagina);
      if (Platform.OS === 'web') {
        imprimirHtmlNoWeb(html);
      } else {
        await Print.printAsync({ html });
      }
    } catch (erro) {
      alertar('Erro ao gerar PDF', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setProcessando(null);
    }
  };

  const exportarTxt = async () => {
    if (!campanhaSelecionada || itens.length === 0) return;
    // Formato do .txt (ver lib/trierTxt.ts) é 1 preço fixo por linha —
    // não tem como representar "kit" nele (a Trier não tem um formato
    // confirmado pra promoção de leve-mais-pague-menos). Produto em kit
    // fica de fora do arquivo; avisa quantos ficaram.
    const itensUnitarios = itens.filter((i) => i.tipoPromocao !== 'kit');
    if (itensUnitarios.length === 0) {
      alertar(
        'Nada pra exportar',
        'Todos os produtos dessa campanha estão como "Kit" — o formato de importação da Trier ainda não suporta esse tipo de promoção.'
      );
      return;
    }
    setProcessando('txt');
    try {
      const conteudo = gerarTxtTrier(itensUnitarios);
      const nomeArquivo = `campanha-${campanhaSelecionada.id}.txt`;
      const puladosKit = itens.length - itensUnitarios.length;

      if (Platform.OS === 'web') {
        baixarArquivoTextoNoWeb(nomeArquivo, conteudo);
      } else {
        const uri = `${FileSystem.documentDirectory}${nomeArquivo}`;
        await FileSystem.writeAsStringAsync(uri, conteudo);

        const podeCompartilhar = await Sharing.isAvailableAsync();
        if (podeCompartilhar) {
          await Sharing.shareAsync(uri, { mimeType: 'text/plain', dialogTitle: 'Exportar para importação no Trier' });
        } else {
          alertar('Arquivo gerado', `Salvo em: ${uri}`);
        }
      }

      if (puladosKit > 0) {
        alertar(
          'Kits não exportados',
          `${puladosKit} produto(s) "Kit" não entraram no .txt — cadastre essa promoção direto no sistema, se precisar.`
        );
      }
    } catch (erro) {
      alertar('Erro ao gerar TXT', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setProcessando(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingFarmacia />
      </View>
    );
  }

  if (!campanhaSelecionada) {
    return (
      <ScrollView style={styles.container}>
        <Text style={styles.title}>🖨️ Gerador de cartazes</Text>
        <Text style={styles.subtitle}>Escolha uma campanha pra gerar os cartazes e o arquivo de importação.</Text>

        {campanhas.length === 0 ? (
          <Card>
            <Text style={styles.empty}>
              Nenhuma campanha disponível ainda. Crie uma na aba Campanhas primeiro.
            </Text>
          </Card>
        ) : (
          campanhas.map((campanha) => (
            <Card key={campanha.id} onPress={() => selecionar(campanha)}>
              <Text style={styles.itemNome}>{campanha.nome}</Text>
              <Text style={styles.campanhaInfo}>
                {formatDateBR(campanha.dataInicio)} a {formatDateBR(campanha.dataFim)} · {campanha.produtos.length} produto(s)
              </Text>
            </Card>
          ))
        )}
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container}>
      <Pressable style={styles.voltar} onPress={() => setCampanhaSelecionada(null)} hitSlop={8}>
        <Ionicons name="arrow-back" size={18} color={colors.navy} />
        <Text style={styles.voltarTexto}>Cartazetes</Text>
      </Pressable>

      <Text style={styles.title}>{campanhaSelecionada.nome}</Text>
      <Text style={styles.subtitle}>
        Toque num produto pra ajustar de/por, desconto, validade e código antes de imprimir.
      </Text>

      <Text style={styles.sectionTitulo}>Produtos</Text>
      {itens.map((item) => {
        const aberto = expandido === item.codigoProduto;
        return (
          <Card key={item.codigoProduto}>
            <Pressable style={styles.itemHeaderRow} onPress={() => alternarExpandido(item.codigoProduto)}>
              <View style={styles.itemHeaderTexto}>
                <Text style={styles.itemNome} numberOfLines={2}>{item.nomeProduto}</Text>
                <Text style={styles.itemSubinfo}>
                  {item.tipoPromocao === 'kit' && item.kit
                    ? `Código ${item.codigoProduto} · ${descricaoKit(item.kit)}`
                    : `Código ${item.codigoProduto} · ${formatBRL(item.precoPromocional)} (${item.percentualDesconto.toFixed(1)}% off)`}
                </Text>
              </View>
            </Pressable>

            <View style={styles.linhaQuantidade}>
              <Text style={styles.itemLabel}>Cartazes</Text>
              <TextInput
                style={styles.inputQuantidade}
                keyboardType="numeric"
                value={String(item.quantidadeCartazes)}
                onChangeText={(texto) => ajustarQuantidade(item.codigoProduto, texto)}
              />
            </View>

            {aberto && (
              <View style={styles.painelExpandido}>
                <Text style={styles.campoLabel}>Código / código de barras</Text>
                <Text style={styles.campoSomenteLeitura}>
                  {item.codigoProduto} · {item.codigoBarras}
                </Text>

                <Text style={styles.campoLabel}>Tipo de promoção</Text>
                <View style={styles.grupoGrid}>
                  <Pressable
                    style={[styles.chip, item.tipoPromocao === 'unitario' && styles.chipAtivo]}
                    onPress={() => alternarTipoPromocao(item.codigoProduto, 'unitario')}
                  >
                    <Text style={[styles.chipTexto, item.tipoPromocao === 'unitario' && styles.chipTextoAtivo]}>
                      Desconto normal
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.chip, item.tipoPromocao === 'kit' && styles.chipAtivo]}
                    onPress={() => alternarTipoPromocao(item.codigoProduto, 'kit')}
                  >
                    <Text style={[styles.chipTexto, item.tipoPromocao === 'kit' && styles.chipTextoAtivo]}>
                      Kit (leve mais, pague menos)
                    </Text>
                  </Pressable>
                </View>

                {item.tipoPromocao === 'kit' ? (
                  <>
                    <Text style={[styles.campoLabel, styles.grupoLabelEspacado]}>Atalhos</Text>
                    <View style={styles.grupoGrid}>
                      {PRESETS_KIT.map((preset) => {
                        const ativo =
                          item.kit?.quantidadeMinima === preset.kit.quantidadeMinima &&
                          item.kit?.tipoPrecificacao === preset.kit.tipoPrecificacao &&
                          item.kit?.percentualDescontoItem === preset.kit.percentualDescontoItem;
                        return (
                          <Pressable
                            key={preset.label}
                            style={[styles.chip, ativo && styles.chipAtivo]}
                            onPress={() => escolherKit(item.codigoProduto, preset.kit)}
                          >
                            <Text style={[styles.chipTexto, ativo && styles.chipTextoAtivo]}>{preset.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <Text style={styles.campoLabel}>Quantidade mínima</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="numeric"
                      value={valorExibido(item, 'kitQuantidade')}
                      onChangeText={(texto) => digitar(item.codigoProduto, 'kitQuantidade', texto)}
                      onBlur={() => confirmarKitQuantidade(item.codigoProduto)}
                    />

                    <Text style={[styles.campoLabel, styles.grupoLabelEspacado]}>Tipo de preço</Text>
                    <View style={styles.grupoGrid}>
                      <Pressable
                        style={[styles.chip, (item.kit?.tipoPrecificacao ?? 'percentual') === 'percentual' && styles.chipAtivo]}
                        onPress={() => alternarTipoPrecificacaoKitProduto(item.codigoProduto, 'percentual')}
                      >
                        <Text style={[styles.chipTexto, (item.kit?.tipoPrecificacao ?? 'percentual') === 'percentual' && styles.chipTextoAtivo]}>
                          % no {item.kit?.quantidadeMinima ?? 2}º item
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.chip, item.kit?.tipoPrecificacao === 'preco_fixo' && styles.chipAtivo]}
                        onPress={() => alternarTipoPrecificacaoKitProduto(item.codigoProduto, 'preco_fixo')}
                      >
                        <Text style={[styles.chipTexto, item.kit?.tipoPrecificacao === 'preco_fixo' && styles.chipTextoAtivo]}>
                          Preço fixo pra {item.kit?.quantidadeMinima ?? 2}
                        </Text>
                      </Pressable>
                    </View>

                    <Text style={styles.campoLabel}>
                      {item.kit?.tipoPrecificacao === 'preco_fixo'
                        ? `Preço fixo (R$) pras ${item.kit?.quantidadeMinima ?? 2} unidades`
                        : 'Desconto (%) no último item'}
                    </Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="decimal-pad"
                      value={valorExibido(item, 'kitValor')}
                      onChangeText={(texto) => digitar(item.codigoProduto, 'kitValor', texto)}
                      onBlur={() => confirmarKitValor(item.codigoProduto)}
                    />

                    {item.kit ? (
                      (() => {
                        const kit = item.kit!;
                        const { totalCusto, totalPago } = margemResultanteKitProdutoUnico(kit, item.precoRegular, item.custoMedio);
                        return (
                          <>
                            <Text style={styles.previaTexto}>{descricaoKit(kit)}</Text>
                            <ComparativoCustoVenda custo={totalCusto} venda={totalPago} legenda={`por ${kit.quantidadeMinima} unidades`} />
                          </>
                        );
                      })()
                    ) : (
                      <Text style={styles.avisoKit}>Escolha um atalho acima ou preencha os campos antes de imprimir.</Text>
                    )}
                  </>
                ) : (
                  <>
                    <View style={styles.linhaDoisCampos}>
                      <View style={styles.campoMetade}>
                        <Text style={styles.campoLabel}>De (R$)</Text>
                        <TextInput
                          style={styles.input}
                          keyboardType="decimal-pad"
                          value={valorExibido(item, 'de')}
                          onChangeText={(texto) => digitar(item.codigoProduto, 'de', texto)}
                          onBlur={() => confirmarDe(item.codigoProduto)}
                        />
                      </View>
                      <View style={styles.campoMetade}>
                        <Text style={styles.campoLabel}>Por (R$)</Text>
                        <TextInput
                          style={styles.input}
                          keyboardType="decimal-pad"
                          value={valorExibido(item, 'por')}
                          onChangeText={(texto) => digitar(item.codigoProduto, 'por', texto)}
                          onBlur={() => confirmarPor(item.codigoProduto)}
                        />
                      </View>
                    </View>

                    <Text style={styles.campoLabel}>Desconto (%)</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="decimal-pad"
                      value={valorExibido(item, 'desconto')}
                      onChangeText={(texto) => digitar(item.codigoProduto, 'desconto', texto)}
                      onBlur={() => confirmarDesconto(item.codigoProduto)}
                    />
                  </>
                )}

                <View style={styles.linhaDoisCampos}>
                  <View style={styles.campoMetade}>
                    <Text style={styles.campoLabel}>Validade início</Text>
                    <TextInput
                      style={styles.input}
                      value={valorExibido(item, 'validadeInicio')}
                      onChangeText={(texto) => digitar(item.codigoProduto, 'validadeInicio', texto)}
                      onBlur={() => confirmarValidade(item.codigoProduto, 'dataInicio')}
                      placeholder="DD/MM/AA"
                    />
                  </View>
                  <View style={styles.campoMetade}>
                    <Text style={styles.campoLabel}>Validade fim</Text>
                    <TextInput
                      style={styles.input}
                      value={valorExibido(item, 'validadeFim')}
                      onChangeText={(texto) => digitar(item.codigoProduto, 'validadeFim', texto)}
                      onBlur={() => confirmarValidade(item.codigoProduto, 'dataFim')}
                      placeholder="DD/MM/AA"
                    />
                  </View>
                </View>
              </View>
            )}
          </Card>
        );
      })}

      {kits.length > 0 && (
        <>
          <Text style={[styles.sectionTitulo, styles.grupoLabelEspacado]}>Kits</Text>
          {kits.map((kit) => {
            const abertoKit = expandidoKit === kit.id;
            return (
              <Card key={kit.id}>
                <Pressable style={styles.itemHeaderRow} onPress={() => alternarExpandidoKit(kit.id)}>
                  <View style={styles.itemHeaderTexto}>
                    <Text style={styles.itemNome} numberOfLines={2}>
                      {kit.produtos.map((p) => p.nomeProduto).join(' + ')}
                    </Text>
                    <Text style={styles.itemSubinfo}>{descricaoKitMultiProduto(kit)}</Text>
                  </View>
                </Pressable>

                <View style={styles.linhaQuantidade}>
                  <Text style={styles.itemLabel}>Cartazes</Text>
                  <TextInput
                    style={styles.inputQuantidade}
                    keyboardType="numeric"
                    value={String(kit.quantidadeCartazes)}
                    onChangeText={(texto) => ajustarQuantidadeKit(kit.id, texto)}
                  />
                </View>

                {abertoKit && (
                  <View style={styles.painelExpandido}>
                    <Text style={styles.campoLabel}>Produtos do kit</Text>
                    <Text style={styles.campoSomenteLeitura}>
                      {kit.produtos.map((p) => `${p.nomeProduto}${p.quantidade > 1 ? ` (${p.quantidade}x)` : ''}`).join(', ')}
                    </Text>

                    <Text style={styles.campoLabel}>Tipo de preço</Text>
                    <View style={styles.grupoGrid}>
                      <Pressable
                        style={[styles.chip, kit.tipoPrecificacao === 'percentual' && styles.chipAtivo]}
                        onPress={() => alternarTipoPrecificacaoKit(kit.id, 'percentual')}
                      >
                        <Text style={[styles.chipTexto, kit.tipoPrecificacao === 'percentual' && styles.chipTextoAtivo]}>
                          % de desconto no combo
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.chip, kit.tipoPrecificacao === 'preco_fixo' && styles.chipAtivo]}
                        onPress={() => alternarTipoPrecificacaoKit(kit.id, 'preco_fixo')}
                      >
                        <Text style={[styles.chipTexto, kit.tipoPrecificacao === 'preco_fixo' && styles.chipTextoAtivo]}>
                          Preço fixo do combo
                        </Text>
                      </Pressable>
                    </View>

                    <Text style={styles.campoLabel}>{kit.tipoPrecificacao === 'preco_fixo' ? 'Preço fixo (R$)' : 'Desconto (%)'}</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="decimal-pad"
                      value={valorExibidoKit(kit, 'valor')}
                      onChangeText={(texto) => digitarKit(kit.id, 'valor', texto)}
                      onBlur={() => confirmarValorKit(kit.id)}
                    />

                    <Text style={styles.margemTexto}>
                      {kit.produtos.map((p) => `${p.nomeProduto} ${formatBRL(p.custoMedio)}`).join(' + ')}
                    </Text>
                    {(() => {
                      const { totalCusto, precoFinal } = margemResultanteKitMultiProduto(kit);
                      return <ComparativoCustoVenda custo={totalCusto} venda={precoFinal} legenda="por kit" />;
                    })()}

                    <View style={styles.linhaDoisCampos}>
                      <View style={styles.campoMetade}>
                        <Text style={styles.campoLabel}>Validade início</Text>
                        <TextInput
                          style={styles.input}
                          value={valorExibidoKit(kit, 'validadeInicio')}
                          onChangeText={(texto) => digitarKit(kit.id, 'validadeInicio', texto)}
                          onBlur={() => confirmarValidadeKit(kit.id, 'dataInicio')}
                          placeholder="DD/MM/AA"
                        />
                      </View>
                      <View style={styles.campoMetade}>
                        <Text style={styles.campoLabel}>Validade fim</Text>
                        <TextInput
                          style={styles.input}
                          value={valorExibidoKit(kit, 'validadeFim')}
                          onChangeText={(texto) => digitarKit(kit.id, 'validadeFim', texto)}
                          onBlur={() => confirmarValidadeKit(kit.id, 'dataFim')}
                          placeholder="DD/MM/AA"
                        />
                      </View>
                    </View>
                  </View>
                )}
              </Card>
            );
          })}
        </>
      )}

      <Card>
        <Text style={styles.cardTitulo}>Pronto para imprimir!</Text>
        <Text style={styles.resumoLinha}>
          {itens.length} produtos · {grupos.length} sessões{kits.length > 0 ? ` · ${kits.length} kit(s)` : ''} · {totalCartazes} cartazes
        </Text>

        {grupos.map((grupo) => (
          <View key={grupo.chave} style={styles.grupoLinha}>
            <Text style={styles.grupoNome} numberOfLines={1}>{grupo.nomeBase}</Text>
            <Text style={styles.grupoInfo}>
              {grupo.variantes.length > 0 ? `${grupo.variantes.length} variantes · ` : ''}{grupo.quantidadeCartazes} cartaz(es)
            </Text>
          </View>
        ))}

        <Text style={[styles.campoLabel, styles.grupoLabelEspacado]}>Cartazes por página</Text>
        <Text style={styles.grupoHint}>
          Grade numa folha A4. Menos por página = cartaz maior; mais por página = cartaz menor, útil pra imprimir
          bastante produto de uma vez.
        </Text>
        <View style={styles.grupoGrid}>
          {([3, 6, 9, 12] as const).map((opcao) => (
            <Pressable
              key={opcao}
              style={[styles.chip, cartazesPorPagina === opcao && styles.chipAtivo]}
              onPress={() => setCartazesPorPagina(opcao)}
            >
              <Text style={[styles.chipTexto, cartazesPorPagina === opcao && styles.chipTextoAtivo]}>{opcao}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.botaoSecundario} onPress={salvarNaCampanha} disabled={processando !== null}>
          {processando === 'campanha' ? (
            <ActivityIndicator color={colors.navy} />
          ) : (
            <>
              <Ionicons name="save-outline" size={18} color={colors.navy} />
              <Text style={styles.botaoSecundarioTexto}>Salvar alterações na campanha</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.aviso}>
          Preço, desconto, quantidade e validade editados acima ficam salvos na campanha (não só nessa impressão).
        </Text>

        <Pressable style={styles.botaoPrimario} onPress={imprimir} disabled={processando !== null}>
          {processando === 'pdf' ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Ionicons name="print-outline" size={18} color={colors.white} />
              <Text style={styles.botaoTexto}>Imprimir ({totalCartazes})</Text>
            </>
          )}
        </Pressable>

        <Pressable style={styles.botaoSecundario} onPress={exportarTxt} disabled={processando !== null}>
          {processando === 'txt' ? (
            <ActivityIndicator color={colors.navy} />
          ) : (
            <>
              <Ionicons name="document-text-outline" size={18} color={colors.navy} />
              <Text style={styles.botaoSecundarioTexto}>Exportar .txt para o Trier</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.aviso}>
          Layout do .txt inferido de um arquivo de exemplo — confirme com um import de teste antes de usar em produção.
        </Text>
      </Card>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 16, lineHeight: 18 },
  empty: { color: colors.textSecondary },
  voltar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  voltarTexto: { color: colors.navy, fontWeight: '600', fontSize: 14 },
  itemNome: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  campanhaInfo: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
  sectionTitulo: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 8 },
  itemHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemHeaderTexto: { flex: 1 },
  itemSubinfo: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  linhaQuantidade: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  itemLabel: { fontSize: 12, color: colors.textSecondary },
  inputQuantidade: {
    backgroundColor: colors.background,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 14,
    color: colors.textPrimary,
    width: 56,
    textAlign: 'center',
  },
  painelExpandido: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  campoLabel: { fontSize: 11, color: colors.textSecondary, marginBottom: 4, marginTop: 8 },
  campoSomenteLeitura: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  grupoLabelEspacado: { marginTop: 14 },
  grupoHint: { fontSize: 11, color: colors.textMuted, marginBottom: 8, lineHeight: 15 },
  avisoKit: { fontSize: 11, color: colors.red, marginTop: 6, lineHeight: 15 },
  previaTexto: { fontSize: 12, color: colors.navy, fontWeight: '600', marginTop: 10 },
  margemTexto: { fontSize: 11, color: colors.textMuted, marginTop: 4, lineHeight: 15 },
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
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 14,
    color: colors.textPrimary,
  },
  linhaDoisCampos: { flexDirection: 'row', gap: 10 },
  campoMetade: { flex: 1 },
  cardTitulo: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  resumoLinha: { fontSize: 12, color: colors.textSecondary, marginBottom: 10 },
  grupoLinha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 8,
  },
  grupoNome: { flex: 1, fontSize: 13, color: colors.textPrimary },
  grupoInfo: { fontSize: 12, color: colors.textMuted },
  botaoPrimario: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 13,
    marginTop: 14,
  },
  botaoTexto: { color: colors.white, fontWeight: '700', fontSize: 14 },
  botaoSecundario: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.white,
    borderRadius: 10,
    paddingVertical: 13,
    marginTop: 10,
    borderWidth: 1.5,
    borderColor: colors.navy,
  },
  botaoSecundarioTexto: { color: colors.navy, fontWeight: '700', fontSize: 14 },
  aviso: { fontSize: 11, color: colors.textMuted, marginTop: 10, lineHeight: 15 },
});
