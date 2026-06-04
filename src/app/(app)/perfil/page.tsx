import { Scroll } from "@/components/scroll";
import { PageHeader, Card, Button } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { PREVIEW_MODE } from "@/lib/mock";
import { updateOwnProfile } from "./actions";

const ROLE_LABEL: Record<string, string> = { admin: "Administrador", supervisor: "Supervisor", agent: "Atendente" };

export default async function PerfilPage() {
  const session = PREVIEW_MODE ? null : await getSession();
  const p = session?.profile;

  return (
    <Scroll>
      <PageHeader title="Meu perfil" subtitle="Seus dados pessoais e preferências." />
      <Card className="max-w-xl">
        <form action={updateOwnProfile} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-soft">Nome</label>
            <input name="name" defaultValue={p?.name ?? ""} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">E-mail</label>
              <input value={p?.email ?? ""} disabled className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-ink-soft" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Nível de acesso</label>
              <input value={ROLE_LABEL[p?.role ?? "agent"] ?? ""} disabled className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-ink-soft" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">WhatsApp</label>
              <input name="whatsapp" defaultValue={p?.whatsapp ?? ""} placeholder="DDD + número" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Status</label>
              <select name="status" defaultValue={p?.status ?? "offline"} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand">
                <option value="online">Online</option>
                <option value="away">Ausente</option>
                <option value="offline">Offline</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="notify" defaultChecked={p?.notify ?? true} className="h-4 w-4 rounded border-gray-300" />
            Receber notificações
          </label>
          <div className="pt-1">
            <Button type="submit">Salvar</Button>
          </div>
        </form>
      </Card>

      {/* 2FA */}
      <Card className="mt-4 max-w-xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink">Autenticação em dois fatores (2FA)</h3>
            <p className="text-xs text-ink-soft">Adicione uma camada extra de segurança à sua conta.</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${p?.totp_enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-ink-soft"}`}>
            {p?.totp_enabled ? "2FA ON" : "Desativado"}
          </span>
        </div>
        <p className="mt-3 text-xs text-ink-soft">
          {p?.totp_enabled
            ? "A autenticação em dois fatores está ativa. Use seu aplicativo de autenticação para gerar códigos."
            : "A configuração de 2FA via aplicativo autenticador (TOTP) estará disponível em breve."}
        </p>
      </Card>
    </Scroll>
  );
}
