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
import { useAuth } from '../context/AuthContext';
import { repository } from '../data';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { formatBRL } from '../lib/format';
import { alertar, confirmar } from '../lib/alert';
import { ClienteBusca, ClienteCarteira, DonoCarteira, VendedorAtivo } from '../types/domain';

function mensagemErro(erro: unknown): string {
  if (erro instanceof Error && erro.message) return erro.message;
  if (typeof erro === 'object' && erro !== null && 'message' in erro && (erro as { message?: unknown }).message) {
    return String((erro as { message: unknown }).message);
  }
  return 'Tente novamente.';
}

export function CarteiraClientesScreen() {
  const { profile } = useAuth();
  const ehGestor = profile?.role === 'gestor';

  const [vendedores, setVendedores] = useState<VendedorAtivo[]>([]);
  const [vendedorSelecionado, setVendedorSelecionado] = useState<number | null>(null);

  const [carteira, setCarteira] = useState<ClienteCarteira[]>([]);
  const [loading, setLoading] = useState(true);

  const [termoBusca, setTermoBusca] = useState('');
  const [resultados, setResultados] = useState<ClienteBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [adicionando, setAdicionando] = useState<number | null>(null);
  const [donosCarteira, setDonosCarteira] = useState<DonoCarteira[]>([]);

  useEffect(() => {
    if (!profile || !ehGestor) return;
    repository.getVendedoresAtivos(profile).then((lista) => {
      setVendedores(lista);
      setVendedorSelecionado((atual) => atual ?? lista[0]?.codigo ?? null);
    });
  }, [profile, ehGestor]);

  // Quem já é dono de cada cliente (QUALQUER vendedor, não só o
  // logado) — avisa na busca "já está na carteira de fulano" pra
  // evitar duplicidade entre carteiras (achado 21/08/2026).
  useEffect(() => {
    if (!profile) return;
    repository.getDonosCarteira(profile).then(setDonosCarteira);
  }, [profile]);

  const donoPorCliente = useMemo(
    () => new Map(donosCarteira.map((d) => [d.codigoCliente, d])),
    [donosCarteira]
  );

  const carregarCarteira = useCallback(async () => {
    if (!profile) return;
    if (ehGestor && vendedorSelecionado == null) return;
    setLoading(true);
    try {
      setCarteira(await repository.getCarteiraClientes(profile, ehGestor ? vendedorSelecionado ?? undefined : undefined));
    } catch (erro) {
      alertar('Erro ao carregar carteira', mensagemErro(erro));
    } finally {
      setLoading(false);
    }
  }, [profile, ehGestor, vendedorSelecionado]);

  useEffect(() => {
    carregarCarteira();
  }, [carregarCarteira]);

  // Busca com debounce — só dispara com 2+ caracteres, pra não bater
  // no banco a cada letra digitada.
  useEffect(() => {
    if (termoBusca.trim().length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    const timer = setTimeout(async () => {
      try {
        setResultados(await repository.buscarClientesParaCarteira(termoBusca));
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [termoBusca]);

  const codigoVendedorAlvo = ehGestor ? vendedorSelecionado : profile?.codigoVendedor ?? null;

  const adicionar = async (cliente: ClienteBusca) => {
    if (codigoVendedorAlvo == null || !profile) return;
    setAdicionando(cliente.codigo);
    try {
      await repository.adicionarClienteCarteira(profile, codigoVendedorAlvo, cliente.codigo);
    } catch (erro) {
      setAdicionando(null);
      alertar('Erro ao adicionar', mensagemErro(erro));
      return;
    }
    setTermoBusca('');
    setResultados([]);
    setAdicionando(null);
    await carregarCarteira();
    if (profile) repository.getDonosCarteira(profile).then(setDonosCarteira);
  };

  const remover = (item: ClienteCarteira) => {
    confirmar(
      'Remover da carteira',
      `Remover "${item.nome}" da carteira?`,
      async () => {
        try {
          await repository.removerClienteCarteira(item.id);
        } catch (erro) {
          alertar('Erro ao remover', mensagemErro(erro));
          return;
        }
        await carregarCarteira();
        if (profile) repository.getDonosCarteira(profile).then(setDonosCarteira);
      },
      { textoConfirmar: 'Remover', destrutivo: true }
    );
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container}>
      <Text style={styles.title}>👥 Carteira de clientes</Text>
      <Text style={styles.subtitle}>Clientes que você escolhe acompanhar de perto, independente de histórico de compra.</Text>

      {ehGestor && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {vendedores.map((v) => (
            <Pressable
              key={v.codigo}
              style={[styles.chip, vendedorSelecionado === v.codigo && styles.chipAtivo]}
              onPress={() => setVendedorSelecionado(v.codigo)}
            >
              <Text style={[styles.chipTexto, vendedorSelecionado === v.codigo && styles.chipTextoAtivo]}>{v.nome}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Card>
        <Text style={styles.cardTitulo}>Adicionar cliente</Text>
        <TextInput
          style={styles.input}
          value={termoBusca}
          onChangeText={setTermoBusca}
          placeholder="Busca por nome, código ou CPF"
        />
        {buscando && <ActivityIndicator style={{ marginTop: 10 }} />}
        {!buscando &&
          resultados.map((cliente) => {
            const dono = donoPorCliente.get(cliente.codigo);
            return (
            <View key={cliente.codigo} style={styles.resultadoRow}>
              <View style={styles.resultadoInfo}>
                <Text style={styles.resultadoNome} numberOfLines={1}>
                  {cliente.nome}
                </Text>
                <Text style={styles.resultadoCpf}>
                  Cód. {cliente.codigo}
                  {cliente.numeroCpfCnpj ? ` · ${cliente.numeroCpfCnpj}` : ''}
                </Text>
                {dono && (
                  <Text style={styles.resultadoAviso}>
                    {dono.codigoVendedor === codigoVendedorAlvo
                      ? 'Já está na sua carteira'
                      : `Já está na carteira de ${dono.nomeVendedor}`}
                  </Text>
                )}
              </View>
              <Pressable
                style={styles.botaoAdicionar}
                onPress={() => adicionar(cliente)}
                disabled={adicionando === cliente.codigo || codigoVendedorAlvo == null}
              >
                {adicionando === cliente.codigo ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Ionicons name="add" size={18} color={colors.white} />
                )}
              </Pressable>
            </View>
            );
          })}
        {!buscando && termoBusca.trim().length >= 2 && resultados.length === 0 && (
          <Text style={styles.hint}>Nenhum cliente encontrado.</Text>
        )}
      </Card>

      <Text style={styles.sectionTitulo}>Clientes na carteira ({carteira.length})</Text>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 12 }} />
      ) : carteira.length === 0 ? (
        <Card>
          <Text style={styles.empty}>Nenhum cliente na carteira ainda.</Text>
        </Card>
      ) : (
        carteira.map((item) => (
          <Card key={item.id}>
            <View style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemNome} numberOfLines={1}>
                  {item.nome}
                </Text>
                <Text style={styles.itemCodigo}>Cód. {item.codigoCliente}</Text>
                <Text style={styles.itemDetalhe}>
                  {formatBRL(item.valor6Meses)} (últ. 6 meses)
                  {item.compradoEsteMes ? ` · ${formatBRL(item.valorMesAtual)} este mês ✅` : ''}
                </Text>
              </View>
              <Pressable onPress={() => remover(item)} hitSlop={8}>
                <Ionicons name="trash-outline" size={20} color={colors.red} />
              </Pressable>
            </View>
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
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 14, lineHeight: 18 },
  chipRow: { gap: 8, paddingBottom: 12 },
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
  cardTitulo: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 14,
    color: colors.textPrimary,
  },
  resultadoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 10,
  },
  resultadoInfo: { flex: 1 },
  resultadoNome: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  resultadoCpf: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  resultadoAviso: { fontSize: 11, color: colors.red, marginTop: 2, fontWeight: '600' },
  botaoAdicionar: {
    backgroundColor: colors.navy,
    borderRadius: 8,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 10 },
  sectionTitulo: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 4, marginBottom: 8 },
  empty: { color: colors.textSecondary },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  itemInfo: { flex: 1 },
  itemNome: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  itemCodigo: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  itemDetalhe: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
});
