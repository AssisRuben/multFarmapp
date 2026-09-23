import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { repository } from '../data';
import { obterPushToken } from '../lib/notifications';
import { withTimeout } from '../lib/timeout';
import { salvarLoginHistorico } from '../lib/loginHistory';
import { Profile } from '../types/domain';

// Sem isso, wifi ruim (portal cativo, sinal fraco) trava a chamada ao
// Supabase pra sempre e a tela fica girando sem nunca dar erro.
const TIMEOUT_MS = 15000;

// Vendedor loga só com usuário (sem "@") — a Trier não tem e-mail
// cadastrado pra ninguém, então a conta é criada com um e-mail interno
// fake (usuario@farmapp.local, nunca recebe e-mail de verdade) e a
// pessoa nem precisa saber que isso existe por trás. Gestor continua
// digitando o e-mail real normalmente (já tem "@", passa direto).
function credencialLogin(digitado: string): string {
  const valor = digitado.trim();
  return valor.includes('@') ? valor : `${valor.toLowerCase()}@farmapp.local`;
}

// Registra (ou atualiza) o Expo push token no perfil logado — usado
// pelo n8n pra mandar push de verdade (ex.: subiu de faixa de
// comissão). "Nice to have": nunca deve travar login nem sessão.
function registrarPushToken(profile: Profile): void {
  obterPushToken()
    .then((token) => {
      if (token) return repository.salvarPushToken(profile, token);
    })
    .catch(() => {});
}

interface AuthContextValue {
  profile: Profile | null;
  loadingSession: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: (email: string, senha: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    withTimeout(repository.getSession(), TIMEOUT_MS, 'Tempo esgotado ao verificar sessão.')
      .then((sessionProfile) => {
        setProfile(sessionProfile);
        if (sessionProfile) registrarPushToken(sessionProfile);
      })
      .catch(() => {
        // sem sessão restaurada, cai na tela de login normalmente
      })
      .finally(() => setLoadingSession(false));
  }, []);

  const signIn = async (digitado: string, senha: string) => {
    setSigningIn(true);
    setError(null);
    try {
      const loggedProfile = await withTimeout(
        repository.login(credencialLogin(digitado), senha),
        TIMEOUT_MS,
        'Sem conexão com o servidor. Verifique sua internet e tente novamente.'
      );
      setProfile(loggedProfile);
      registrarPushToken(loggedProfile);
      // guarda o que a pessoa DIGITOU (não o e-mail transformado) pra
      // sugerir de novo da próxima vez, só nesse aparelho.
      salvarLoginHistorico(loggedProfile.nome, digitado.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao entrar.');
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    await repository.logout();
    setProfile(null);
  };

  const value = useMemo(
    () => ({ profile, loadingSession, signingIn, error, signIn, signOut }),
    [profile, loadingSession, signingIn, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
