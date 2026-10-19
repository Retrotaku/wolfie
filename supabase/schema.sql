create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text not null default 'Joueur'
        check (char_length(display_name) between 1 and 10),
    bio text not null default ''
        check (char_length(bio) <= 280),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, bio) on public.profiles to authenticated;

drop policy if exists "Players can read their own profile"
    on public.profiles;
create policy "Players can read their own profile"
    on public.profiles for select
    to authenticated
    using ((select auth.uid()) = id);

drop policy if exists "Players can update their own profile"
    on public.profiles;
create policy "Players can update their own profile"
    on public.profiles for update
    to authenticated
    using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    chosen_name text;
begin
    chosen_name := coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(split_part(new.email, '@', 1), ''),
        'Joueur'
    );
    chosen_name := left(upper(left(chosen_name, 1)) || substr(chosen_name, 2), 10);

    insert into public.profiles (id, display_name)
    values (new.id, chosen_name);

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
    before update on public.profiles
    for each row execute procedure public.set_profile_updated_at();
