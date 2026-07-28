import { Scroll } from "@/components/scroll";
import { PageHeader } from "@/components/ui";
import { TasksClient } from "@/components/tasks-client";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
  recurrence_type: string;
  assigned_to: string | null;
  created_by: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  created_at: string;
  task_items?: { id: string; title: string; completed: boolean; position: number }[];
  task_comments?: { id: string; content: string; created_at: string; profile_id: string | null }[];
  task_files?: { id: string; filename: string; path: string; byte_size: number | null }[];
  task_tags?: { tag_id: string }[];
};

async function getTasks(): Promise<TaskRow[]> {
  if (PREVIEW_MODE) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("tasks")
    .select("*, task_items(id, title, completed, position), task_comments(id, content, created_at, profile_id), task_files(id, filename, path, byte_size), task_tags(tag_id)")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  return (data as TaskRow[]) ?? [];
}

async function getAgents(): Promise<{ id: string; name: string | null }[]> {
  if (PREVIEW_MODE) return [];
  const sb = await createClient();
  const { data } = await sb.from("profiles").select("id, name").order("name");
  return (data as { id: string; name: string | null }[]) ?? [];
}

async function getTags(): Promise<{ id: string; name: string; color: string | null }[]> {
  if (PREVIEW_MODE) return [];
  const sb = await createClient();
  const { data } = await sb.from("tags").select("id, name, color").order("name");
  return (data as { id: string; name: string; color: string | null }[]) ?? [];
}

export default async function TarefasPage() {
  const [tasks, agents, tags] = await Promise.all([getTasks(), getAgents(), getTags()]);
  return (
    <Scroll>
      <PageHeader
        title="Tarefas"
        subtitle="Tarefas da equipe com checklist, prazo, recorrência e vários responsáveis."
      />
      <TasksClient tasks={tasks} agents={agents} tags={tags} />
    </Scroll>
  );
}
