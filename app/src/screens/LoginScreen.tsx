import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';
import { buildWhatsAppUrl } from '../lib/whatsapp';
import { alertar } from '../lib/alert';
import { buscarSugestoesLogin } from '../lib/loginHistory';

const WHATSAPP_SUPORTE = '85988503418';

async function abrirWhatsAppSuporte() {
  const url = buildWhatsAppUrl(WHATSAPP_SUPORTE, 'Olá, estou com problema pra fazer login no app.');
  if (!url) return;
  try {
    await Linking.openURL(url);
  } catch {
    alertar('Não foi possível abrir o WhatsApp', 'Verifique se o WhatsApp está instalado.');
  }
}

interface Sugestao {
  nome: string;
  credencial: string;
}

export function LoginScreen() {
  const { signIn, signingIn, error } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);

  // Sugere pelo histórico LOCAL desse aparelho (ver lib/loginHistory) —
  // some assim que o campo esvazia ou vira e-mail completo (já não faz
  // sentido sugerir mais nada depois que a pessoa já escreveu o "@").
  const aoDigitarUsuario = async (texto: string) => {
    setEmail(texto);
    if (!texto.trim() || texto.includes('@')) {
      setSugestoes([]);
      return;
    }
    setSugestoes(await buscarSugestoesLogin(texto));
  };

  const escolherSugestao = (s: Sugestao) => {
    setEmail(s.credencial);
    setSugestoes([]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.container}>
        <Image
          source={require('../../assets/conviva.jpg')}
          style={styles.logo}
          resizeMode="contain"
        />

        <View style={styles.card}>
          <Text style={styles.title}>Entrar</Text>

          <TextInput
            style={styles.input}
            placeholder="Usuário ou e-mail"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            value={email}
            onChangeText={aoDigitarUsuario}
          />
          {sugestoes.length > 0 && (
            <View style={styles.sugestoesBox}>
              <FlatList
                data={sugestoes}
                keyExtractor={(s) => s.credencial}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable style={styles.sugestaoItem} onPress={() => escolherSugestao(item)}>
                    <Text style={styles.sugestaoTexto}>{item.nome}</Text>
                  </Pressable>
                )}
              />
            </View>
          )}
          <TextInput
            style={styles.input}
            placeholder="Senha"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={senha}
            onChangeText={setSenha}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.button, signingIn && styles.buttonDisabled]}
            onPress={() => signIn(email, senha)}
            disabled={signingIn}
          >
            {signingIn ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Entrar</Text>
            )}
          </Pressable>

          <Text style={styles.hint}>
            Problema no login, mande um{' '}
            <Text style={styles.whatsappLink} onPress={abrirWhatsAppSuporte}>
              WhatsApp
            </Text>
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: colors.navy,
  },
  logo: { width: '100%', height: 130, marginBottom: 28 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 },
  input: {
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 15,
    color: colors.textPrimary,
  },
  button: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: colors.white, fontWeight: '600', fontSize: 16 },
  error: { color: colors.red, marginBottom: 8 },
  sugestoesBox: {
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: -8,
    marginBottom: 12,
    maxHeight: 160,
    overflow: 'hidden',
  },
  sugestaoItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sugestaoTexto: { fontSize: 14, color: colors.textPrimary },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 20, lineHeight: 18 },
  whatsappLink: { color: colors.success, fontWeight: '700' },
});
