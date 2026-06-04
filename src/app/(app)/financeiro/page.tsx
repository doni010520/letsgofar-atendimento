import { Scroll } from "@/components/scroll";
import { PageHeader, Card, EmptyState } from "@/components/ui";

export default function FinanceiroPage() {
  return (
    <Scroll>
      <PageHeader title="Financeiro" subtitle="Faturas, assinatura e pagamentos." />
      <Card className="py-12">
        <EmptyState title="Módulo em breve" hint="O gerenciamento financeiro (faturas, planos, cobranças) estará disponível em uma próxima versão." />
      </Card>
    </Scroll>
  );
}
