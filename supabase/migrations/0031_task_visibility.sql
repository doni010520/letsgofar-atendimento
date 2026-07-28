-- =====================================================================
-- Visibilidade de tarefas (paridade com o Chatwoot)
--
-- Lá a regra era: admin vê todas; atendente vê só o que criou ou o que
-- está atribuído a ele. Sem isso, todo mundo enxerga a tarefa de todo
-- mundo — o que muda o comportamento e expõe informação.
-- =====================================================================

create or replace function current_profile_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('admin', 'supervisor')
  );
$$;

drop policy if exists tasks_org on public.tasks;

-- Leitura: admin/supervisor vê tudo da organização; demais veem o que
-- criaram ou o que lhes foi atribuído.
create policy tasks_select on public.tasks for select
  using (
    organization_id = current_org_id()
    and (
      current_profile_is_admin()
      or created_by = auth.uid()
      or assigned_to = auth.uid()
    )
  );

-- Criação: qualquer membro da organização pode criar (inclusive para outra
-- pessoa — é assim que o multi-responsável funciona).
create policy tasks_insert on public.tasks for insert
  with check (organization_id = current_org_id());

-- Edição/remoção: mesma régua da leitura.
create policy tasks_update on public.tasks for update
  using (
    organization_id = current_org_id()
    and (current_profile_is_admin() or created_by = auth.uid() or assigned_to = auth.uid())
  );

create policy tasks_delete on public.tasks for delete
  using (
    organization_id = current_org_id()
    and (current_profile_is_admin() or created_by = auth.uid() or assigned_to = auth.uid())
  );

-- Itens, comentários, anexos e etiquetas seguem a visibilidade da tarefa-mãe.
do $$
declare t text;
begin
  foreach t in array array['task_items','task_comments','task_files','task_tags']
  loop
    execute format('drop policy if exists %1$s_org on public.%1$I', t);
    execute format($f$
      create policy %1$s_by_task on public.%1$I for all
        using (
          organization_id = current_org_id()
          and exists (
            select 1 from tasks t
            where t.id = %1$I.task_id
              and (current_profile_is_admin() or t.created_by = auth.uid() or t.assigned_to = auth.uid())
          )
        )
        with check (organization_id = current_org_id())
    $f$, t);
  end loop;
end $$;
