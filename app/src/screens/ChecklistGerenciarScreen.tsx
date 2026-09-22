import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { repository } from '../data';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { alertar, confirmar } from '../lib/alert';
import { AtividadeChecklist, VendedorAtivo } from '../types/domain';

// domingo=1 ... sábado=7 — mesma numeração usada em diasSemana (ver
// schema.sql) e no expo-notifications.
const DIAS_SEMANA: { valor: number; rotulo: string }[] = [
  { valor: 1, rotulo: 'Dom' },
  { valor: 2, rotulo: 'Seg' },
  { valor: 3, rotulo: 'Ter' },
  { valor: 4, rotulo: 'Qua' },
  { valor: 5, rotulo: 'Qui' },
  { valor: 6, rotulo: 'Sex' },
  { valor: 7, rotulo: 'Sáb' },
];
const DIAS_SEGUNDA_A_SABADO = [2, 3, 4, 5, 6, 7];
// Só dentro do horário de funcionamento da farmácia — 08:00 a 20:00.
const HORAS = Array.from({ length: 13 }, (_, h) => h + 8);

// Atividades padrão — atalho pra preencher o título sem digitar do
// zero. Não impede atividade avulsa: o campo de título continua livre,
// isso só sugere um ponto de partida.
const ATIVIDADES_PADRAO = [
  'Varrer o chão',
  'Fazer contato com clientes que não compram',
  'Fazer contato com clientes que compraram antibióticos',
  'Fazer contato com clientes que compraram medicamentos contínuos',
  'Conferir a sua prateleira',
];

function rotulosDias(dias: number[]): string {
  if (dias.length === 7) return 'Todo dia';
  return DIAS_SEMANA.filter((d) => dias.includes(d.valor))
    .map((d) => d.rotulo)
    .join(', ');
}

interface EdicaoAtividade {
  id: string;
  titulo: string;
  codigosVendedor: number[];
  diasSemana: number[];
  hora: number | null;
}

interface SeletorHora {
  valor: number | null;
  aoSelecionar: (hora: number | null) => void;
}

