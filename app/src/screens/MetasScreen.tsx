import React, { useEffect, useState, useCallback } from 'react';
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
import { MetaProgressBar } from '../components/MetaProgressBar';
import { colors } from '../theme/colors';
import { formatBRL, parseDecimalBR } from '../lib/format';
import { aplicarMascaraMoeda, moedaParaTexto } from '../lib/moeda';
import { badgeFaixaComissao, mesAnoLabel, PESOS_SEMANA } from '../lib/metas';
import { alertar } from '../lib/alert';
import { ComissaoMensal, MetaVendedor, VendedorAtivo } from '../types/domain';

function hojeAnoMes(): { ano: number; mes: number } {
  const hoje = new Date();
  return { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };
}

export function MetasScreen() {
  const { profile } = useAuth();

  const [{ ano, mes }, setAnoMes] = useState(hojeAnoMes());
  const [vendedores, setVendedores] = useState<VendedorAtivo[]>([]);
  const [metas, setMetas] = useState<MetaVendedor[]>([]);
  const [loadingMetas, setLoadingMetas] = useState(true);

  const [comissoes, setComissoes] = useState<ComissaoMensal[]>([]);

  // Lançamento em massa da meta mensal — seção própria no fim da tela,
  // com seletor de mês independente do "Panorama da equipe" lá em
  // cima (não afeta nem é afetado pelo mês do panorama).
  const [{ ano: anoLote, mes: mesLote }, setAnoMesLote] = useState(hojeAnoMes());
  const [metasLote, setMetasLote] = useState<MetaVendedor[]>([]);
  const [loadingLote, setLoadingLote] = useState(true);
  const [salvandoLote, setSalvandoLote] = useState(false);
  const [valoresLote, setValoresLote] = useState<Record<number, string>>({});

  const carregarMetas = useCallback(async () => {
    if (!profile) return;
    setLoadingMetas(true);
    const dados = await repository.getMetas(profile, ano, mes);
    setMetas(dados);
    setLoadingMetas(false);
    // Comissão só faz sentido pra fechamento MENSAL (não é semanal/diária)
    // — ver comentário em vw_metas_comissao no supabase/schema.sql.
    setComissoes(await repository.getComissoesMensal(profile, ano, mes));
  }, [profile, ano, mes]);

  const carregarLote = useCallback(async () => {
    if (!profile) return;
    setLoadingLote(true);
    setMetasLote(await repository.getMetas(profile, anoLote, mesLote));
    setLoadingLote(false);
  }, [profile, anoLote, mesLote]);

  useEffect(() => {
    carregarMetas();
  }, [carregarMetas]);

  useEffect(() => {
    carregarLote();
  }, [carregarLote]);

  useEffect(() => {
    if (!profile) return;
    repository.getVendedoresAtivos(profile).then(setVendedores);
  }, [profile]);

  // Preenche o lote com o valor já lançado (se tiver) assim que os
  // vendedores ou as metas do mês selecionado carregam/mudam — quem
  // não tem meta ainda no período fica com o campo em branco.
  useEffect(() => {
    setValoresLote(
      Object.fromEntries(
        vendedores.map((v) => {
          const meta = metasLote.find((m) => m.codigoVendedor === v.codigo);
          return [v.codigo, meta ? moedaParaTexto(meta.valorMetaMensal) : ''];
        })
      )
    );
  }, [vendedores, metasLote]);

  const mudarMes = (delta: number) => {
    setAnoMes(({ ano, mes }) => {
      let novoMes = mes + delta;
      let novoAno = ano;
      if (novoMes > 12) {
        novoMes = 1;
        novoAno += 1;
      } else if (novoMes < 1) {
        novoMes = 12;
        novoAno -= 1;
      }
      return { ano: novoAno, mes: novoMes };
    });
  };

  const mudarMesLote = (delta: number) => {
    setAnoMesLote(({ ano, mes }) => {
      let novoMes = mes + delta;
      let novoAno = ano;
      if (novoMes > 12) {
        novoMes = 1;
        novoAno += 1;
      } else if (novoMes < 1) {
        novoMes = 12;
        novoAno -= 1;
      }
      return { ano: novoAno, mes: novoMes };
    });
  };

  // Único lançamento de meta mensal do app (21/08/2026 — existia um
  // segundo formulário aqui, individual por vendedor com ajuste fino
  // semana a semana; removido a pedido do usuário por redundância).
  // Meta mensal de todos os vendedores de uma vez, distribuída nas 4
  // semanas pelos pesos fixos de PESOS_SEMANA (25,5% / 22,6% / 22,6% /
  // 29,2%, dados pelo usuário). Vendedor com campo em branco é pulado
  // (não zera meta de quem não for atualizado nesse lançamento).
  const salvarLote = async () => {
    if (!profile) return;
    const entradas = Object.entries(valoresLote).filter(([, texto]) => texto.trim() !== '');
    if (entradas.length === 0) {
      alertar('Nada pra salvar', 'Preencha a meta de pelo menos um vendedor.');
      return;
    }

    const invalido = entradas.find(([, texto]) => parseDecimalBR(texto) <= 0);
    if (invalido) {
      alertar('Valor inválido', 'Algum campo preenchido não é um número válido.');
      return;
    }

    setSalvandoLote(true);
    try {
      for (const [codigo, texto] of entradas) {
        const mensal = parseDecimalBR(texto);
        const semanas = PESOS_SEMANA.map((peso) => Math.round(mensal * peso * 100) / 100) as [
          number,
          number,
          number,
          number,
        ];
        await repository.salvarMeta(profile, {
          codigoVendedor: Number(codigo),
          ano: anoLote,
          mes: mesLote,
          valorMetaMensal: mensal,
          valoresMetaSemanal: semanas,
        });
      }
      await carregarLote();
      alertar('Metas salvas', `Meta mensal atualizada pra ${entradas.length} vendedor(es).`);
    } finally {
      setSalvandoLote(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container} contentContainerStyle={styles.conteudo} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>🎯 Gestão da equipe</Text>

      <View style={styles.mesSeletor}>
        <Pressable onPress={() => mudarMes(-1)} style={styles.mesBotao} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={colors.navy} />
        </Pressable>
        <Text style={styles.mesLabel}>{mesAnoLabel(ano, mes)}</Text>
        <Pressable onPress={() => mudarMes(1)} style={styles.mesBotao} hitSlop={8}>
          <Ionicons name="chevron-forward" size={20} color={colors.navy} />
        </Pressable>
      </View>

      <Text style={styles.sectionTitulo}>Panorama da equipe — {mesAnoLabel(ano, mes)}</Text>
      {loadingMetas ? (
        <ActivityIndicator style={{ marginTop: 12 }} />
      ) : (
        metas.map((meta) => {
          const comissao = comissoes.find((c) => c.codigoVendedor === meta.codigoVendedor);
          const badge = comissao ? badgeFaixaComissao(comissao.faixaAlcancada) : null;
          return (
            <Card key={meta.codigoVendedor}>
              <MetaProgressBar
                label={`${badge ? `${badge} ` : ''}${meta.nomeVendedor} — mensal`}
                valorRealizado={meta.valorRealizadoMensal}
                valorMeta={meta.valorMetaMensal}
              />
              {comissao ? (
                <View style={styles.comissaoRow}>
                  <Text style={styles.comissaoTexto}>
                    💰 {comissao.regraAplicada === 'flat_10_mensal'
                      ? 'Meta mensal batida: 10% flat'
                      : `Taxa efetiva: ${comissao.percentualComissao}% (soma por semana)`} sobre a margem bruta
                    ({formatBRL(comissao.margemBrutaValor)})
                  </Text>
                  <Text style={styles.comissaoValor}>
                    ≈ {formatBRL(comissao.comissaoValor)} de comissão no fechamento do mês
                  </Text>
                </View>
              ) : null}
            </Card>
          );
        })
      )}

      <Text style={[styles.sectionTitulo, styles.loteTitulo]}>Lançar meta mensal</Text>
      <Card>
        <View style={styles.mesSeletor}>
          <Pressable onPress={() => mudarMesLote(-1)} style={styles.mesBotao} hitSlop={8}>
            <Ionicons name="chevron-back" size={20} color={colors.navy} />
          </Pressable>
          <Text style={styles.mesLabel}>{mesAnoLabel(anoLote, mesLote)}</Text>
          <Pressable onPress={() => mudarMesLote(1)} style={styles.mesBotao} hitSlop={8}>
            <Ionicons name="chevron-forward" size={20} color={colors.navy} />
          </Pressable>
        </View>

        {loadingLote ? (
          <ActivityIndicator style={{ marginTop: 12 }} />
        ) : (
          <>
            {vendedores.map((v) => (
              <View key={v.codigo} style={styles.loteRow}>
                <Text style={styles.loteNome} numberOfLines={1}>
                  {v.nome}
                </Text>
                <TextInput
                  style={[styles.input, styles.inputLote]}
                  keyboardType="numeric"
                  value={valoresLote[v.codigo] ?? ''}
                  onChangeText={(texto) => setValoresLote((atual) => ({ ...atual, [v.codigo]: aplicarMascaraMoeda(texto) }))}
                  placeholder="R$"
                />
              </View>
            ))}
            {/* Só conferência visual da soma digitada — não é enviado nem
                salvo em lugar nenhum, cada linha continua indo pro banco
                separada por vendedor. */}
            <View style={styles.loteTotalRow}>
              <Text style={styles.loteTotalLabel}>Total</Text>
              <Text style={styles.loteTotalValor}>
                {formatBRL(Object.values(valoresLote).reduce((soma, texto) => soma + parseDecimalBR(texto), 0))}
              </Text>
            </View>
          </>
        )}

        <Pressable style={styles.salvarButton} onPress={salvarLote} disabled={salvandoLote || loadingLote}>
          {salvandoLote ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.salvarTexto}>Salvar</Text>
          )}
        </Pressable>
      </Card>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background },
  // "Lançar meta mensal" tem um campo por vendedor, terminando com o
  // botão Salvar — sem espaço extra pra rolar, o teclado cobre os
  // últimos campos e o botão quando a lista de vendedores é grande.
  conteudo: { padding: 16, paddingBottom: 320 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  mesSeletor: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 12,
  },
  mesBotao: { padding: 6 },
  mesLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, minWidth: 150, textAlign: 'center' },
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
  salvarButton: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  salvarTexto: { color: colors.white, fontWeight: '700', fontSize: 14 },
  comissaoRow: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  comissaoTexto: { fontSize: 11, color: colors.textSecondary },
  comissaoValor: { fontSize: 12, fontWeight: '700', color: colors.navy, marginTop: 2 },
  sectionTitulo: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 4, marginBottom: 8 },
  loteTitulo: { marginTop: 20 },
  loteRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  loteNome: { flex: 1, fontSize: 13, color: colors.textPrimary },
  inputLote: { width: 130 },
  loteTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  loteTotalLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  loteTotalValor: { fontSize: 15, fontWeight: '700', color: colors.navy },
});
