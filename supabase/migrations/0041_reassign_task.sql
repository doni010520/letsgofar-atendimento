-- =====================================================================
-- Reatribuir tarefa: "Não consigo mudar o responsável pelas tarefas."
--
-- A 0036 já tinha atacado isto e consertou a política de UPDATE. Não bastou,
-- e o motivo é mais sutil: quem barra é a política de SELECT.
--
-- O Postgres, além do WITH CHECK do UPDATE, exige que a linha RESULTANTE
-- continue visível para quem editou — senão a pessoa poderia esconder uma
-- linha de si mesma. `tasks_select` só mostra tarefa de quem é admin, criou ou
-- está atribuído. Quando a atendente passa para outra pessoa uma tarefa que
-- ela NÃO criou, a linha nova deixa de ser dela e some da própria visão: o
-- Postgres recusa com 42501 "new row violates row-level security policy".
-- Comprovado afrouxando só a SELECT numa transação: com ela larga, passa.
--
-- Larguear a SELECT resolveria, mas mudaria a privacidade das tarefas (hoje
-- cada atendente vê só as suas: 500 de 727 para uma, 0 para outra). Isso é
-- decisão de produto, não conserto de bug.
--
-- Então a reatribuição passa a ser uma função SECURITY DEFINER, que confere
-- a permissão EXPLICITAMENTE (a mesma regra do USING) e só então grava. Quem
-- não pode, recebe erro; quem pode, consegue — e continua sem enxergar o que
-- não é seu.
-- =====================================================================

create or replace function public.reassign_task(p_task uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  -- Mesma condição do USING de `tasks_update`: admin, quem criou, ou quem
  -- está com ela agora. Conferida aqui porque o SECURITY DEFINER ignora RLS.
  select organization_id into v_org
    from tasks
   where id = p_task
     and organization_id = current_org_id()
     and (current_profile_is_admin() or created_by = auth.uid() or assigned_to = auth.uid());

  if v_org is null then
    raise exception 'Sem permissão para mudar o responsável desta tarefa.'
      using errcode = '42501';
  end if;

  -- Destino tem que ser da MESMA organização (nulo = deixar sem responsável).
  if p_to is not null and not exists (
    select 1 from profiles where id = p_to and organization_id = v_org
  ) then
    raise exception 'Responsável não pertence a esta organização.'
      using errcode = '42501';
  end if;

  update tasks set assigned_to = p_to where id = p_task;
end
$$;

revoke all on function public.reassign_task(uuid, uuid) from public;
grant execute on function public.reassign_task(uuid, uuid) to authenticated;
