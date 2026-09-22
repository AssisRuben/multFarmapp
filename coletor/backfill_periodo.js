// Backfill histórico ÚNICO (não recorrente — diferente do
// sgf-incremental.n8n.json, que roda a cada 15 min). Puxa TUDO que a
// API SGF tem pra oferecer no período configurado, com paginação de
// verdade (o coletor incremental não tem isso ainda — ver alerta em
// coletor/README.md, seção 4).
//
// Uso:
//   cd coletor && npm install && node backfill_periodo.js
//
// Variáveis de ambiente obrigatórias:
//   TRIER_TOKEN     — o mesmo Bearer token usado na credencial do n8n
//   DATABASE_URL    — connection string do Supabase (Session Pooler,
//                     porta 5432 — NÃO a Transaction Pooler nem a
//                     conexão direta; ver coletor/README.md pros
//                     detalhes de por quê)
//   TENANT_ID       — uuid da farmácia em `tenants.id` (multi-tenant,
//                     ver supabase/migracao_multi_tenant_fase0.sql).
//                     Toda tabela de negócio exige tenant_id desde a
//                     Fase 1 — sem isso o script recusa rodar.
//
// Opcionais:
//   DATA_INICIAL    — default '2026-01-01T00:00:00-03:00'
//   ENTIDADES       — lista separada por vírgula pra rodar só um
//                     subconjunto (ex.: "produto,fornecedor,compra"),
//                     útil pra retomar depois de uma falha parcial sem
//                     repetir tudo. Default: todas.
//
// O que NÃO faz: não mexe em sync_control (isso é do coletor
// incremental, que continua rodando por conta própria) e não é
// idempotente pra compras/compras_itens (rodar duas vezes duplica —
// ver comentário perto de sincronizarCompras).
//
// Resiliência: vendas processa em lotes de 200 (não 1 por vez — já
// derrubou conexão em produção numa sessão de ~31 mil round-trips
// individuais) e reconecta automaticamente (até 3 tentativas) se a
// conexão cair no meio. Se mesmo assim falhar, é seguro rodar de novo
// do zero — todo upsert é idempotente, exceto compras (ver acima).
'use strict';

const { Client } = require('pg');

