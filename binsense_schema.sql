-- BinSense Supabase schema and Row Level Security setup.
-- Run this script in the Supabase Dashboard SQL Editor for the BinSense project.

create table if not exists public.users (
    id uuid primary key references auth.users(id) on delete cascade,
    name text,
    email text,
    barangay text,
    role text not null default 'citizen',
    is_disabled boolean not null default false,
    created_at timestamptz not null default now(),
    constraint users_role_check check (role in ('citizen', 'waste collector', 'lgu admin', 'system administrator'))
);

create table if not exists public.bins (
    id text primary key,
    status text not null default 'available',
    barangay text not null default 'Unassigned',
    created_at timestamptz not null default now()
);

alter table public.bins add column if not exists lat double precision;
alter table public.bins add column if not exists lng double precision;
alter table public.bins add column if not exists level int not null default 0;
alter table public.bins add column if not exists volume int not null default 0;
alter table public.bins add column if not exists last_sync timestamptz;
alter table public.bins add column if not exists last_collected timestamptz;

create table if not exists public.user_connected_bins (
    id bigserial primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    bin_id text not null references public.bins(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (user_id, bin_id)
);

create table if not exists public.bin_history (
    bin_id text primary key references public.bins(id) on delete cascade,
    data int[] not null default array[0, 0, 0, 0, 0, 0, 0],
    counts int[] not null default array[0, 0, 0, 0, 0, 0, 0],
    created_at timestamptz not null default now()
);

create table if not exists public.system_logs (
    id bigserial primary key,
    email text,
    role text not null default 'citizen',
    action text not null,
    message text,
    category text not null default 'audit',
    timestamp timestamptz not null default now()
);

create table if not exists public.notifications (
    id bigserial primary key,
    title text not null,
    message text not null,
    type text not null default 'warning',
    barangay text not null default 'Global',
    created_at timestamptz not null default now()
);

alter table public.notifications add column if not exists date date;
alter table public.notifications add column if not exists time time;
alter table public.notifications add column if not exists "scheduleType" text;
alter table public.notifications add column if not exists status text not null default 'unread';

create table if not exists public.active_dispatch (
    id bigint generated always as identity primary key,
    bin_ids text[] not null default array[]::text[],
    dispatched_at timestamptz not null default now(),
    compliance_score int,
    status text not null default 'In Progress'
);

create table if not exists public.collection_logs (
    id bigint generated always as identity primary key,
    bin_id text references public.bins(id) on delete set null,
    barangay text,
    collected_at timestamptz not null default now(),
    waste_level_at_collection int,
    personnel_location jsonb,
    action text not null
);

create table if not exists public.reports (
    id bigint generated always as identity primary key,
    bin_id text references public.bins(id) on delete set null,
    issue text not null,
    timestamp timestamptz not null default now(),
    collector text
);

create table if not exists public.feedbacks (
    id bigserial primary key,
    email text not null,
    rating int not null check (rating between 1 and 5),
    message text not null,
    timestamp timestamptz not null default now()
);

create table if not exists public.incident_reports (
    id bigserial primary key,
    email text not null,
    title text not null,
    description text not null,
    severity text not null default 'Low',
    timestamp timestamptz not null default now(),
    constraint incident_reports_severity_check check (severity in ('Low', 'Medium', 'High', 'Critical'))
);

create index if not exists feedbacks_email_timestamp_idx on public.feedbacks (email, timestamp desc);
create index if not exists incident_reports_email_timestamp_idx on public.incident_reports (email, timestamp desc);
create index if not exists system_logs_timestamp_idx on public.system_logs (timestamp desc);
create index if not exists notifications_barangay_created_at_idx on public.notifications (barangay, created_at desc);

-- Profiles are created by the database, including when email confirmation means
-- the browser does not receive a session immediately after sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.users (id, name, email, role)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'full_name', 'User'),
        new.email,
        case
            when lower(new.email) like '%@binsense.gov.ph' then 'system administrator'
            when lower(new.email) like '%@admin.gov.ph' then 'lgu admin'
            when lower(new.email) like '%@wastemanagement.com' then 'waste collector'
            else 'citizen'
        end
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

-- Auth users cannot be deleted from a browser client. This definer function
-- is intentionally limited to the caller's own authenticated account.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = auth, public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication is required.';
    end if;

    delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function public.delete_own_account() to authenticated;

