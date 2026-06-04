"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import type { OrgSettings } from "@/lib/types";

/** Salva TODAS as configurações da organização de uma vez (merge com settings existente). */
export async function saveSettings(fd: FormData) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Configure o Supabase.");
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  const bool = (k: string) => fd.get(k) === "on";
  const str = (k: string) => {
    const v = String(fd.get(k) || "").trim();
    return v || undefined;
  };
  const num = (k: string) => {
    const v = parseFloat(String(fd.get(k) || ""));
    return Number.isNaN(v) ? undefined : v;
  };

  const patch: OrgSettings = {
    // Geral
    identify_agent: bool("identify_agent"),
    close_command: str("close_command"),
    close_command_message: str("close_command_message"),
    allow_agent_reconnect: bool("allow_agent_reconnect"),
    timezone_offset: num("timezone_offset"),
    // Atendimento
    auto_close_company_min: num("auto_close_company_min"),
    auto_close_client_min: num("auto_close_client_min"),
    auto_close_queue: bool("auto_close_queue"),
    auto_transfer_company_min: num("auto_transfer_company_min"),
    auto_transfer_client_min: num("auto_transfer_client_min"),
    auto_transfer_dept_id: str("auto_transfer_dept_id"),
    require_classification: (str("require_classification") as OrgSettings["require_classification"]) ?? "never",
    require_close_reason: bool("require_close_reason"),
    csat_policy: (str("csat_policy") as OrgSettings["csat_policy"]) ?? "optional_on",
    search_mode: (str("search_mode") as OrgSettings["search_mode"]) ?? "all",
    transfer_idle: (str("transfer_idle") as OrgSettings["transfer_idle"]) ?? "none",
    distribute_least_loaded: bool("distribute_least_loaded"),
    auto_send_assign_msg: bool("auto_send_assign_msg"),
    transfer_online_only: bool("transfer_online_only"),
    away_msg_interval_min: num("away_msg_interval_min"),
    read_confirmation: bool("read_confirmation"),
    block_return_to_bot: bool("block_return_to_bot"),
    allow_company_start: bool("allow_company_start"),
    show_tags_on_card: bool("show_tags_on_card"),
    // Chat V2
    v2_order_by: (str("v2_order_by") as OrgSettings["v2_order_by"]) ?? "last_message",
    v2_block_unassigned: bool("v2_block_unassigned"),
    v2_auto_transcribe: bool("v2_auto_transcribe"),
    v2_recurrence_enabled: bool("v2_recurrence_enabled"),
    v2_recurrence_days: num("v2_recurrence_days"),
    v2_recurrence_low: num("v2_recurrence_low"),
    v2_recurrence_medium: num("v2_recurrence_medium"),
    v2_recurrence_high: num("v2_recurrence_high"),
    v2_queue_alert_count: num("v2_queue_alert_count"),
    v2_queue_alert_min: num("v2_queue_alert_min"),
    v2_queue_alert_popup: bool("v2_queue_alert_popup"),
    v2_queue_alert_sound: bool("v2_queue_alert_sound"),
    v2_sidebar_collapsed: bool("v2_sidebar_collapsed"),
    v2_show_channel_on_card: bool("v2_show_channel_on_card"),
    v2_color_no_interaction: bool("v2_color_no_interaction"),
    // Permissões
    v2_mask_cpf: bool("v2_mask_cpf"),
    v2_only_v2: bool("v2_only_v2"),
    v2_agent_see_closed: bool("v2_agent_see_closed"),
    v2_hide_dashboard_agents: bool("v2_hide_dashboard_agents"),
    v2_agent_close_queue: bool("v2_agent_close_queue"),
    v2_agent_bulk_close: bool("v2_agent_bulk_close"),
    v2_agent_manage_clients: bool("v2_agent_manage_clients"),
    v2_hide_contact_agents: bool("v2_hide_contact_agents"),
  };

  // Merge com settings existente (preserva chaves que não estão no form, como csat.message).
  const existing = (session.organization.settings ?? {}) as Record<string, unknown>;
  const merged = { ...existing, ...patch };

  const { error } = await sb.from("organizations").update({ settings: merged }).eq("id", session.organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/ajustes/configuracoes");
}