const TRIER_TOKEN = process.env.TRIER_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const TENANT_ID = process.env.TENANT_ID;
const BASE_URL = process.env.TRIER_BASE_URL || 'https://api-sgf-gateway.triersistemas.com.br/sgfpod1/rest/integracao';
const DATA_INICIAL = new Date(process.env.DATA_INICIAL || '2026-01-01T00:00:00-03:00');
const DATA_FINAL = new Date();
const ENTIDADES = new Set(
  (process.env.ENTIDADES || 'vendedor,cliente,produto,fornecedor,compra,venda,atendimentos')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

if (!TRIER_TOKEN) {
  console.error('Faltou TRIER_TOKEN (o mesmo Bearer da credencial "SGF Trier - Bearer" no n8n).');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('Faltou DATABASE_URL (connection string do Session Pooler do Supabase — ver coletor/README.md).');
  process.exit(1);
}
if (!TENANT_ID) {
  console.error('Faltou TENANT_ID (uuid da farmácia em `tenants.id` — ver supabase/migracao_multi_tenant_fase0.sql). Toda tabela de negócio agora exige tenant_id.');
  process.exit(1);
}

// A API rejeita ISO com "Z"/milissegundos — espera "-0300" fixo, sem
// dois-pontos no offset (mesmo formato documentado em coletor/README.md
// pro workflow incremental). Construído a partir de UTC pra não
// depender do fuso horário de onde este script roda.
function formatarDataTrier(dataUtc) {
  const brasilia = new Date(dataUtc.getTime() - 3 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${brasilia.getUTCFullYear()}-${pad(brasilia.getUTCMonth() + 1)}-${pad(brasilia.getUTCDate())}` +
    `T${pad(brasilia.getUTCHours())}:${pad(brasilia.getUTCMinutes())}:${pad(brasilia.getUTCSeconds())}-0300`
  );
}

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sessão de Postgres longa (dezenas de milhares de queries, no caso de
// vendas) já caiu no meio em produção ("Connection terminated
// unexpectedly") — sem isso, um Client cru derruba o processo inteiro
// (evento 'error' sem listener = throw não tratado no Node) e perde
// tudo que ainda não tinha rodado. Essa wrapper reconecta e tenta de
// novo até 3x em erro de conexão; expõe só `.query()`, então o resto
// do script (que só chama client.query(...)) não precisa saber que o
// client por baixo pode trocar.
function criarConexaoResiliente(databaseUrl) {
  let client = null;
  const MAX_TENTATIVAS = 3;

  async function conectarBruto() {
    // rejectUnauthorized: false — o pooler do Supabase exige SSL; sem
    // configurar isso aqui, o pg.Client tenta conectar sem TLS e o
    // servidor derruba a conexão (ECONNRESET consistente, não soluço de
    // rede). O n8n não sofre disso porque a credencial Postgres dele já
    // negocia SSL sozinha por baixo.
    client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    // sem isso, uma queda assíncrona (fora de uma query em andamento)
    // ainda derruba o processo — precisa de ALGUM listener em 'error'.
    client.on('error', (erro) => {
      console.warn(`\n  [conexão] evento de erro assíncrono: ${erro.message}`);
      client = null;
    });
    await client.connect();
  }

  // Mesmo retry pra "conectar pela 1a vez" e "reconectar no meio de uma
  // query" — um ECONNRESET/timeout pode acontecer no connect inicial
  // também (soluço transitório do pooler), não só depois. Antes só a
  // query tinha retry; a conexão inicial (chamada 1x em main()) morria
  // direto sem tentar de novo.
  async function comRetentativas(fn) {
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      try {
        if (!client) await conectarBruto();
        return await fn();
      } catch (erro) {
        const transitorio = /connection terminated|econnreset|etimedout|timeout|socket hang up/i.test(erro.message || '');
        client = null;
        if (!transitorio || tentativa === MAX_TENTATIVAS) throw erro;
        console.warn(`\n  [conexão] caiu (${erro.message}) — reconectando, tentativa ${tentativa + 1}/${MAX_TENTATIVAS}...`);
        await dormir(2000 * tentativa);
      }
    }
  }

  async function conectar() {
    await comRetentativas(async () => {});
  }

  async function query(sql, params) {
    return comRetentativas(() => client.query(sql, params));
  }

  async function encerrar() {
    if (client) await client.end().catch(() => {});
  }

  return { query, conectar, encerrar };
}

// Paginação de verdade: incrementa primeiroRegistro em passos de 999
// até a API devolver menos que isso — só aí sabe que chegou ao fim.
// É exatamente o que falta no coletor incremental (fixo em página 0).
async function buscarTudo(caminho, paramsExtras = {}) {
  const QUANTIDADE = 999;
  let primeiroRegistro = 0;
  const linhas = [];
  for (;;) {
    const url = new URL(`${BASE_URL}${caminho}`);
    url.searchParams.set('primeiroRegistro', String(primeiroRegistro));
    url.searchParams.set('quantidadeRegistros', String(QUANTIDADE));
    for (const [chave, valor] of Object.entries(paramsExtras)) {
      url.searchParams.set(chave, valor);
    }

    const resposta = await fetch(url, { headers: { Authorization: `Bearer ${TRIER_TOKEN}` } });
    if (!resposta.ok) {
      throw new Error(`${caminho} -> HTTP ${resposta.status}: ${await resposta.text()}`);
    }
    const pagina = await resposta.json();
    const itens = Array.isArray(pagina) ? pagina : [];
    linhas.push(...itens);

    process.stdout.write(`\r  ${caminho}: ${linhas.length} registro(s)...`);

    if (itens.length < QUANTIDADE) break;
    primeiroRegistro += QUANTIDADE;
    await dormir(150); // não martelar o gateway
  }
  process.stdout.write('\n');
  return linhas;
}

function pgVal(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

// Upsert em lote com placeholders parametrizados ($1, $2, ...) — mais
// seguro que a interpolação de string usada nos Code nodes do n8n
// (que precisa disso por limitação do Code node; aqui não precisa).
// tenant_id é sempre a 1a coluna e sempre entra no alvo do ON CONFLICT —
// centralizado aqui pra toda função de sincronização que usa este
// helper (vendedores, clientes, produto_catalogo, fornecedores,
// atendimentos) ganhar isso de graça, sem precisar mexer em cada uma.
async function upsertLote(client, { tabela, colunas, linhas, conflito, atualizarColunas, tamanhoLote = 500 }) {
  const colunasComTenant = ['tenant_id', ...colunas];
  const conflitoComTenant = `tenant_id, ${conflito}`;
  let total = 0;
  for (let inicio = 0; inicio < linhas.length; inicio += tamanhoLote) {
    const lote = linhas.slice(inicio, inicio + tamanhoLote);
    const valores = [];
    const grupos = lote.map((linha, i) => {
      const linhaComTenant = [TENANT_ID, ...linha];
      const base = i * colunasComTenant.length;
      valores.push(...linhaComTenant.map(pgVal));
      return `(${colunasComTenant.map((_, j) => `$${base + j + 1}`).join(', ')})`;
    });
    const updateSet = atualizarColunas.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    await client.query(
      `INSERT INTO ${tabela} (${colunasComTenant.join(', ')})
       VALUES ${grupos.join(',\n')}
       ON CONFLICT (${conflitoComTenant}) DO UPDATE SET ${updateSet}`,
      valores
    );
    total += lote.length;
  }
  return total;
}

async function sincronizarVendedores(client) {
  const linhas = await buscarTudo('/vendedor/obter-todos-v1');
  const colunas = ['codigo', 'nome', 'numero_cpf', 'cep', 'email', 'ativo'];
  const total = await upsertLote(client, {
    tabela: 'vendedores',
    colunas,
    linhas: linhas.map((v) => [v.codigo, v.nome, v.numeroCpf, v.cep, v.email, v.ativo]),
    conflito: 'codigo',
    atualizarColunas: colunas.slice(1),
  });
  console.log(`  vendedores: ${total} upsertados.`);
}

async function sincronizarClientes(client) {
  const linhas = await buscarTudo('/cliente/obter-todos-v1');
  const colunas = [
    'codigo', 'nome', 'numero_cpf_cnpj', 'codigo_cidade', 'email', 'cep', 'estado',
    'fone', 'bairro', 'logradouro', 'numero_endereco', 'ativo', 'data_nascimento', 'grupo', 'empresa_convenio',
  ];
  const total = await upsertLote(client, {
    tabela: 'clientes',
    colunas,
    linhas: linhas.map((c) => [
      c.codigo, c.nome, c.numeroCpfCnpj, c.codigoCidade, c.email, c.cep, c.estado,
      c.fone, c.bairro, c.logradouro, c.numeroEndereco, c.ativo, c.dataNascimento ?? null, c.grupo ?? null, c.empresaConvenio ?? null,
    ]),
    conflito: 'codigo',
    atualizarColunas: colunas.slice(1),
  });
  console.log(`  clientes: ${total} upsertados.`);
}

// ProdutoIntegracaoDto não tem campo "marca" — nomeLaboratorio é a
// aproximação mais próxima (fabricante), não é exatamente a mesma
// coisa. codigoBarras vem como int64 na API; nossa coluna é text.
async function sincronizarProdutos(client) {
  const linhas = await buscarTudo('/produto/obter-todos-v1');
  // categoria = nomeCategoria (tipo de uso, ex. "Uso Adulto" — não é
  // categoria de produto de verdade); grupo = nomeGrupo (esse sim é
  // útil pra filtro, ex. "Analgésicos", "Fraldas") — campos separados
  // de propósito, achado 01/08/2026 que estavam sendo conflados.
  const colunas = ['codigo', 'codigo_barras', 'nome', 'categoria', 'grupo', 'marca', 'preco_venda', 'custo_medio', 'estoque_atual', 'tipo_lista'];
  const total = await upsertLote(client, {
    tabela: 'produto_catalogo',
    colunas,
    linhas: linhas.map((p) => [
      p.codigo,
      p.codigoBarras != null ? String(p.codigoBarras) : null,
      p.nome,
      p.nomeCategoria ?? null,
      p.nomeGrupo ?? null,
      p.nomeLaboratorio ?? null,
      p.valorVenda ?? 0,
      p.valorCustoMedio ?? p.valorCusto ?? 0,
      p.quantidadeEstoque ?? 0,
      p.tipoLista ?? null,
    ]),
    conflito: 'codigo',
    atualizarColunas: colunas.slice(1),
  });
  console.log(`  produto_catalogo: ${total} upsertados.`);
}

async function sincronizarFornecedores(client) {
  const linhas = await buscarTudo('/fornecedor/obter-todos-v1');
  const colunas = ['codigo', 'nome_fantasia', 'razao_social', 'numero_cnpj', 'nome_cidade', 'email', 'ativo'];
  const total = await upsertLote(client, {
    tabela: 'fornecedores',
    colunas,
    linhas: linhas.map((f) => [f.codigo, f.nomeFantasia, f.razaoSocial, f.numeroCnpj, f.nomeCidade, f.email, f.ativo]),
    conflito: 'codigo',
    atualizarColunas: colunas.slice(1),
  });
  console.log(`  fornecedores: ${total} upsertados.`);
}

// compras/compras_itens não têm constraint única (tabelas ficaram
// vazias até agora — ver conversa) — INSERT direto, sem ON CONFLICT.
// NÃO idempotente: rodar isso duas vezes duplica as compras do
// período. Se precisar rodar de novo, TRUNCATE compras, compras_itens
// antes (compras_itens cai em cascata pela FK).
async function sincronizarCompras(client) {
  const linhas = await buscarTudo('/compra/obter-alterados-v1', {
    dataInicial: formatarDataTrier(DATA_INICIAL),
    dataFinal: formatarDataTrier(DATA_FINAL),
  });

  let totalCompras = 0;
  let totalItens = 0;
  for (const compra of linhas) {
    const { rows } = await client.query(
      `INSERT INTO compras (tenant_id, data_entrada, numero_nota_fiscal, codigo_fornecedor, valor_total_nota, valor_total_produtos, quantidade_itens, chave_acesso_nfe)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        TENANT_ID,
        compra.dataEntrada ?? null,
        compra.numeroNotaFiscal ?? null,
        compra.codigoFornecedor ?? null,
        compra.valorTotalNota ?? null,
        compra.valorTotalProdutos ?? null,
        compra.quantidadeItens ?? null,
        compra.chaveAcessoNfe ?? null,
      ]
    );
    const compraId = rows[0].id;
    totalCompras += 1;

    const itens = compra.itens || [];
    if (itens.length > 0) {
      await upsertLoteSemConflito(client, {
        tabela: 'compras_itens',
        colunas: ['compra_id', 'codigo_produto', 'quantidade_produtos', 'fator_compra', 'valor_unitario', 'valor_unitario_liquido', 'valor_custo', 'valor_st'],
        linhas: itens.map((it) => [
          compraId, it.codigoProduto, it.quantidadeProdutos, it.fatorCompra ?? 1, it.valorUnitario, it.valorUnitarioLiquido, it.valorCusto, it.valorST,
        ]),
      });
      totalItens += itens.length;
    }
  }
  console.log(`  compras: ${totalCompras} inseridas, ${totalItens} itens.`);
}

