import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { repository } from '../data';
import { ClienteInatividade, ContatoCliente, HistoricoCompraCliente, ProdutoRecorrenteCliente } from '../types/domain';
import { WhatsAppButton } from '../components/WhatsAppButton';
import { PhoneCallButton } from '../components/PhoneCallButton';
import { LoadingFarmacia } from '../components/LoadingFarmacia';
import { colors } from '../theme/colors';
import { formatDateBR, nomeCurto } from '../lib/format';
import { GRUPOS_FILTRO } from '../lib/gruposClientes';
import { foiContatadoRecentemente } from '../lib/contatos';

// Últimas 7 (não 5 como em "Meus clientes" — pedido específico desta
// tela, pra dar mais contexto de quem atendeu antes de decidir o
// contato de resgate).
const LIMITE_HISTORICO = 7;

function mensagemReativacao(cliente: ClienteInatividade): string {
  const ultima = cliente.ultimaCompra ? formatDateBR(cliente.ultimaCompra) : null;
  const referenciaUltimaCompra = ultima
    ? `sua última compra na Farmácia Conviva Parquelândia foi em ${ultima}`
    : 'ainda não vimos você por aqui';
  return `Olá, ${nomeCurto(cliente.nome)}! Aqui é da Farmácia Conviva Parquelândia 💊 Notamos que ${referenciaUltimaCompra} e sentimos sua falta. Temos novidades e condições especiais pra você — podemos ajudar em algo?`;
}

