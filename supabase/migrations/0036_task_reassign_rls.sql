-- Corrige: não dava para reatribuir uma tarefa para OUTRA pessoa.
--
-- `tasks_update` (0031) não tinha WITH CHECK próprio, então o Postgres
-- reaproveita o USING — e o USING é reavaliado na linha NOVA, depois da
-- mudança. Um atendente com `assigned_to = ele` reatribuindo para um
-- terceiro produz uma linha onde nem `created_by` nem `assigned_to` são
-- mais ele: a própria atualização deixa de satisfazer sua condição de
-- acesso, e o Postgres a rejeita em silêncio. Zero erro, zero linha
-- afetada — exatamente "tentei mudar e não mudou nada".
--
-- USING continua controlando QUEM pode mexer (admin, quem criou, quem está
-- atribuído agora). WITH CHECK passa a exigir só que a linha resultante
-- continue na mesma organização — não que quem editou continue amarrado
-- a ela.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (
    organization_id = current_org_id()
    and (current_profile_is_admin() or created_by = auth.uid() or assigned_to = auth.uid())
  )
  with check (
    organization_id = current_org_id()
  );
