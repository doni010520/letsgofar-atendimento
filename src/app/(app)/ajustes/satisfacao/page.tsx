import Link from "next/link";
import { ArrowLeft, Star } from "lucide-react";
import { Scroll } from "@/components/scroll";
import { PageHeader } from "@/components/ui";
import { CrudManager, type CrudField } from "@/components/crud-manager";
import { getSurveys } from "@/lib/data/management";
import { createSurvey, updateSurvey, deleteSurvey } from "./actions";

const FIELDS: CrudField[] = [
  { name: "name", label: "Nome", placeholder: "Ex.: Pesquisa de satisfação", required: true, inList: true },
  { name: "question", label: "Pergunta", placeholder: "De 1 a 5, como você avalia o nosso atendimento?", type: "textarea" },
  {
    name: "scale_type", label: "Tipo de escala", type: "select",
    options: [{ value: "stars", label: "Estrelas (1–5)" }, { value: "buttons", label: "Botões (1–5)" }],
  },
  { name: "close_after_min", label: "Encerrar após (minutos)", placeholder: "30", type: "number" },
  { name: "active", label: "Ativa", type: "checkbox" },
];

export default async function SatisfacaoPage() {
  const surveys = await getSurveys();

  return (
    <Scroll>
      <Link href="/ajustes" className="mt-4 inline-flex items-center gap-1 text-sm text-brand hover:underline">
        <ArrowLeft size={15} /> Ajustes
      </Link>
      <PageHeader
        title="Pesquisa de Satisfação"
        subtitle="Colha informações valiosas sobre o atendimento da sua empresa!"
      />
      <CrudManager
        items={surveys.map((s) => ({
          ...s,
          _subtitle: `${s.active ? "Ativado" : "Desativado"} · Encerra em ${s.close_after_min} min · ${s.scale_type === "stars" ? "Estrelas" : "Botões"}`,
        }))}
        fields={FIELDS}
        createAction={createSurvey}
        updateAction={updateSurvey}
        deleteAction={deleteSurvey}
        addLabel="Cadastrar pesquisa"
        emptyTitle="Nenhuma pesquisa cadastrada"
      />
    </Scroll>
  );
}