async function upsertLoteSemConflito(client, { tabela, colunas, linhas, tamanhoLote = 500 }) {
  const colunasComTenant = ['tenant_id', ...colunas];
  for (let inicio = 0; inicio < linhas.length; inicio += tamanhoLote) {
    const lote = linhas.slice(inicio, inicio + tamanhoLote);
    const valores = [];
    const grupos = lote.map((linha, i) => {
      const linhaComTenant = [TENANT_ID, ...linha];
      const base = i * colunasComTenant.length;
      valores.push(...linhaComTenant.map(pgVal));
      return `(${colunasComTenant.map((_, j) => `$${base + j + 1}`).join(', ')})`;
    });
    await client.query(`INSERT INTO ${tabela} (${colunasComTenant.join(', ')}) VALUES ${grupos.join(',\n')}`, valores);
  }
}

// mesma lógica de "Mapear vendas" + "Preparar itens e cursor" do
// sgf-incremental.n8n.json (stub de FK, parsing de hora, mapeamento de
// venda_com_desconto/venda_ecommerce) — só trocando a interpolação de
// string por parâmetros e adicionando paginação de verdade.
// horaEmissao vem como "HH:MM:SS-0300" (hora + fuso, sem data, sem
// "T") — formato descoberto 02/08/2026 inspecionando a API crua, não
// documentado. Extrai só o prefixo HH:MM(:SS), ignorando o que vier
// depois (fuso, milissegundos, "Z" etc.) — funciona tanto pra esse
// formato quanto pra um datetime ISO completo (usa o que vier depois
// do "T", se tiver).
function horaParaPg(bruto) {
  if (bruto === null || bruto === undefined || bruto === '') return null;
  const s = String(bruto);
  const idxT = s.indexOf('T');
  const alvo = idxT >= 0 ? s.slice(idxT + 1) : s;
  const match = alvo.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
  if (/^\d{1,2}$/.test(s)) return s.padStart(2, '0') + ':00:00';
  return null;
}