-- An administrator role is derived from an authenticated user's protected profile row.
create or replace function public.is_system_administrator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.users
        where id = auth.uid()
          and role = 'system administrator'
    );
$$;

grant execute on function public.is_system_administrator() to authenticated;

create or replace function public.has_any_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.users
        where id = auth.uid()
          and role = any(allowed_roles)
    );
$$;

grant execute on function public.has_any_role(text[]) to authenticated;

alter table public.users enable row level security;
alter table public.bins enable row level security;
alter table public.user_connected_bins enable row level security;
alter table public.bin_history enable row level security;
alter table public.system_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.feedbacks enable row level security;
alter table public.incident_reports enable row level security;
alter table public.active_dispatch enable row level security;
alter table public.collection_logs enable row level security;
alter table public.reports enable row level security;

-- Remove the insecure policies from the previous script before adding scoped access.
drop policy if exists "Allow public access to users" on public.users;
drop policy if exists "Allow public access to bins" on public.bins;
drop policy if exists "Allow public access to user_connected_bins" on public.user_connected_bins;
drop policy if exists "Allow public access to bin_history" on public.bin_history;
drop policy if exists "Allow public access to system_logs" on public.system_logs;
drop policy if exists "Allow public access to notifications" on public.notifications;
drop policy if exists "Allow public access to feedbacks" on public.feedbacks;
drop policy if exists "Allow public access to incident_reports" on public.incident_reports;

drop policy if exists "Users read own profile" on public.users;
drop policy if exists "Users create own profile" on public.users;
drop policy if exists "Users update own profile" on public.users;
drop policy if exists "Administrators read all profiles" on public.users;
drop policy if exists "Administrators manage all profiles" on public.users;
create policy "Users read own profile" on public.users
    for select to authenticated using (id = auth.uid());
create policy "Users create own profile" on public.users
    for insert to authenticated with check (
        id = auth.uid()
        and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and role = case
            when lower(email) like '%@binsense.gov.ph' then 'system administrator'
            when lower(email) like '%@admin.gov.ph' then 'lgu admin'
            when lower(email) like '%@wastemanagement.com' then 'waste collector'
            else 'citizen'
        end
    );
create policy "Users update own profile" on public.users
    for update to authenticated using (id = auth.uid()) with check (
        id = auth.uid()
        and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and role = case
            when lower(email) like '%@binsense.gov.ph' then 'system administrator'
            when lower(email) like '%@admin.gov.ph' then 'lgu admin'
            when lower(email) like '%@wastemanagement.com' then 'waste collector'
            else 'citizen'
        end
    );
create policy "Administrators read all profiles" on public.users
    for select to authenticated using (public.is_system_administrator());
create policy "Administrators manage all profiles" on public.users
    for update to authenticated using (public.is_system_administrator()) with check (public.is_system_administrator());

drop policy if exists "Authenticated users read bins" on public.bins;
drop policy if exists "Administrators manage bins" on public.bins;
create policy "Authenticated users read bins" on public.bins
    for select to authenticated using (true);
create policy "Administrators manage bins" on public.bins
    for all to authenticated using (public.is_system_administrator()) with check (public.is_system_administrator());

drop policy if exists "Users manage own connected bins" on public.user_connected_bins;
drop policy if exists "Administrators read connected bins" on public.user_connected_bins;
drop policy if exists "Administrators manage connected bins" on public.user_connected_bins;
create policy "Users manage own connected bins" on public.user_connected_bins
    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Administrators read connected bins" on public.user_connected_bins
    for select to authenticated using (public.is_system_administrator());
create policy "Administrators manage connected bins" on public.user_connected_bins
    for all to authenticated using (public.is_system_administrator()) with check (public.is_system_administrator());

drop policy if exists "Authenticated users read bin history" on public.bin_history;
drop policy if exists "Administrators manage bin history" on public.bin_history;
create policy "Authenticated users read bin history" on public.bin_history
    for select to authenticated using (true);
create policy "Administrators manage bin history" on public.bin_history
    for all to authenticated using (public.is_system_administrator()) with check (public.is_system_administrator());

drop policy if exists "Collectors update assigned bins" on public.bins;
create policy "Collectors update assigned bins" on public.bins
    for update to authenticated
    using (public.has_any_role(array['waste collector']))
    with check (public.has_any_role(array['waste collector']));

