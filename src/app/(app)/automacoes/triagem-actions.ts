"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { buildTriagemFlow, DEFAULT_SECTORS, DEFAULT_GREETING } from "@/lib/triagem-template";

/**
 * Cria (ou atualiza) o bot de triagem a partir dos departamentos existentes.
 * Casa cada setor com o departamento de nome parecido; o que não casar fica
 * sem transferência e aparece para o usuário ajustar no editor.
 */
export async function criarBotTriagem() {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const org = session.organization.id;
  const sb = await createClient();

  const { data: departments } = await sb
    .from("departments")
    .select("id, name")
    .eq("organization_id", org);

  const norm = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  const acharDepartamento = (rotulo: string): string | null => {
    const alvo = norm(rotulo.replace(/[^\p{L}\s]/gu, "").trim());
    const lista = (departments ?? []) as { id: string; name: string }[];
    const exato = lista.find((d) => norm(d.name) === alvo);
    if (exato) return exato.id;
    // "Experiência do Aluno" casa com o departamento "experiência do aluno"
    const parcial = lista.find(
      (d) => alvo.includes(norm(d.name)) || norm(d.name).includes(alvo.split(" ")[0]),
    );
    return parcial?.id ?? null;
  };

  const sectors = DEFAULT_SECTORS.map((s) => ({
    ...s,
    departmentId: acharDepartamento(s.label),
  }));

  const flow = buildTriagemFlow({ greeting: DEFAULT_GREETING, sectors });

  const { data: existing } = await sb
    .from("automations")
    .select("id")
    .eq("organization_id", org)
    .eq("name", "Triagem — direcionamento inicial")
    .maybeSingle();

  if (existing?.id) {
    await sb
      .from("automations")
      .update({ flow, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await sb.from("automations").insert({
      organization_id: org,
      name: "Triagem — direcionamento inicial",
      // o motor escolhe a automação ATIVA do canal; o trigger é só rótulo
      trigger: "mensagem recebida",
      flow,
      // nasce desligado: o usuário revisa os textos e liga quando quiser
      active: false,
    });
  }

  revalidatePath("/automacoes");
  return sectors.filter((s) => !s.departmentId).map((s) => s.label);
}