async function sincronizarVendas(client) {
  const vendas = await buscarTudo('/venda/obter-alterados-v1', {
    dataInicial: formatarDataTrier(DATA_INICIAL),
    dataFinal: formatarDataTrier(DATA_FINAL),
  });
  if (vendas.length === 0) {
    console.log('  vendas: nenhuma no período.');
    return;
  }

  const codigosClientes = [...new Set(vendas.map((v) => v.codigoCliente).filter((c) => c != null))];
  const codigosVendedores = new Set(vendas.map((v) => v.codigoVendedor).filter((c) => c != null));
  for (const venda of vendas) {
    for (const item of venda.itens || []) {
      if (item.codigoVendedor != null) codigosVendedores.add(item.codigoVendedor);
    }
  }

  if (codigosClientes.length > 0) {
    await upsertLoteSemConflitoIgnorando(client, 'clientes', ['codigo'], codigosClientes.map((c) => [c]));
  }
  if (codigosVendedores.size > 0) {
    await upsertLoteSemConflitoIgnorando(
      client,
      'vendedores',
      ['codigo', 'nome'],
      [...codigosVendedores].map((c) => [c, '(pendente sincronizacao)'])
    );
  }

  // tipo_cancelamento e numero_nota_origem ficam FORA daqui de propósito
  // (26/08/2026): /venda/obter-alterados-v1 nunca traz esses campos
  // preenchidos, então incluí-los no UPSERT normal sobrescrevia de volta
  // pra NULL toda vez que uma venda já marcada como cancelada/devolvida
  // fosse reprocessada por qualquer motivo (endereço alterado, etc.) --
  // achado com dado real: um backfill derrubou 347 devoluções marcadas
  // pra 327 rodando isso sem essa exclusão. Esses dois campos são
  // exclusivos dos fluxos de Cancelamento/Devolução (coletor/
  // sgf-incremental.n8n.json), que fazem UPDATE isolado, sem tocar o
  // resto da linha.
  const COLUNAS_VENDA = [
    'tenant_id', 'numero_nota', 'data_emissao', 'hora_emissao', 'codigo_vendedor',
    'codigo_cliente', 'entrega', 'pagamento_na_entrega', 'condicao_pagamento', 'vlr_troco', 'numero_cupom_fiscal',
    'numero_nota_fiscal', 'xml_nfe', 'cod_parceiro', 'cod_filial', 'venda_ifood', 'venda_ecommerce', 'cod_ecommerce',
    'ser_nota_fiscal', 'modelo_venda', 'dados_entrega',
  ];
  const UPDATE_SET_VENDA = COLUNAS_VENDA.slice(2) // pula tenant_id e numero_nota (chave do conflito)
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ') + ', updated_at = now()';

  function chaveVenda(numeroNota, codFilial, serNotaFiscal) {
    return `${numeroNota}|${codFilial ?? ''}|${serNotaFiscal ?? ''}`;
  }

  // ser_nota_fiscal nula precisa de um alvo de conflito diferente —
  // (numero_nota, cod_filial, ser_nota_fiscal) nunca "bate" quando a
  // série é NULL (Postgres trata cada NULL como distinto de si mesmo),
  // então cada reprocessamento duplicava a venda inteira em vez de
  // atualizar. O índice pra esse caso é PARCIAL (where ser_nota_fiscal
  // is null) — o Postgres só infere um índice parcial se o MESMO WHERE
  // aparecer literalmente no ON CONFLICT.
  async function inserirVendasRetornando(subset, alvoConflito) {
    if (subset.length === 0) return [];
    const valores = [];
    const grupos = subset.map((v, i) => {
      const dataEmissao = v.dataEmissao ? String(v.dataEmissao).slice(0, 10) : null;
      const linha = [
        TENANT_ID, v.numeroNota, dataEmissao, horaParaPg(v.horaEmissao),
        v.codigoVendedor ?? null, v.codigoCliente ?? null, v.entrega ?? null, v.pagamentoNaEntrega ?? null,
        v.condicaoPagamento ?? null, v.vlrTroco ?? null, v.numeroCupomFiscal ?? null, v.numeroNotaFiscal ?? null,
        v.xmlNfe ?? null, v.codParceiro ?? null, v.codFilial ?? null, v.vendaIfood ?? null, v.vendaEcommerce === 'S',
        v.codEcommerce ?? null, v.serNotaFiscal ?? null, v.modeloVenda ?? null, v.dadosEntrega ?? null,
      ];
      const base = i * COLUNAS_VENDA.length;
      valores.push(...linha.map(pgVal));
      const placeholders = COLUNAS_VENDA.map((_, j) => `$${base + j + 1}`).join(', ');
      return `(${placeholders}, now())`;
    });
    const { rows } = await client.query(
      `INSERT INTO vendas (${COLUNAS_VENDA.join(', ')}, updated_at)
       VALUES ${grupos.join(',\n')}
       ON CONFLICT ${alvoConflito} DO UPDATE SET ${UPDATE_SET_VENDA}
       RETURNING id, numero_nota, cod_filial, ser_nota_fiscal`,
      valores
    );
    return rows;
  }

  const COLUNAS_ITEM = [
    'venda_id', 'codigo_produto', 'codigo_vendedor', 'quantidade_produtos', 'valor_total_bruto', 'valor_total_liquido',
    'valor_total_custo', 'parceiro', 'codigo_medico', 'cod_barras', 'num_sequencial', 'prc_comissao', 'vlr_desconto',
    'vlr_unitario', 'vlr_custo_aquisicao', 'vlr_custo_produto', 'tabela_desconto', 'prc_desconto', 'prc_desconto_max',
    'venda_com_desconto',
  ];

  // Processa em lotes (não 1 venda por vez) — bem mais rápido e reduz
  // drasticamente a exposição a queda de conexão no meio (já aconteceu
  // em produção com ~31 mil round-trips individuais).
  const TAMANHO_LOTE = 200;
  let totalVendas = 0;
  let totalItens = 0;

  for (let inicio = 0; inicio < vendas.length; inicio += TAMANHO_LOTE) {
    const lote = vendas.slice(inicio, inicio + TAMANHO_LOTE);
    const comSerie = lote.filter((v) => v.serNotaFiscal != null);
    const semSerie = lote.filter((v) => v.serNotaFiscal == null);

    const idPorChave = new Map();
    for (const r of await inserirVendasRetornando(comSerie, '(tenant_id, numero_nota, cod_filial, ser_nota_fiscal)')) {
      idPorChave.set(chaveVenda(r.numero_nota, r.cod_filial, r.ser_nota_fiscal), r.id);
    }
    for (const r of await inserirVendasRetornando(semSerie, '(tenant_id, numero_nota, cod_filial) WHERE ser_nota_fiscal IS NULL')) {
      idPorChave.set(chaveVenda(r.numero_nota, r.cod_filial, r.ser_nota_fiscal), r.id);
    }

    // Tentar casar item por item via ON CONFLICT (venda_id, num_sequencial)
    // com num_sequencial sintetizado pela posição no array não funciona:
    // a Trier não garante que a ordem dos itens de uma nota seja a mesma
    // entre chamadas diferentes, então reprocessar uma venda já
    // sincronizada podia sintetizar um num_sequencial diferente pro
    // mesmo item físico e duplicá-lo em vez de atualizar (achado em
    // produção: 28.643 itens duplicados, 30,5% da tabela — ver
    // migracao_coletor.sql item 5). Em vez disso: apaga todos os itens
    // da venda antes de reinserir os itens atuais — imune à ordem.
    // [10/08/2026] NÃO deduplicar itens dentro da mesma nota — item
    // "repetido" (mesmo produto/valor 2x numa nota) pode ser venda real
    // (operador bipou 2x em vez de usar quantidade 2), não bug de sync.
    // Confirmado direto na tela da Trier pra nota 749414 (produto 3730,
    // Rafaela): as 2 linhas existem DE VERDADE no sistema deles, Total
    // da Nota = soma das duas. Uma tentativa anterior de deduplicar
    // aqui foi revertida por isso.
    const linhasItens = [];
    for (const v of lote) {
      const vendaId = idPorChave.get(chaveVenda(v.numeroNota, v.codFilial, v.serNotaFiscal));
      if (!vendaId) continue; // não deveria acontecer — venda não retornou id
      totalVendas += 1;

      (v.itens || []).forEach((item, indice) => {
        const vendaComDescontoBool = item.vendaComDesconto != null && item.vendaComDesconto !== item.valorTotalLiquido;
        linhasItens.push([
          vendaId, item.codigoProduto, item.codigoVendedor ?? null, item.quantidadeProdutos, item.valorTotalBruto,
          item.valorTotalLiquido, item.valorTotalCusto, item.parceiro ?? null, item.codigoMedico ?? null, item.codBarras ?? null,
          item.numSequencial ?? indice + 1, item.prcComissao ?? null, item.vlrDesconto ?? null, item.vlrUnitario ?? null,
          item.vlrCustoAquisicao ?? null, item.vlrCustoProduto ?? null, item.tabelaDesconto ?? null, item.prcDesconto ?? null,
          item.prcDescontoMax ?? null, vendaComDescontoBool,
        ]);
      });
    }

    const vendaIdsDoLote = [...idPorChave.values()];
    if (vendaIdsDoLote.length > 0) {
      await client.query('DELETE FROM venda_itens WHERE venda_id = ANY($1)', [vendaIdsDoLote]);
    }
    if (linhasItens.length > 0) {
      await upsertLoteSemConflito(client, {
        tabela: 'venda_itens',
        colunas: COLUNAS_ITEM,
        linhas: linhasItens,
      });
      totalItens += linhasItens.length;
    }

    process.stdout.write(`\r  vendas: ${Math.min(inicio + TAMANHO_LOTE, vendas.length)}/${vendas.length} processadas...`);
  }
  process.stdout.write('\n');
  console.log(`  vendas: ${totalVendas} upsertadas, ${totalItens} itens.`);
}

