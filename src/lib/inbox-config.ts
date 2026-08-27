/**
 * Constantes da caixa de atendimento compartilhadas entre servidor e cliente.
 *
 * Fica em módulo próprio de propósito: `lib/data/conversations` importa
 * `next/cache` e o cliente Supabase de servidor, então não pode ser importado
 * de um componente "use client" só para pegar um número.
 */

/** Quantas mensagens a conversa carrega por vez (as mais recentes primeiro). */
export const JANELA_MENSAGENS = 60;