drop policy if exists "Authenticated users add own logs" on public.system_logs;
drop policy if exists "Administrators read logs" on public.system_logs;
drop policy if exists "Administrators manage system logs" on public.system_logs;
create policy "Authenticated users add own logs" on public.system_logs
    for insert to authenticated with check (
        lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
create policy "Administrators read logs" on public.system_logs
    for select to authenticated using (public.is_system_administrator());
create policy "Administrators manage system logs" on public.system_logs
    for all to authenticated using (public.is_system_administrator()) with check (public.is_system_administrator());

drop policy if exists "Dispatch participants read dispatches" on public.active_dispatch;
drop policy if exists "LGU administrators manage dispatches" on public.active_dispatch;
create policy "Dispatch participants read dispatches" on public.active_dispatch
    for select to authenticated using (public.has_any_role(array['waste collector', 'lgu admin', 'system administrator']));
create policy "LGU administrators manage dispatches" on public.active_dispatch
    for all to authenticated
    using (public.has_any_role(array['lgu admin', 'system administrator']))
    with check (public.has_any_role(array['lgu admin', 'system administrator']));

drop policy if exists "Collectors add collection logs" on public.collection_logs;
drop policy if exists "Dispatch administrators read collection logs" on public.collection_logs;
create policy "Collectors add collection logs" on public.collection_logs
    for insert to authenticated with check (public.has_any_role(array['waste collector']));
create policy "Dispatch administrators read collection logs" on public.collection_logs
    for select to authenticated using (public.has_any_role(array['waste collector', 'lgu admin', 'system administrator']));

drop policy if exists "Collectors add reports" on public.reports;
drop policy if exists "Dispatch administrators read reports" on public.reports;
create policy "Collectors add reports" on public.reports
    for insert to authenticated with check (public.has_any_role(array['waste collector']));
create policy "Dispatch administrators read reports" on public.reports
    for select to authenticated using (public.has_any_role(array['waste collector', 'lgu admin', 'system administrator']));

drop policy if exists "Authenticated users read notifications" on public.notifications;
drop policy if exists "Collection staff manage collection notifications" on public.notifications;
drop policy if exists "Administrators manage notifications" on public.notifications;
create policy "Authenticated users read notifications" on public.notifications
    for select to authenticated using (true);
create policy "Collection staff manage collection notifications" on public.notifications
    for all to authenticated
    using (
        type = 'collection'
        and public.has_any_role(array['waste collector', 'lgu admin', 'system administrator'])
    )
    with check (
        type = 'collection'
        and public.has_any_role(array['waste collector', 'lgu admin', 'system administrator'])
    );
create policy "Administrators manage notifications" on public.notifications
    for all to authenticated using (public.is_system_administrator()) with check (public.is_system_administrator());

drop policy if exists "Users insert own feedback" on public.feedbacks;
drop policy if exists "Users read own feedback" on public.feedbacks;
drop policy if exists "Administrators read feedback" on public.feedbacks;
drop policy if exists "Administrators manage feedback" on public.feedbacks;
create policy "Users insert own feedback" on public.feedbacks
    for insert to authenticated with check (
        lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
create policy "Users read own feedback" on public.feedbacks
    for select to authenticated using (
        lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
create policy "Administrators read feedback" on public.feedbacks
    for select to authenticated using (public.is_system_administrator());
create policy "Administrators manage feedback" on public.feedbacks
    for all to authenticated using (public.is_system_administrator()) with check (public.is_system_administrator());

drop policy if exists "Users insert own incident reports" on public.incident_reports;
drop policy if exists "Users read own incident reports" on public.incident_reports;
drop policy if exists "Administrators read incident reports" on public.incident_reports;
drop policy if exists "Administrators manage incident reports" on public.incident_reports;
create policy "Users insert own incident reports" on public.incident_reports
    for insert to authenticated with check (
        lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
create policy "Users read own incident reports" on public.incident_reports
    for select to authenticated using (
        lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
create policy "Administrators read incident reports" on public.incident_reports
    for select to authenticated using (public.is_system_administrator());
create policy "Administrators manage incident reports" on public.incident_reports
    for all to authenticated using (public.is_system_administrator()) with check (public.is_system_administrator());