export function ChecklistGerenciarScreen() {
  const { profile } = useAuth();
  const [atividades, setAtividades] = useState<AtividadeChecklist[]>([]);
  const [loadingAtividades, setLoadingAtividades] = useState(true);
  const [vendedores, setVendedores] = useState<VendedorAtivo[]>([]);

  const [novaAtividade, setNovaAtividade] = useState('');
  const [codigosVendedorNovo, setCodigosVendedorNovo] = useState<number[]>([]);
  const [diasSemanaNovo, setDiasSemanaNovo] = useState<number[]>(DIAS_SEGUNDA_A_SABADO);
  const [horaNovo, setHoraNovo] = useState<number | null>(null);

  // Modal de horário é compartilhado entre o form "Nova atividade" e o
  // modal de edição — abrirSeletorHora recebe onde ler/gravar o valor
  // pra não duplicar a lista de horas em dois lugares.
  const [seletorHora, setSeletorHora] = useState<SeletorHora | null>(null);
  const abrirSeletorHora = (valor: number | null, aoSelecionar: (hora: number | null) => void) =>
    setSeletorHora({ valor, aoSelecionar });

  const [edicao, setEdicao] = useState<EdicaoAtividade | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const carregarAtividades = useCallback(async () => {
    if (!profile) return;
    setLoadingAtividades(true);
    setAtividades(await repository.getAtividadesChecklist(profile));
    setLoadingAtividades(false);
  }, [profile]);

  useEffect(() => {
    carregarAtividades();
  }, [carregarAtividades]);

  useEffect(() => {
    if (!profile) return;
    repository.getVendedoresAtivos(profile).then(setVendedores);
  }, [profile]);

  const alternarDiaSemana = (valor: number) => {
    setDiasSemanaNovo((atual) =>
      atual.includes(valor) ? atual.filter((d) => d !== valor) : [...atual, valor].sort((a, b) => a - b)
    );
  };

  // Mesmo padrão de toggle dos dias da semana: toque seleciona, toque
  // de novo tira a seleção — dá pra marcar 2+ vendedores de uma vez.
  const alternarVendedorNovo = (codigo: number) => {
    setCodigosVendedorNovo((atual) => (atual.includes(codigo) ? atual.filter((c) => c !== codigo) : [...atual, codigo]));
  };

  const adicionarAtividade = async () => {
    const titulo = novaAtividade.trim();
    if (!titulo || !profile) return;

    if (diasSemanaNovo.length === 0) {
      alertar('Selecione os dias', 'Escolha pelo menos um dia da semana.');
      return;
    }

    const horario = horaNovo != null ? `${String(horaNovo).padStart(2, '0')}:00` : null;

    await repository.salvarAtividadeChecklist(profile, {
      titulo,
      horario,
      codigosVendedor: codigosVendedorNovo,
      diasSemana: diasSemanaNovo,
    });
    setNovaAtividade('');
    setCodigosVendedorNovo([]);
    setDiasSemanaNovo(DIAS_SEGUNDA_A_SABADO);
    setHoraNovo(null);
    await carregarAtividades();
  };

  const alternarAtividade = async (atividade: AtividadeChecklist) => {
    await repository.alternarAtividadeChecklist(atividade.id, !atividade.ativo);
    await carregarAtividades();
  };

  const abrirEdicao = (atividade: AtividadeChecklist) => {
    setEdicao({
      id: atividade.id,
      titulo: atividade.titulo,
      codigosVendedor: atividade.codigosVendedor,
      diasSemana: atividade.diasSemana,
      hora: atividade.horario ? Number(atividade.horario.slice(0, 2)) : null,
    });
  };

  const alternarDiaSemanaEdicao = (valor: number) => {
    setEdicao((atual) =>
      atual && {
        ...atual,
        diasSemana: atual.diasSemana.includes(valor)
          ? atual.diasSemana.filter((d) => d !== valor)
          : [...atual.diasSemana, valor].sort((a, b) => a - b),
      }
    );
  };

  const alternarVendedorEdicao = (codigo: number) => {
    setEdicao(
      (atual) =>
        atual && {
          ...atual,
          codigosVendedor: atual.codigosVendedor.includes(codigo)
            ? atual.codigosVendedor.filter((c) => c !== codigo)
            : [...atual.codigosVendedor, codigo],
        }
    );
  };

  const salvarEdicao = async () => {
    if (!edicao || !profile) return;
    const titulo = edicao.titulo.trim();
    if (!titulo) {
      alertar('Título obrigatório', 'Digite o título da atividade.');
      return;
    }
    if (edicao.diasSemana.length === 0) {
      alertar('Selecione os dias', 'Escolha pelo menos um dia da semana.');
      return;
    }

    setSalvandoEdicao(true);
    try {
      await repository.salvarAtividadeChecklist(profile, {
        id: edicao.id,
        titulo,
        horario: edicao.hora != null ? `${String(edicao.hora).padStart(2, '0')}:00` : null,
        codigosVendedor: edicao.codigosVendedor,
        diasSemana: edicao.diasSemana,
      });
      setEdicao(null);
      await carregarAtividades();
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const excluirEdicao = () => {
    if (!edicao) return;
    confirmar(
      'Excluir atividade',
      `Excluir "${edicao.titulo}" definitivamente? Isso também apaga o histórico de conclusão dela.`,
      async () => {
        await repository.excluirAtividadeChecklist(edicao.id);
        setEdicao(null);
        await carregarAtividades();
      },
      { textoConfirmar: 'Excluir', destrutivo: true }
    );
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container}>
      <Card>
        <Text style={styles.cardTitulo}>Nova atividade</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {ATIVIDADES_PADRAO.map((padrao) => (
            <Pressable
              key={padrao}
              style={[styles.chip, novaAtividade === padrao && styles.chipAtivo]}
              onPress={() => setNovaAtividade(padrao)}
            >
              <Text style={[styles.chipTexto, novaAtividade === padrao && styles.chipTextoAtivo]}>{padrao}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <TextInput
          style={styles.input}
          value={novaAtividade}
          onChangeText={setNovaAtividade}
          placeholder="Ou digite uma atividade avulsa"
        />

        <Text style={[styles.cardTitulo, styles.cardTituloEspacado]}>Vendedor</Text>
        <Text style={styles.vendedorHint}>
          Toque pra selecionar, toque de novo pra tirar — dá pra marcar mais de um. Nenhum selecionado = todos.
        </Text>
        <View style={styles.vendedorGrid}>
          <Pressable
            style={[styles.chip, codigosVendedorNovo.length === 0 && styles.chipAtivo]}
            onPress={() => setCodigosVendedorNovo([])}
          >
            <Text style={[styles.chipTexto, codigosVendedorNovo.length === 0 && styles.chipTextoAtivo]}>Todos</Text>
          </Pressable>
          {vendedores.map((v) => (
            <Pressable
              key={v.codigo}
              style={[styles.chip, codigosVendedorNovo.includes(v.codigo) && styles.chipAtivo]}
              onPress={() => alternarVendedorNovo(v.codigo)}
            >
              <Text style={[styles.chipTexto, codigosVendedorNovo.includes(v.codigo) && styles.chipTextoAtivo]}>
                {v.nome}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.cardTitulo, styles.cardTituloEspacado]}>Dias da semana</Text>
        <View style={styles.diasRow}>
          {DIAS_SEMANA.map((d) => (
            <Pressable
              key={d.valor}
              style={[styles.diaChip, diasSemanaNovo.includes(d.valor) && styles.chipAtivo]}
              onPress={() => alternarDiaSemana(d.valor)}
            >
              <Text style={[styles.chipTexto, diasSemanaNovo.includes(d.valor) && styles.chipTextoAtivo]}>
                {d.rotulo}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.cardTitulo, styles.cardTituloEspacado]}>Horário do lembrete</Text>
        <Pressable style={styles.horaBotao} onPress={() => abrirSeletorHora(horaNovo, setHoraNovo)}>
          <Ionicons name="time-outline" size={16} color={colors.navy} />
          <Text style={styles.horaBotaoTexto}>
            {horaNovo != null ? `${String(horaNovo).padStart(2, '0')}:00` : 'Sem lembrete'}
          </Text>
        </Pressable>

        <Pressable style={styles.addButton} onPress={adicionarAtividade}>
          <Text style={styles.addButtonTexto}>Adicionar atividade</Text>
        </Pressable>
      </Card>

      <Text style={styles.sectionTitulo}>Atividades cadastradas</Text>
      {loadingAtividades ? (
        <ActivityIndicator style={{ marginTop: 12 }} />
      ) : (
        atividades.map((atividade) => (
          <Card key={atividade.id}>
            <View style={styles.atividadeRow}>
              <Pressable style={styles.atividadeInfo} onPress={() => abrirEdicao(atividade)}>
                <Text
                  style={[styles.atividadeTexto, !atividade.ativo && styles.atividadeTextoInativo]}
                  numberOfLines={2}
                >
                  {atividade.titulo}
                </Text>
                <Text style={styles.atividadeDetalhe}>
                  👤 {atividade.nomesVendedores.length > 0 ? atividade.nomesVendedores.join(', ') : 'Todos'} · 📅{' '}
                  {rotulosDias(atividade.diasSemana)}
                  {atividade.horario ? ` · 🔔 ${atividade.horario.slice(0, 5)}` : ''}
                </Text>
              </Pressable>
              <Switch
                value={atividade.ativo}
                onValueChange={() => alternarAtividade(atividade)}
                trackColor={{ true: colors.navy, false: colors.border }}
              />
            </View>
          </Card>
        ))
      )}
      <Text style={styles.hint}>
        Toca numa atividade pra editar ou excluir. O switch ativa/inativa sem apagar o histórico já registrado.
      </Text>

      <Modal visible={seletorHora !== null} transparent animationType="fade" onRequestClose={() => setSeletorHora(null)}>
        <Pressable style={styles.modalFundo} onPress={() => setSeletorHora(null)}>
          <Pressable style={styles.modalConteudo} onPress={() => {}}>
            <Text style={styles.modalTitulo}>Horário do lembrete</Text>
            <ScrollView style={styles.modalLista}>
              <Pressable
                style={[styles.modalItem, seletorHora?.valor === null && styles.modalItemAtivo]}
                onPress={() => {
                  seletorHora?.aoSelecionar(null);
                  setSeletorHora(null);
                }}
              >
                <Text style={[styles.modalItemTexto, seletorHora?.valor === null && styles.modalItemTextoAtivo]}>
                  Sem lembrete
                </Text>
              </Pressable>
              {HORAS.map((h) => (
                <Pressable
                  key={h}
                  style={[styles.modalItem, seletorHora?.valor === h && styles.modalItemAtivo]}
                  onPress={() => {
                    seletorHora?.aoSelecionar(h);
                    setSeletorHora(null);
                  }}
                >
                  <Text style={[styles.modalItemTexto, seletorHora?.valor === h && styles.modalItemTextoAtivo]}>
                    {String(h).padStart(2, '0')}:00
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={edicao !== null} transparent animationType="fade" onRequestClose={() => setEdicao(null)}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.modalFundo} onPress={() => setEdicao(null)}>
          <Pressable style={styles.modalConteudo} onPress={() => {}}>
            {edicao && (
              <ScrollView>
                <Text style={styles.modalTitulo}>Editar atividade</Text>
                <TextInput
                  style={styles.input}
                  value={edicao.titulo}
                  onChangeText={(texto) => setEdicao((atual) => atual && { ...atual, titulo: texto })}
                />

                <Text style={[styles.cardTitulo, styles.cardTituloEspacado]}>Vendedor</Text>
                <Text style={styles.vendedorHint}>
                  Toque pra selecionar, toque de novo pra tirar — dá pra marcar mais de um. Nenhum selecionado = todos.
                </Text>
                <View style={styles.vendedorGrid}>
                  <Pressable
                    style={[styles.chip, edicao.codigosVendedor.length === 0 && styles.chipAtivo]}
                    onPress={() => setEdicao((atual) => atual && { ...atual, codigosVendedor: [] })}
                  >
                    <Text style={[styles.chipTexto, edicao.codigosVendedor.length === 0 && styles.chipTextoAtivo]}>
                      Todos
                    </Text>
                  </Pressable>
                  {vendedores.map((v) => (
                    <Pressable
                      key={v.codigo}
                      style={[styles.chip, edicao.codigosVendedor.includes(v.codigo) && styles.chipAtivo]}
                      onPress={() => alternarVendedorEdicao(v.codigo)}
                    >
                      <Text
                        style={[styles.chipTexto, edicao.codigosVendedor.includes(v.codigo) && styles.chipTextoAtivo]}
                      >
                        {v.nome}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.cardTitulo, styles.cardTituloEspacado]}>Dias da semana</Text>
                <View style={styles.diasRow}>
                  {DIAS_SEMANA.map((d) => (
                    <Pressable
                      key={d.valor}
                      style={[styles.diaChip, edicao.diasSemana.includes(d.valor) && styles.chipAtivo]}
                      onPress={() => alternarDiaSemanaEdicao(d.valor)}
                    >
                      <Text
                        style={[styles.chipTexto, edicao.diasSemana.includes(d.valor) && styles.chipTextoAtivo]}
                      >
                        {d.rotulo}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.cardTitulo, styles.cardTituloEspacado]}>Horário do lembrete</Text>
                <Pressable
                  style={styles.horaBotao}
                  onPress={() =>
                    abrirSeletorHora(edicao.hora, (h) => setEdicao((atual) => atual && { ...atual, hora: h }))
                  }
                >
                  <Ionicons name="time-outline" size={16} color={colors.navy} />
                  <Text style={styles.horaBotaoTexto}>
                    {edicao.hora != null ? `${String(edicao.hora).padStart(2, '0')}:00` : 'Sem lembrete'}
                  </Text>
                </Pressable>

                <Pressable style={styles.addButton} onPress={salvarEdicao} disabled={salvandoEdicao}>
                  {salvandoEdicao ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <Text style={styles.addButtonTexto}>Salvar</Text>
                  )}
                </Pressable>
                <Pressable style={styles.excluirButton} onPress={excluirEdicao}>
                  <Text style={styles.excluirButtonTexto}>Excluir atividade</Text>
                </Pressable>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, padding: 16 },
  cardTitulo: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  cardTituloEspacado: { marginTop: 14 },
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
  chipRow: { gap: 8, paddingBottom: 8 },
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
  vendedorHint: { fontSize: 11, color: colors.textMuted, marginBottom: 8, lineHeight: 15 },
  vendedorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  diasRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  diaChip: {
    backgroundColor: colors.white,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  horaBotao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  horaBotaoTexto: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  addButton: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  addButtonTexto: { color: colors.white, fontWeight: '700', fontSize: 14 },
  excluirButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  excluirButtonTexto: { color: colors.red, fontWeight: '700', fontSize: 14 },
  sectionTitulo: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 4, marginBottom: 8 },
  atividadeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  atividadeInfo: { flex: 1 },
  atividadeTexto: { fontSize: 14, color: colors.textPrimary },
  atividadeTextoInativo: { color: colors.textMuted, textDecorationLine: 'line-through' },
  atividadeDetalhe: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  hint: { fontSize: 11, color: colors.textMuted, marginTop: 4, marginBottom: 20, lineHeight: 16 },
  modalFundo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalConteudo: {
    backgroundColor: colors.white,
    borderRadius: 12,
    width: '80%',
    maxHeight: '70%',
    padding: 16,
  },
  modalTitulo: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  modalLista: { maxHeight: 360 },
  modalItem: { paddingVertical: 12, paddingHorizontal: 10, borderRadius: 8 },
  modalItemAtivo: { backgroundColor: colors.navy },
  modalItemTexto: { fontSize: 14, color: colors.textPrimary },
  modalItemTextoAtivo: { color: colors.white, fontWeight: '700' },
});
