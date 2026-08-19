-- À exécuter dans l'éditeur SQL Supabase (rôle postgres).
-- Ajoute parent_id pour les réponses du fil Communauté (1 niveau : message + réponses).
-- Les messages existants restent des messages principaux (parent_id NULL).

alter table public.community_posts
  add column if not exists parent_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'community_posts_parent_id_fkey'
  ) then
    alter table public.community_posts
      add constraint community_posts_parent_id_fkey
      foreign key (parent_id)
      references public.community_posts (id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'community_posts_parent_not_self'
  ) then
    alter table public.community_posts
      add constraint community_posts_parent_not_self
      check (parent_id is distinct from id);
  end if;
end $$;

create index if not exists community_posts_parent_id_idx
  on public.community_posts (parent_id, created_at);

-- Si une réponse vise une autre réponse, on la rattache au message principal.
create or replace function public.community_posts_flatten_parent()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  walked_id uuid;
  parent_of uuid;
  guard integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;

  walked_id := new.parent_id;
  loop
    select p.parent_id into parent_of
    from public.community_posts p
    where p.id = walked_id;

    exit when parent_of is null;
    walked_id := parent_of;
    guard := guard + 1;
    if guard > 20 then
      raise exception 'parent_id cycle detected';
    end if;
  end loop;

  new.parent_id := walked_id;
  return new;
end;
$$;

drop trigger if exists community_posts_flatten_parent on public.community_posts;
create trigger community_posts_flatten_parent
  before insert or update of parent_id on public.community_posts
  for each row execute procedure public.community_posts_flatten_parent();
