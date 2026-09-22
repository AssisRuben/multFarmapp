-- ============================================================
-- MULTI-TENANT — FASE 1c: gap encontrado ao revisar o coletor (Fase 2)
--
-- vendas_numero_filial_unique_sem_serie (criado em
-- coletor/migracao_coletor.sql, fora do schema.sql principal) ficou de
-- fora da Fase 1 Parte G — cobre venda sem ser_nota_fiscal (índice
-- parcial), e hoje bloquearia numero_nota+cod_filial repetidos entre
-- tenants diferentes, igual o unique principal de vendas já corrigido.
-- ============================================================

drop index if exists vendas_numero_filial_unique_sem_serie;

create unique index vendas_numero_filial_unique_sem_serie
on vendas (tenant_id, numero_nota, cod_filial)
where ser_nota_fiscal is null;