async function upsertLoteSemConflitoIgnorando(client, tabela, colunas, linhas) {
  if (linhas.length === 0) return;
  const colunasComTenant = ['tenant_id', ...colunas];
  const valores = [];
  const grupos = linhas.map((linha, i) => {
    const linhaComTenant = [TENANT_ID, ...linha];
    const base = i * colunasComTenant.length;
    valores.push(...linhaComTenant.map(pgVal));
    return `(${colunasComTenant.map((_, j) => `$${base + j + 1}`).join(', ')})`;
  });
  await client.query(
    `INSERT INTO ${tabela} (${colunasComTenant.join(', ')}) VALUES ${grupos.join(',\n')} ON CONFLICT (tenant_id, codigo) DO NOTHING`,
    valores
  );
}

async function sincronizarAtendimentos(client) {
  const linhas = await buscarTudo('/venda/obter-atendimentos-diario-vendedor-v1', {
    dataInicial: formatarDataTrier(DATA_INICIAL),
    dataFinal: formatarDataTrier(DATA_FINAL),
  });
  const colunas = ['data_emissao', 'codigo_vendedor', 'quantidade_itens', 'quantidade_atendimentos'];
  const total = await upsertLote(client, {
    tabela: 'vendas_vendedor_diario',
    colunas,
    linhas: linhas.map((a) => [String(a.dataEmissao).slice(0, 10), a.codigoVendedor, a.quantidadeItens, a.quantidadeAtendimentos]),
    conflito: 'data_emissao, codigo_vendedor',
    atualizarColunas: ['quantidade_itens', 'quantidade_atendimentos'],
  });
  console.log(`  atendimentos: ${total} upsertados.`);
}

