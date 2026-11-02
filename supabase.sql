-- Katalog Karya Anak: skema sinkron online
-- Cara pakai: Supabase > SQL Editor > New query > tempel seluruh isi file ini > Run.
-- Aman dijalankan lebih dari sekali.

create table if not exists public.anak (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  diubah bigint not null,
  dihapus boolean not null default false
);

create table if not exists public.karya (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  diubah bigint not null,
  dihapus boolean not null default false
);

create index if not exists anak_user_diubah on public.anak (user_id, diubah);
create index if not exists karya_user_diubah on public.karya (user_id, diubah);

-- Setiap akun hanya bisa melihat dan mengubah barisnya sendiri.
alter table public.anak enable row level security;
alter table public.karya enable row level security;

drop policy if exists "anak milik sendiri" on public.anak;
create policy "anak milik sendiri" on public.anak
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "karya milik sendiri" on public.karya;
create policy "karya milik sendiri" on public.karya
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Tempat foto dan rekaman: privat, dan setiap akun hanya bisa mengakses foldernya sendiri.
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists "media milik sendiri" on storage.objects;
create policy "media milik sendiri" on storage.objects
  for all to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
