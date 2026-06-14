import { Scroll } from "@/components/scroll";
import { PageHeader } from "@/components/ui";
import { FinanceClient } from "@/components/finance-client";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";
import type { Invoice } from "@/lib/types";

async function getInvoices(): Promise<Invoice[]> {
  if (PREVIEW_MODE) return [];
  const sb = await createClient();
  const { data } = await sb.from("invoices").select("*").order("due_date", { ascending: false, nullsFirst: false });
  return (data as Invoice[]) ?? [];
}

export default async function FinanceiroPage() {
  const invoices = await getInvoices();
  return (
    <Scroll>
      <PageHeader title="Financeiro" subtitle="Acompanhe e gerencie suas faturas." />
      <FinanceClient invoices={invoices} />
    </Scroll>
  );
}
