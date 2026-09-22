import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { escolherImagem, OrigemImagem } from '../lib/imagem';
import { repository } from '../data';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { formatDateBR, todayISO } from '../lib/format';
import { alertar, confirmar } from '../lib/alert';
import { ClienteInatividade, Pendencia } from '../types/domain';

export function PendenciasScreen() {
  const { profile } = useAuth();
  const [itens, setItens] = useState<Pendencia[]>([]);
  const [loadingLista, setLoadingLista] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clientes, setClientes] = useState<ClienteInatividade[]>([]);

  const [nomeCliente, setNomeCliente] = useState('');
  // Só enquanto o nome não bate com um cliente já escolhido da lista —
  // mesmo padrão de Produto em Falta (busca assistida, mas continua
  // aceitando texto livre pra cliente novo/não cadastrado).
  const [clienteVinculado, setClienteVinculado] = useState(false);
  const [produtos, setProdutos] = useState('');
  const [fotoUri, setFotoUri] = useState<string | null>(null);
  const [capturando, setCapturando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (profile) setClientes(await repository.getClientesInatividade(profile));
    })();
  }, [profile]);

  const carregarLista = useCallback(async () => {
    if (!profile) return;
    setLoadingLista(true);
    setItens(await repository.getPendencias(profile));
    setLoadingLista(false);
  }, [profile]);

  useEffect(() => {
    carregarLista();
  }, [carregarLista]);

  const onRefresh = async () => {
    setRefreshing(true);
    await carregarLista();
    setRefreshing(false);
  };

  // Mesmo critério de Produto em Falta: só casa início de palavra (evita
  // "ana" achando "Mariana" no meio do nome) — some assim que o cliente
  // é escolhido da lista, volta a aparecer se o texto for editado de novo.
  const termoBusca = nomeCliente.trim().toLowerCase();
  const resultadosBusca =
    clienteVinculado || termoBusca.length < 2
      ? []
      : clientes
          .filter((c) => c.nome.toLowerCase().split(/\s+/).some((palavra) => palavra.startsWith(termoBusca)))
          .slice(0, 8);

  const escolherCliente = (cliente: ClienteInatividade) => {
    setNomeCliente(cliente.nome);
    setClienteVinculado(true);
  };

  const alterarNomeCliente = (texto: string) => {
    setNomeCliente(texto);
    setClienteVinculado(false);
  };

  const escolherFoto = async (origem: OrigemImagem) => {
    const mensagemPermissao =
      origem === 'camera'
        ? 'Precisamos de acesso à câmera pra fotografar a pendência.'
        : 'Precisamos de acesso às fotos pra anexar a pendência.';

    setCapturando(true);
    try {
      const uri = await escolherImagem(origem, mensagemPermissao);
      if (uri) setFotoUri(uri);
    } finally {
      setCapturando(false);
    }
  };

  const limparFormulario = () => {
    setNomeCliente('');
    setClienteVinculado(false);
    setProdutos('');
    setFotoUri(null);
  };

  const registrar = async () => {
    if (!profile) return;
    if (!nomeCliente.trim()) {
      alertar('Cliente obrigatório', 'Informe o nome do cliente.');
      return;
    }
    if (!produtos.trim()) {
      alertar('Produtos obrigatórios', 'Informe o(s) produto(s) separado(s)/reservado(s).');
      return;
    }
    if (!fotoUri) {
      alertar('Foto obrigatória', 'Tire uma foto do comprovante/produto antes de registrar.');
      return;
    }

    setSalvando(true);
    try {
      await repository.salvarPendencia(profile, { nomeCliente: nomeCliente.trim(), produtos: produtos.trim(), fotoUri });
      limparFormulario();
      await carregarLista();
    } catch (erro) {
      alertar('Erro ao registrar', erro instanceof Error ? erro.message : 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const darBaixa = (item: Pendencia) => {
    confirmar(
      'Dar baixa',
      `Marcar a pendência de "${item.nomeCliente}" como resolvida? Ela sai da lista, mas o registro fica salvo.`,
      async () => {
        setBaixandoId(item.id);
        try {
          await repository.darBaixaPendencia(item.id);
          await carregarLista();
        } catch (erro) {
          alertar('Erro ao dar baixa', erro instanceof Error ? erro.message : 'Tente novamente.');
        } finally {
          setBaixandoId(null);
        }
      },
      { textoConfirmar: 'Dar baixa' }
    );
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.subtitle}>
        Produto separado/reservado pra um cliente buscar depois — lista compartilhada, qualquer um dá baixa.
      </Text>

      <Card>
        <Text style={styles.cardTitulo}>Nova pendência</Text>

        <Text style={styles.rotulo}>Foto</Text>
        {fotoUri ? (
          <Pressable onPress={() => setFotoAmpliada(fotoUri)} style={styles.fotoPreviewWrap}>
            <Image source={{ uri: fotoUri }} style={styles.fotoPreview} />
            <Pressable style={styles.fotoRemover} onPress={() => setFotoUri(null)} hitSlop={8}>
              <Ionicons name="close-circle" size={22} color={colors.red} />
            </Pressable>
          </Pressable>
        ) : (
          <View style={styles.fotoBotoesRow}>
            <Pressable
              style={[styles.cameraButton, styles.fotoBotaoMetade]}
              onPress={() => escolherFoto('camera')}
              disabled={capturando}
            >
              {capturando ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <>
                  <Text style={styles.cameraIcone}>📷</Text>
                  <Text style={styles.cameraTexto}>Tirar foto</Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={[styles.cameraButton, styles.fotoBotaoMetade, styles.anexarButton]}
              onPress={() => escolherFoto('galeria')}
              disabled={capturando}
            >
              <Text style={styles.cameraIcone}>📎</Text>
              <Text style={[styles.cameraTexto, styles.anexarTexto]}>Anexar</Text>
            </Pressable>
          </View>
        )}
        {Platform.OS === 'web' && (
          <Text style={styles.webHint}>No navegador, os botões abrem o seletor de arquivo/webcam.</Text>
        )}

        <Text style={[styles.rotulo, styles.espacado]}>Nome do cliente</Text>
        <TextInput
          style={styles.input}
          placeholder="Responsável"
          value={nomeCliente}
          onChangeText={alterarNomeCliente}
        />
        {resultadosBusca.map((c) => (
          <Pressable key={c.codigo} style={styles.resultadoBusca} onPress={() => escolherCliente(c)}>
            <Text style={styles.resultadoBuscaTexto} numberOfLines={1}>{c.nome}</Text>
            <Ionicons name="add-circle" size={20} color={colors.navy} />
          </Pressable>
        ))}

        <Text style={[styles.rotulo, styles.espacado]}>Produtos</Text>
        <TextInput
          style={[styles.input, styles.inputMultilinha]}
          placeholder="Um por linha, ou separados por vírgula"
          value={produtos}
          onChangeText={setProdutos}
          multiline
          numberOfLines={3}
        />

        <Text style={[styles.rotulo, styles.espacado]}>Data do dia</Text>
        <Text style={styles.dataAutomatica}>{formatDateBR(todayISO())}</Text>

        <Pressable style={styles.botaoSalvar} onPress={registrar} disabled={salvando}>
          {salvando ? <ActivityIndicator color={colors.white} /> : <Text style={styles.botaoTexto}>Registrar pendência</Text>}
        </Pressable>
      </Card>

      <Text style={styles.sectionTitulo}>Pendências ativas ({itens.length})</Text>
      {loadingLista ? (
        <ActivityIndicator style={{ marginTop: 12 }} />
      ) : itens.length === 0 ? (
        <Card>
          <Text style={styles.empty}>Nenhuma pendência em aberto.</Text>
        </Card>
      ) : (
        itens.map((item) => (
          <Card key={item.id}>
            <View style={styles.itemRow}>
              {item.fotoUrl ? (
                <Pressable onPress={() => setFotoAmpliada(item.fotoUrl)}>
                  <Image source={{ uri: item.fotoUrl }} style={styles.itemThumb} />
                </Pressable>
              ) : (
                <View style={styles.itemThumbVazio}>
                  <Text style={styles.itemThumbIcone}>📦</Text>
                </View>
              )}
              <View style={styles.itemInfo}>
                <Text style={styles.itemCliente} numberOfLines={1}>{item.nomeCliente}</Text>
                <Text style={styles.itemProdutos} numberOfLines={3}>{item.produtos}</Text>
                <Text style={styles.itemData}>
                  {formatDateBR(item.data)}
                  {item.nomeRegistradoPor ? ` · ${item.nomeRegistradoPor}` : ''}
                </Text>
              </View>
            </View>
            <Pressable
              style={styles.botaoBaixa}
              onPress={() => darBaixa(item)}
              disabled={baixandoId === item.id}
            >
              {baixandoId === item.id ? (
                <ActivityIndicator color={colors.navy} size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color={colors.navy} />
                  <Text style={styles.botaoBaixaTexto}>Dar baixa</Text>
                </>
              )}
            </Pressable>
          </Card>
        ))
      )}

      <Modal visible={fotoAmpliada != null} transparent animationType="fade" onRequestClose={() => setFotoAmpliada(null)}>
        <Pressable style={styles.modalFundo} onPress={() => setFotoAmpliada(null)}>
          {fotoAmpliada ? <Image source={{ uri: fotoAmpliada }} style={styles.modalFoto} resizeMode="contain" /> : null}
          <Pressable style={styles.modalFechar} onPress={() => setFotoAmpliada(null)} hitSlop={8}>
            <Ionicons name="close" size={28} color={colors.white} />
          </Pressable>
        </Pressable>
      </Modal>
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
  inputMultilinha: { minHeight: 70, textAlignVertical: 'top' },
  dataAutomatica: {
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 14,
    color: colors.textMuted,
  },
  fotoBotoesRow: { flexDirection: 'row', gap: 10 },
  fotoBotaoMetade: { flex: 1 },
  cameraButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 11,
    gap: 8,
  },
  anexarButton: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.navy },
  anexarTexto: { color: colors.navy },
  cameraIcone: { fontSize: 16 },
  cameraTexto: { color: colors.white, fontWeight: '600', fontSize: 14 },
  webHint: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  fotoPreviewWrap: { alignSelf: 'flex-start' },
  fotoPreview: { width: 90, height: 90, borderRadius: 10 },
  fotoRemover: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: colors.white,
    borderRadius: 12,
  },
  botaoSalvar: {
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  botaoTexto: { color: colors.white, fontWeight: '700', fontSize: 14 },
  itemRow: { flexDirection: 'row', gap: 12 },
  itemThumb: { width: 56, height: 56, borderRadius: 8 },
  itemThumbVazio: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemThumbIcone: { fontSize: 24 },
  itemInfo: { flex: 1 },
  itemCliente: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  itemProdutos: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  itemData: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  botaoBaixa: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.navy,
    paddingVertical: 9,
    marginTop: 12,
  },
  botaoBaixaTexto: { color: colors.navy, fontWeight: '700', fontSize: 13 },
  modalFundo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  modalFoto: { width: '100%', height: '80%' },
  modalFechar: { position: 'absolute', top: 48, right: 20, padding: 8 },
});
