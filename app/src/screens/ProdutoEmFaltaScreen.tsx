import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { colors } from '../theme/colors';
import { formatDateBR, todayISO } from '../lib/format';
import { alertar, confirmar } from '../lib/alert';
import { ProdutoCatalogo, ProdutoEmFalta } from '../types/domain';

export function ProdutoEmFaltaScreen() {
  const { profile } = useAuth();
  const scrollRef = useRef<ScrollView>(null);

  const [itens, setItens] = useState<ProdutoEmFalta[]>([]);
  const [loadingLista, setLoadingLista] = useState(true);
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[]>([]);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeProduto, setNomeProduto] = useState('');
  // Só preenchido quando o nome bate com algo já cadastrado — texto
  // livre continua válido sem isso (produto novo no mercado, por
  // exemplo, ainda não tem código nenhum).
  const [codigoVinculado, setCodigoVinculado] = useState<number | null>(null);
  const [data, setData] = useState(todayISO());
  const [temSaldoEstoque, setTemSaldoEstoque] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregarLista = useCallback(async () => {
    if (!profile) return;
    setLoadingLista(true);
    setItens(await repository.getProdutosEmFalta(profile));
    setLoadingLista(false);
  }, [profile]);

  useEffect(() => {
    carregarLista();
  }, [carregarLista]);

  useEffect(() => {
    (async () => {
      if (profile) setCatalogo(await repository.getCatalogoProdutos(profile));
    })();
  }, [profile]);

  // Sugestões só aparecem enquanto o nome ainda não está vinculado a
  // um produto do catálogo — assim que escolhe uma, a lista some;
  // editar o texto de novo desfaz o vínculo e traz as sugestões de
  // volta. Bate só quando alguma PALAVRA do nome começa com o termo
  // digitado (não "contém" em qualquer posição) — "dip" tinha que
  // achar "Dipirona", não "Adipept" (que só tem "dip" no meio).
  const termoBusca = nomeProduto.trim().toLowerCase();
  const resultadosBusca =
    codigoVinculado != null || termoBusca.length < 2
      ? []
      : catalogo
          .filter((p) => p.nome.toLowerCase().split(/\s+/).some((palavra) => palavra.startsWith(termoBusca)))
          .slice(0, 8);

  const escolherSugestao = (produto: ProdutoCatalogo) => {
    setNomeProduto(produto.nome);
    setCodigoVinculado(produto.codigo);
  };

  const alterarNome = (texto: string) => {
    setNomeProduto(texto);
    setCodigoVinculado(null);
  };

  const limparFormulario = () => {
    setEditandoId(null);
    setNomeProduto('');
    setCodigoVinculado(null);
    setData(todayISO());
    setTemSaldoEstoque(false);
  };

  const salvar = async () => {
    if (!profile) return;
    if (!nomeProduto.trim()) {
      alertar('Nome obrigatório', 'Informe o nome do produto que está em falta.');
      return;
    }
    if (!data.trim()) {
      alertar('Data obrigatória', 'Informe a data.');
      return;
    }

    setSalvando(true);
    try {
      await repository.salvarProdutoEmFalta(profile, {
        id: editandoId ?? undefined,
        nomeProduto: nomeProduto.trim(),
        codigoProduto: codigoVinculado,
        data,
        temSaldoEstoque,
      });
      limparFormulario();
      await carregarLista();
    } catch (erro) {
      alertar('Erro ao salvar', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const editar = (item: ProdutoEmFalta) => {
    setEditandoId(item.id);
    setNomeProduto(item.nomeProduto);
    setCodigoVinculado(item.codigoProduto);
    setData(item.data);
    setTemSaldoEstoque(item.temSaldoEstoque);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const excluir = (item: ProdutoEmFalta) => {
    confirmar(
      'Remover da lista',
      `Remover "${item.nomeProduto}" da lista de produtos em falta?`,
      async () => {
        try {
          await repository.excluirProdutoEmFalta(item.id);
          if (editandoId === item.id) limparFormulario();
          await carregarLista();
        } catch (erro) {
          alertar('Erro ao remover', erro instanceof Error ? erro.message : 'Tente novamente.');
        }
      },
      { textoConfirmar: 'Remover', destrutivo: true }
    );
  };

  const mesAtual = todayISO().slice(0, 7);
  const itensDoMes = itens.filter((i) => i.data.slice(0, 7) === mesAtual);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView ref={scrollRef} style={styles.container}>
      <Text style={styles.subtitle}>Reporte rápido de produto que faltou no balcão — lista compartilhada, qualquer um edita ou apaga.</Text>

      <Card>
        <Text style={styles.cardTitulo}>{editandoId ? 'Editar registro' : 'Novo registro'}</Text>
        <Text style={styles.rotulo}>Nome do produto</Text>
        <TextInput
          style={styles.input}
          placeholder="Digite o nome — não precisa estar no catálogo"
          value={nomeProduto}
          onChangeText={alterarNome}
        />
        {resultadosBusca.map((p) => (
          <Pressable key={p.codigo} style={styles.resultadoBusca} onPress={() => escolherSugestao(p)}>
            <Text style={styles.resultadoBuscaTexto} numberOfLines={1}>{p.nome}</Text>
            <Ionicons name="add-circle" size={20} color={colors.navy} />
          </Pressable>
        ))}

        <Text style={[styles.rotulo, styles.espacado]}>Data do dia</Text>
        <TextInput style={styles.input} value={data} onChangeText={setData} placeholder="AAAA-MM-DD" />

        <Pressable
          style={[styles.checkboxLinha, styles.espacado]}
          onPress={() => setTemSaldoEstoque((atual) => !atual)}
        >
          <Ionicons
            name={temSaldoEstoque ? 'checkbox' : 'square-outline'}
            size={20}
            color={temSaldoEstoque ? colors.navy : colors.textMuted}
          />
          <Text style={styles.checkboxTexto}>O produto tem saldo no estoque?</Text>
        </Pressable>

        <View style={styles.botoesLinha}>
          {editandoId && (
            <Pressable style={styles.botaoCancelar} onPress={limparFormulario}>
              <Text style={styles.botaoCancelarTexto}>Cancelar</Text>
            </Pressable>
          )}
          <Pressable style={styles.botaoSalvar} onPress={salvar} disabled={salvando}>
            {salvando ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.botaoTexto}>{editandoId ? 'Salvar alterações' : 'Registrar falta'}</Text>
            )}
          </Pressable>
        </View>
      </Card>

      <Text style={styles.sectionTitulo}>Este mês ({itensDoMes.length})</Text>
      {loadingLista ? (
        <ActivityIndicator style={{ marginTop: 12 }} />
      ) : itensDoMes.length === 0 ? (
        <Card>
          <Text style={styles.empty}>Nenhum produto em falta registrado esse mês.</Text>
        </Card>
      ) : (
        itensDoMes.map((item) => (
          <Card key={item.id}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemNome} numberOfLines={2}>{item.nomeProduto}</Text>
              <View style={styles.itemAcoes}>
                <Pressable onPress={() => editar(item)} hitSlop={8}>
                  <Ionicons name="pencil-outline" size={18} color={colors.navy} />
                </Pressable>
                <Pressable onPress={() => excluir(item)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={colors.red} />
                </Pressable>
              </View>
            </View>
            <Text style={styles.itemData}>
              {formatDateBR(item.data)}
              {profile?.role === 'gestor' && item.nomeRegistradoPor ? ` · ${item.nomeRegistradoPor}` : ''}
            </Text>
            <Text style={item.temSaldoEstoque ? styles.itemAviso : styles.itemAvisoOk}>
              {item.temSaldoEstoque ? 'Tem saldo no estoque (ruptura de gôndola)' : 'Sem saldo no estoque'}
            </Text>
          </Card>
        ))
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 16, lineHeight: 18, marginTop: 4 },
  empty: { color: colors.textSecondary },
  cardTitulo: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  rotulo: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  espacado: { marginTop: 10 },
  sectionTitulo: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 4, marginBottom: 8 },
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
  checkboxLinha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkboxTexto: { fontSize: 13, color: colors.textPrimary, flex: 1 },
  botoesLinha: { flexDirection: 'row', gap: 10, marginTop: 14 },
  botaoSalvar: { flex: 1, backgroundColor: colors.success, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  botaoCancelar: { flex: 1, backgroundColor: colors.background, borderRadius: 10, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  botaoTexto: { color: colors.white, fontWeight: '700', fontSize: 14 },
  botaoCancelarTexto: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8 },
  itemNome: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  itemAcoes: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  itemData: { fontSize: 12, color: colors.textMuted },
  itemAviso: { fontSize: 12, color: colors.red, fontWeight: '600', marginTop: 4 },
  itemAvisoOk: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
});