async function main() {
  console.log(`Período: ${formatarDataTrier(DATA_INICIAL)} até ${formatarDataTrier(DATA_FINAL)}`);
  console.log(`Entidades: ${[...ENTIDADES].join(', ')}\n`);

  const client = criarConexaoResiliente(DATABASE_URL);
  await client.conectar();

  try {
    // ordem importa: produto antes de compra (FK), fornecedor antes de
    // compra (FK), vendedor/cliente antes de venda (FK, embora venda já
    // tenha o próprio stub de segurança).
    if (ENTIDADES.has('vendedor')) { console.log('Vendedores...'); await sincronizarVendedores(client); }
    if (ENTIDADES.has('cliente')) { console.log('Clientes...'); await sincronizarClientes(client); }
    if (ENTIDADES.has('produto')) { console.log('Catálogo de produtos...'); await sincronizarProdutos(client); }
    if (ENTIDADES.has('fornecedor')) { console.log('Fornecedores...'); await sincronizarFornecedores(client); }
    if (ENTIDADES.has('compra')) { console.log('Compras...'); await sincronizarCompras(client); }
    if (ENTIDADES.has('venda')) { console.log('Vendas...'); await sincronizarVendas(client); }
    if (ENTIDADES.has('atendimentos')) { console.log('Atendimentos diários...'); await sincronizarAtendimentos(client); }
    console.log('\nConcluído.');
  } finally {
    await client.encerrar();
  }
}

main().catch((erro) => {
  console.error('\nFalhou:', erro.message);
  process.exit(1);
});