export function ClientesScreen() {
  const { profile } = useAuth();
  const [clientes, setClientes] = useState<ClienteInatividade[]>([]);
  const [produtos, setProdutos] = useState<ProdutoRecorrenteCliente[]>([]);
  const [contatos, setContatos] = useState<ContatoCliente[]>([]);
  const [busca, setBusca] = useState('');
  const [filtroNomeProduto, setFiltroNomeProduto] = useState('');
  const [grupoSelecionado, setGrupoSelecionado] = useState<string | null>(null);
  const [menuGrupoAberto, setMenuGrupoAberto] = useState(false);
  const [apenasRecompra, setApenasRecompra] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [historico, setHistorico] = useState<HistoricoCompraCliente[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const [c, p, ct] = await Promise.all([
      repository.getClientesInatividade(profile),
      repository.getProdutosRecorrentesClientes(profile),
      repository.getContatosRecentes(profile),
    ]);
    setClientes(c);
    setProdutos(p);
    setContatos(ct);
  }, [profile]);

  // Registra a tentativa de contato e já tira o cliente da lista na
  // hora (otimista) — não precisa esperar o próximo reload pra sumir.
  const registrarContatoResgate = (codigoCliente: number, tipoContato: 'whatsapp' | 'ligacao') => {
    if (!profile) return;
    const novo: ContatoCliente = { codigoCliente, motivo: 'resgate', codigoProduto: null, contatadoEm: new Date().toISOString() };
    setContatos((atual) => [...atual, novo]);
    repository
      .registrarContato(profile, { codigoCliente, motivo: 'resgate', tipoContato, codigoVendedor: profile.codigoVendedor })
      .catch(() => {
        // se falhar em salvar, desfaz o otimismo — melhor o cliente
        // reaparecer do que sumir da lista sem o contato ter sido
        // registrado de verdade.
        setContatos((atual) => atual.filter((c) => c !== novo));
      });
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Mesmo padrão de "Meus clientes" (ClientesVendedorScreen): clicar no
  // cliente expande as últimas compras (produto + data), só que aqui
  // com limite de 7 em vez de 5.
  const alternarExpandido = async (codigo: number) => {
    if (expandido === codigo) {
      setExpandido(null);
      return;
    }
    setExpandido(codigo);
    setHistorico([]);
    if (!profile) return;
    setCarregandoHistorico(true);
    try {
      setHistorico(await repository.getHistoricoComprasCliente(profile, codigo, LIMITE_HISTORICO));
    } finally {
      setCarregandoHistorico(false);
    }
  };

  const grupoAtivo = GRUPOS_FILTRO.find((g) => g.chave === grupoSelecionado) ?? null;

  // Mesma lógica de ClientesVendedorScreen — produtos agrupados por
  // cliente, já filtrados por nome de produto e/ou grupo (quando
  // ativos), usada tanto pra decidir quem aparece na lista quanto pra
  // mostrar o "motivo" de uso contínuo embaixo do card.
  const produtosPorCliente = useMemo(() => {
    const nomeNormalizado = filtroNomeProduto.trim().toLowerCase();
    const mapa = new Map<number, ProdutoRecorrenteCliente[]>();
    for (const p of produtos) {
      if (apenasRecompra && !p.atrasado) continue;
      if (nomeNormalizado && !p.nomeProduto.toLowerCase().includes(nomeNormalizado)) continue;
      if (grupoAtivo && !grupoAtivo.bate(p.grupo)) continue;
      const lista = mapa.get(p.codigoCliente) ?? [];
      lista.push(p);
      mapa.set(p.codigoCliente, lista);
    }
    for (const lista of mapa.values()) {
      lista.sort((a, b) => b.diasDesdeUltimaCompra - a.diasDesdeUltimaCompra);
    }
    return mapa;
  }, [produtos, filtroNomeProduto, grupoAtivo, apenasRecompra]);

  if (loading) {
    return (
      <View style={styles.center}>
        <LoadingFarmacia />
      </View>
    );
  }

  const inativos = clientes.filter((c) => c.inativo).length;
  const buscaNormalizada = busca.trim().toLowerCase();
  const filtroProdutoAtivo = filtroNomeProduto.trim().length > 0 || grupoAtivo != null || apenasRecompra;
  const clientesFiltrados = clientes
    .filter((c) => {
      if (foiContatadoRecentemente(contatos, c.codigo, 'resgate')) return false;
      if (buscaNormalizada && !c.nome.toLowerCase().includes(buscaNormalizada)) return false;
      if (filtroProdutoAtivo && !produtosPorCliente.has(c.codigo)) return false;
      return true;
    })
    .sort((a, b) => (b.diasSemComprar ?? -1) - (a.diasSemComprar ?? -1));

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View style={styles.container}>
      <Text style={styles.title}>Clientes em potencial</Text>
      <Text style={styles.subtitle}>
        {clientes.length} clientes · {inativos} inativos (sem compra há mais de 60 dias)
      </Text>

      <View style={styles.buscaWrap}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.buscaInput}
          placeholder="Buscar cliente pelo nome"
          placeholderTextColor={colors.textMuted}
          value={busca}
          onChangeText={setBusca}
          autoCapitalize="none"
        />
        {busca.length > 0 && (
          <Pressable onPress={() => setBusca('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <View style={styles.buscaWrap}>
        <Ionicons name="pricetag-outline" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.buscaInput}
          placeholder="Buscar pelo nome do produto"
          placeholderTextColor={colors.textMuted}
          value={filtroNomeProduto}
          onChangeText={setFiltroNomeProduto}
          autoCapitalize="none"
        />
        {filtroNomeProduto.length > 0 && (
          <Pressable onPress={() => setFiltroNomeProduto('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <View style={styles.filtrosRow}>
        <Pressable
          style={[styles.chip, grupoAtivo && styles.chipAtivo]}
          onPress={() => setMenuGrupoAberto(true)}
        >
          <Ionicons name="albums-outline" size={14} color={grupoAtivo ? colors.white : colors.navy} />
          <Text style={[styles.chipTexto, grupoAtivo && styles.chipTextoAtivo]}>
            {grupoAtivo ? grupoAtivo.label : 'Grupo'}
          </Text>
          <Ionicons name="chevron-down" size={14} color={grupoAtivo ? colors.white : colors.navy} />
        </Pressable>

        <Pressable
          style={[styles.chip, apenasRecompra && styles.chipAtivo]}
          onPress={() => setApenasRecompra((v) => !v)}
        >
          <Ionicons name="refresh" size={14} color={apenasRecompra ? colors.white : colors.navy} />
          <Text style={[styles.chipTexto, apenasRecompra && styles.chipTextoAtivo]}>Uso contínuo</Text>
        </Pressable>
      </View>

      <Modal visible={menuGrupoAberto} transparent animationType="fade" onRequestClose={() => setMenuGrupoAberto(false)}>
        <Pressable style={styles.menuFundo} onPress={() => setMenuGrupoAberto(false)}>
          <View style={styles.menuFlutuante}>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setGrupoSelecionado(null);
                setMenuGrupoAberto(false);
              }}
            >
              <Text style={[styles.menuItemTexto, !grupoSelecionado && styles.menuItemTextoAtivo]}>Todos os grupos</Text>
              {!grupoSelecionado && <Ionicons name="checkmark" size={16} color={colors.navy} />}
            </Pressable>
            {GRUPOS_FILTRO.map((g) => (
              <Pressable
                key={g.chave}
                style={styles.menuItem}
                onPress={() => {
                  setGrupoSelecionado((atual) => (atual === g.chave ? null : g.chave));
                  setMenuGrupoAberto(false);
                }}
              >
                <Text style={[styles.menuItemTexto, grupoSelecionado === g.chave && styles.menuItemTextoAtivo]}>
                  {g.label}
                </Text>
                {grupoSelecionado === g.chave && <Ionicons name="checkmark" size={16} color={colors.navy} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <FlatList
        data={clientesFiltrados}
        keyExtractor={(item) => String(item.codigo)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {buscaNormalizada || filtroProdutoAtivo
              ? 'Nenhum cliente encontrado com esse filtro.'
              : 'Nenhum cliente em potencial no momento.'}
          </Text>
        }
        renderItem={({ item }) => {
          const aberto = expandido === item.codigo;
          const produtosDoCliente = produtosPorCliente.get(item.codigo);
          return (
            <View style={styles.card}>
              <Pressable style={styles.row} onPress={() => alternarExpandido(item.codigo)}>
                <View style={styles.info}>
                  <Text style={styles.nome}>{item.nome}</Text>
                  {item.nomeVendedor ? <Text style={styles.detalhe}>{item.nomeVendedor}</Text> : null}
                  <Text style={styles.detalhe}>
                    {item.ultimaCompra ? `Última compra: ${formatDateBR(item.ultimaCompra)}` : 'Sem histórico de compra'}
                  </Text>
                  {item.diasSemComprar != null && (
                    <Text style={styles.detalhe}>{item.diasSemComprar} dia(s) sem comprar</Text>
                  )}
                  <View style={[styles.badge, item.inativo ? styles.badgeInativo : styles.badgeAtivo]}>
                    <Text style={[styles.badgeText, item.inativo ? styles.badgeTextInativo : styles.badgeTextAtivo]}>
                      {item.inativo ? 'Inativo' : 'Ativo'}
                    </Text>
                  </View>
                  {filtroProdutoAtivo && produtosDoCliente
                    ? produtosDoCliente
                        .filter((p) => p.recorrente)
                        .slice(0, 2)
                        .map((p) => (
                          <Text key={p.codigoProduto} style={styles.usoContinuoLinha}>
                            🔁{' '}
                            <Text style={[styles.usoContinuoNome, p.atrasado && styles.usoContinuoNomeAtrasado]}>
                              {p.nomeProduto}
                            </Text>
                            {' '}· a cada ~{Math.round(p.intervaloMedioDias ?? 0)}d, já são {p.diasDesdeUltimaCompra}d
                          </Text>
                        ))
                    : null}
                </View>
                <View style={styles.acoes}>
                  {item.telefone ? (
                    <>
                      <PhoneCallButton
                        compact
                        telefone={item.telefone}
                        onLigar={() => registrarContatoResgate(item.codigo, 'ligacao')}
                      />
                      <WhatsAppButton
                        compact
                        telefone={item.telefone}
                        codigoCliente={item.codigo}
                        mensagem={mensagemReativacao(item)}
                        onEnviado={() => registrarContatoResgate(item.codigo, 'whatsapp')}
                      />
                    </>
                  ) : null}
                  <Ionicons name={aberto ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                </View>
              </Pressable>

              {aberto && (
                <View style={styles.painel}>
                  <Text style={styles.historicoTitulo}>Últimas compras</Text>
                  {carregandoHistorico ? (
                    <ActivityIndicator style={{ marginTop: 8 }} />
                  ) : historico.length === 0 ? (
                    <Text style={styles.detalhe}>Sem histórico de compra encontrado.</Text>
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
        }}
      />
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 12 },
  buscaWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
    gap: 8,
  },
  buscaInput: { flex: 1, fontSize: 14, color: colors.textPrimary },
  filtrosRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 6,
  },
  chipAtivo: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipTexto: { fontSize: 12, fontWeight: '600', color: colors.navy },
  chipTextoAtivo: { color: colors.white },
  menuFundo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'flex-start', alignItems: 'flex-start' },
  menuFlutuante: {
    marginTop: 190,
    marginLeft: 16,
    backgroundColor: colors.white,
    borderRadius: 10,
    paddingVertical: 6,
    minWidth: 220,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  menuItemTexto: { fontSize: 14, color: colors.textPrimary },
  menuItemTextoAtivo: { color: colors.navy, fontWeight: '700' },
  list: { paddingBottom: 24 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 24 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  info: { flexShrink: 1, flex: 1 },
  nome: { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
  detalhe: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, marginTop: 6 },
  badgeAtivo: { backgroundColor: '#dcfce7' },
  badgeInativo: { backgroundColor: '#fee2e2' },
  badgeText: { fontSize: 11, fontWeight: '600' },
  badgeTextAtivo: { color: colors.success },
  badgeTextInativo: { color: colors.red },
  usoContinuoLinha: { fontSize: 11, color: colors.textSecondary, marginTop: 3 },
  usoContinuoNome: { fontWeight: '700', color: '#9333ea' },
  usoContinuoNomeAtrasado: { color: colors.red },
  acoes: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  painel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: 14,
    gap: 4,
  },
  historicoTitulo: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 4 },
  historicoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 8,
  },
  historicoProduto: { fontSize: 12, color: colors.textPrimary, flex: 1 },
  historicoData: { fontSize: 12, color: colors.textSecondary },
});
