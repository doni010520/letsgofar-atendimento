import { Scroll } from "@/components/scroll";
import { PageHeader, Card, Button } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { PREVIEW_MODE } from "@/lib/mock";
import { updateOrg } from "./actions";

export default async function EmpresaPage() {
  const session = PREVIEW_MODE ? null : await getSession();
  const org = session?.organization;

  return (
    <Scroll>
      <PageHeader title="Dados da empresa" subtitle="Informações cadastrais da sua organização." />
      <Card className="max-w-xl">
        <form action={updateOrg} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-soft">Nome da empresa</label>
            <input name="name" defaultValue={org?.name ?? ""} placeholder="Razão social / nome fantasia"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-soft">CNPJ / Documento</label>
            <input name="document" defaultValue={org?.document ?? ""} placeholder="00.000.000/0000-00"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand" />
          </div>
          <Button type="submit">Salvar</Button>
        </form>
      </Card>
    </Scroll>
  );
}
