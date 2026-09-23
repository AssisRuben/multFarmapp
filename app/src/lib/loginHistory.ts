import AsyncStorage from '@react-native-async-storage/async-storage';

// Histórico local de login (por aparelho, não sincroniza com o
// servidor) — guarda nome + credencial de quem já logou nesse
// dispositivo, pra sugerir enquanto digita o primeiro nome. Não dá
// pra buscar isso no servidor: antes de autenticar não existe sessão
// (RLS bloqueia vendedores/profiles) e mesmo que desse, misturaria
// nome de vendedor de farmácias diferentes na mesma sugestão — um
// vazamento de dado entre tenants. Guardando só o que já logou NESSE
// aparelho, cada tablet/celular só "aprende" a equipe da própria
// farmácia, naturalmente.
const CHAVE = 'loginHistorico:v1';
const LIMITE = 20; // não deixa crescer sem fim num aparelho usado por anos

interface EntradaHistorico {
  nome: string;
  credencial: string; // exatamente o que a pessoa digitou (sem @farmapp.local aplicado)
  usadoEm: string;
}

async function lerHistorico(): Promise<EntradaHistorico[]> {
  try {
    const bruto = await AsyncStorage.getItem(CHAVE);
    return bruto ? (JSON.parse(bruto) as EntradaHistorico[]) : [];
  } catch {
    return [];
  }
}

// Chamado pelo AuthContext logo depois de um login bem-sucedido —
// atualiza (ou adiciona) a entrada dessa credencial, sempre com o nome
// mais recente vindo do perfil de verdade (evita sugestão desatualizada
// se o nome mudar no cadastro).
export async function salvarLoginHistorico(nome: string, credencialDigitada: string): Promise<void> {
  try {
    const atual = await lerHistorico();
    const semDuplicata = atual.filter(
      (e) => e.credencial.toLowerCase() !== credencialDigitada.toLowerCase()
    );
    const novo: EntradaHistorico[] = [
      { nome, credencial: credencialDigitada, usadoEm: new Date().toISOString() },
      ...semDuplicata,
    ].slice(0, LIMITE);
    await AsyncStorage.setItem(CHAVE, JSON.stringify(novo));
  } catch {
    // histórico é só conveniência — falha aqui nunca deve travar o login
  }
}

// Sugestões pro que a pessoa já digitou — casa pelo primeiro nome
// (prefixo, sem acento/case) pra "mar" já sugerir "Marina Alves".
export async function buscarSugestoesLogin(prefixoDigitado: string): Promise<EntradaHistorico[]> {
  const prefixo = normalizar(prefixoDigitado);
  if (!prefixo) return [];
  const historico = await lerHistorico();
  return historico.filter((e) => normalizar(e.nome.split(' ')[0]).startsWith(prefixo));
}

function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // remove acentos
}
