-- BinSense Supabase Schema and Row Level Security Setup
-- Safe to execute directly in the Supabase Dashboard SQL Editor.

-- ============================================================================
-- 1. TABLES & COLUMNS CREATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT,
    email TEXT,
    barangay TEXT,
    role TEXT NOT NULL DEFAULT 'citizen',
    is_disabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_role_check CHECK (role IN ('citizen', 'waste collector', 'lgu admin', 'system administrator'))
);

CREATE TABLE IF NOT EXISTS public.bins (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'available',
    barangay TEXT NOT NULL DEFAULT 'Unassigned',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure all mandatory bin columns exist
ALTER TABLE public.bins ADD COLUMN IF NOT EXISTS barangay TEXT DEFAULT 'Unassigned';
ALTER TABLE public.bins ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE public.bins ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE public.bins ADD COLUMN IF NOT EXISTS level INT NOT NULL DEFAULT 0;
ALTER TABLE public.bins ADD COLUMN IF NOT EXISTS volume INT NOT NULL DEFAULT 0;
ALTER TABLE public.bins ADD COLUMN IF NOT EXISTS last_sync TIMESTAMPTZ;
ALTER TABLE public.bins ADD COLUMN IF NOT EXISTS last_collected TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.user_connected_bins (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bin_id TEXT NOT NULL REFERENCES public.bins(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, bin_id)
);

CREATE TABLE IF NOT EXISTS public.bin_history (
    bin_id TEXT PRIMARY KEY REFERENCES public.bins(id) ON DELETE CASCADE,
    data INT[] NOT NULL DEFAULT ARRAY[0, 0, 0, 0, 0, 0, 0],
    counts INT[] NOT NULL DEFAULT ARRAY[0, 0, 0, 0, 0, 0, 0],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_logs (
    id BIGSERIAL PRIMARY KEY,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'citizen',
    action TEXT NOT NULL,
    message TEXT,
    category TEXT NOT NULL DEFAULT 'audit',
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'warning',
    barangay TEXT NOT NULL DEFAULT 'Global',
    collection_status TEXT NOT NULL DEFAULT 'Scheduled',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS time TIME;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "scheduleType" TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unread';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS collection_status TEXT NOT NULL DEFAULT 'Scheduled';
UPDATE public.notifications SET collection_status = 'Scheduled' WHERE collection_status IS NULL;
ALTER TABLE public.notifications ALTER COLUMN collection_status SET DEFAULT 'Scheduled';
ALTER TABLE public.notifications ALTER COLUMN collection_status SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.active_dispatch (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bin_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    compliance_score INT,
    status TEXT NOT NULL DEFAULT 'In Progress'
);

CREATE TABLE IF NOT EXISTS public.collection_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bin_id TEXT REFERENCES public.bins(id) ON DELETE SET NULL,
    barangay TEXT,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    waste_level_at_collection INT,
    personnel_location JSONB,
    action TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.reports (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bin_id TEXT REFERENCES public.bins(id) ON DELETE SET NULL,
    issue TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    collector TEXT
);

CREATE TABLE IF NOT EXISTS public.feedbacks (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    message TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.incident_reports (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'Low',
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT incident_reports_severity_check CHECK (severity IN ('Low', 'Medium', 'High', 'Critical'))
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS feedbacks_email_timestamp_idx ON public.feedbacks (email, timestamp DESC);
CREATE INDEX IF NOT EXISTS incident_reports_email_timestamp_idx ON public.incident_reports (email, timestamp DESC);
CREATE INDEX IF NOT EXISTS system_logs_timestamp_idx ON public.system_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS notifications_barangay_created_at_idx ON public.notifications (barangay, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_collection_schedule_idx ON public.notifications (date, time)
    WHERE type = 'collection';

-- ============================================================================
-- 2. AUTOMATED FUNCTIONS & TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.users (id, name, email, role)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data ->> 'full_name', 'User'),
        new.email,
        CASE
            WHEN LOWER(new.email) LIKE '%@binsense.gov.ph' THEN 'system administrator'
            WHEN LOWER(new.email) LIKE '%@admin.gov.ph' THEN 'lgu admin'
            WHEN LOWER(new.email) LIKE '%@wastemanagement.com' THEN 'waste collector'
            ELSE 'citizen'
        END
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_system_administrator()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users
        WHERE id = auth.uid()
          AND role = 'system administrator'
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_system_administrator() TO authenticated;

CREATE OR REPLACE FUNCTION public.has_any_role(allowed_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users
        WHERE id = auth.uid()
          AND role = ANY(allowed_roles)
    );
$$;

GRANT EXECUTE ON FUNCTION public.has_any_role(TEXT[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_collection_schedule(p_schedule_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    IF NOT public.has_any_role(ARRAY['waste collector']) THEN
        RAISE EXCEPTION 'Only waste collectors can complete collection schedules.';
    END IF;

    UPDATE public.notifications
    SET collection_status = 'Done'
    WHERE id = p_schedule_id
      AND type = 'collection'
      AND collection_status = 'Scheduled';

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_collection_schedule(BIGINT) TO authenticated;
REVOKE ALL ON FUNCTION public.complete_collection_schedule(BIGINT) FROM PUBLIC;

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_connected_bins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bin_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Clean old/loose policies
DROP POLICY IF EXISTS "Allow public access to users" ON public.users;
DROP POLICY IF EXISTS "Allow public access to bins" ON public.bins;
DROP POLICY IF EXISTS "Allow public access to user_connected_bins" ON public.user_connected_bins;
DROP POLICY IF EXISTS "Allow public access to bin_history" ON public.bin_history;
DROP POLICY IF EXISTS "Allow public access to system_logs" ON public.system_logs;
DROP POLICY IF EXISTS "Allow public access to notifications" ON public.notifications;
DROP POLICY IF EXISTS "Allow public access to feedbacks" ON public.feedbacks;
DROP POLICY IF EXISTS "Allow public access to incident_reports" ON public.incident_reports;

-- Users Table Policies
DROP POLICY IF EXISTS "Users read own profile" ON public.users;
DROP POLICY IF EXISTS "Users create own profile" ON public.users;
DROP POLICY IF EXISTS "Users update own profile" ON public.users;
DROP POLICY IF EXISTS "Administrators read all profiles" ON public.users;
DROP POLICY IF EXISTS "Administrators manage all profiles" ON public.users;

CREATE POLICY "Users read own profile" ON public.users
    FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY "Users create own profile" ON public.users
    FOR INSERT TO authenticated WITH CHECK (
        id = auth.uid()
        AND LOWER(email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
        AND role = CASE
            WHEN LOWER(email) LIKE '%@binsense.gov.ph' THEN 'system administrator'
            WHEN LOWER(email) LIKE '%@admin.gov.ph' THEN 'lgu admin'
            WHEN LOWER(email) LIKE '%@wastemanagement.com' THEN 'waste collector'
            ELSE 'citizen'
        END
    );

CREATE POLICY "Users update own profile" ON public.users
    FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (
        id = auth.uid()
        AND LOWER(email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
        AND role = CASE
            WHEN LOWER(email) LIKE '%@binsense.gov.ph' THEN 'system administrator'
            WHEN LOWER(email) LIKE '%@admin.gov.ph' THEN 'lgu admin'
            WHEN LOWER(email) LIKE '%@wastemanagement.com' THEN 'waste collector'
            ELSE 'citizen'
        END
    );

CREATE POLICY "Administrators read all profiles" ON public.users
    FOR SELECT TO authenticated USING (public.is_system_administrator());

CREATE POLICY "Administrators manage all profiles" ON public.users
    FOR UPDATE TO authenticated USING (public.is_system_administrator()) WITH CHECK (public.is_system_administrator());

-- Bins Table Policies
DROP POLICY IF EXISTS "Authenticated users read bins" ON public.bins;
DROP POLICY IF EXISTS "Administrators manage bins" ON public.bins;
DROP POLICY IF EXISTS "Collectors update assigned bins" ON public.bins;

CREATE POLICY "Authenticated users read bins" ON public.bins
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Administrators manage bins" ON public.bins
    FOR ALL TO authenticated USING (public.is_system_administrator()) WITH CHECK (public.is_system_administrator());

CREATE POLICY "Collectors update assigned bins" ON public.bins
    FOR UPDATE TO authenticated
    USING (public.has_any_role(ARRAY['waste collector']))
    WITH CHECK (public.has_any_role(ARRAY['waste collector']));

-- User Connected Bins Policies
DROP POLICY IF EXISTS "Users manage own connected bins" ON public.user_connected_bins;
DROP POLICY IF EXISTS "Administrators read connected bins" ON public.user_connected_bins;
DROP POLICY IF EXISTS "Administrators manage connected bins" ON public.user_connected_bins;

CREATE POLICY "Users manage own connected bins" ON public.user_connected_bins
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Administrators read connected bins" ON public.user_connected_bins
    FOR SELECT TO authenticated USING (public.is_system_administrator());

CREATE POLICY "Administrators manage connected bins" ON public.user_connected_bins
    FOR ALL TO authenticated USING (public.is_system_administrator()) WITH CHECK (public.is_system_administrator());

-- Bin History Policies
DROP POLICY IF EXISTS "Authenticated users read bin history" ON public.bin_history;
DROP POLICY IF EXISTS "Administrators manage bin history" ON public.bin_history;

CREATE POLICY "Authenticated users read bin history" ON public.bin_history
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Administrators manage bin history" ON public.bin_history
    FOR ALL TO authenticated USING (public.is_system_administrator()) WITH CHECK (public.is_system_administrator());

DROP POLICY IF EXISTS "Users manage history for connected bins" ON public.bin_history;

CREATE POLICY "Users manage history for connected bins" ON public.bin_history
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.user_connected_bins AS connected
            WHERE connected.bin_id = bin_history.bin_id
              AND connected.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.user_connected_bins AS connected
            WHERE connected.bin_id = bin_history.bin_id
              AND connected.user_id = auth.uid()
        )
    );

-- System Logs Policies
DROP POLICY IF EXISTS "Authenticated users add own logs" ON public.system_logs;
DROP POLICY IF EXISTS "Administrators read logs" ON public.system_logs;
DROP POLICY IF EXISTS "Administrators manage system logs" ON public.system_logs;

CREATE POLICY "Authenticated users add own logs" ON public.system_logs
    FOR INSERT TO authenticated WITH CHECK (
        LOWER(email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
    );

CREATE POLICY "Administrators read logs" ON public.system_logs
    FOR SELECT TO authenticated USING (public.is_system_administrator());

CREATE POLICY "Administrators manage system logs" ON public.system_logs
    FOR ALL TO authenticated USING (public.is_system_administrator()) WITH CHECK (public.is_system_administrator());

-- Dispatch Policies
DROP POLICY IF EXISTS "Dispatch participants read dispatches" ON public.active_dispatch;
DROP POLICY IF EXISTS "LGU administrators manage dispatches" ON public.active_dispatch;

CREATE POLICY "Dispatch participants read dispatches" ON public.active_dispatch
    FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['waste collector', 'lgu admin', 'system administrator']));

CREATE POLICY "LGU administrators manage dispatches" ON public.active_dispatch
    FOR ALL TO authenticated
    USING (public.has_any_role(ARRAY['lgu admin', 'system administrator']))
    WITH CHECK (public.has_any_role(ARRAY['lgu admin', 'system administrator']));

-- Collection Logs Policies
DROP POLICY IF EXISTS "Collectors add collection logs" ON public.collection_logs;
DROP POLICY IF EXISTS "Dispatch administrators read collection logs" ON public.collection_logs;

CREATE POLICY "Collectors add collection logs" ON public.collection_logs
    FOR INSERT TO authenticated WITH CHECK (public.has_any_role(ARRAY['waste collector']));

CREATE POLICY "Dispatch administrators read collection logs" ON public.collection_logs
    FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['waste collector', 'lgu admin', 'system administrator']));

-- Reports Policies
DROP POLICY IF EXISTS "Collectors add reports" ON public.reports;
DROP POLICY IF EXISTS "Dispatch administrators read reports" ON public.reports;

CREATE POLICY "Collectors add reports" ON public.reports
    FOR INSERT TO authenticated WITH CHECK (public.has_any_role(ARRAY['waste collector']));

CREATE POLICY "Dispatch administrators read reports" ON public.reports
    FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['waste collector', 'lgu admin', 'system administrator']));

-- Notifications Policies
DROP POLICY IF EXISTS "Authenticated users read notifications" ON public.notifications;
DROP POLICY IF EXISTS "Collection staff manage collection notifications" ON public.notifications;
DROP POLICY IF EXISTS "Administrators manage notifications" ON public.notifications;

CREATE POLICY "Authenticated users read notifications" ON public.notifications
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Collection staff manage collection notifications" ON public.notifications
    FOR ALL TO authenticated
    USING (
        type = 'collection'
        AND public.has_any_role(ARRAY['waste collector', 'lgu admin', 'system administrator'])
    )
    WITH CHECK (
        type = 'collection'
        AND public.has_any_role(ARRAY['waste collector', 'lgu admin', 'system administrator'])
    );

CREATE POLICY "Administrators manage notifications" ON public.notifications
    FOR ALL TO authenticated USING (public.is_system_administrator()) WITH CHECK (public.is_system_administrator());

-- Feedbacks Policies
DROP POLICY IF EXISTS "Users insert own feedback" ON public.feedbacks;
DROP POLICY IF EXISTS "Users read own feedback" ON public.feedbacks;
DROP POLICY IF EXISTS "Administrators read feedback" ON public.feedbacks;
DROP POLICY IF EXISTS "Administrators manage feedback" ON public.feedbacks;

CREATE POLICY "Users insert own feedback" ON public.feedbacks
    FOR INSERT TO authenticated WITH CHECK (
        LOWER(email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
    );

CREATE POLICY "Users read own feedback" ON public.feedbacks
    FOR SELECT TO authenticated USING (
        LOWER(email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
    );

CREATE POLICY "Administrators read feedback" ON public.feedbacks
    FOR SELECT TO authenticated USING (public.is_system_administrator());

CREATE POLICY "Administrators manage feedback" ON public.feedbacks
    FOR ALL TO authenticated USING (public.is_system_administrator()) WITH CHECK (public.is_system_administrator());

-- Incident Reports Policies
DROP POLICY IF EXISTS "Users insert own incident reports" ON public.incident_reports;
DROP POLICY IF EXISTS "Users read own incident reports" ON public.incident_reports;
DROP POLICY IF EXISTS "Administrators read incident reports" ON public.incident_reports;
DROP POLICY IF EXISTS "Administrators manage incident reports" ON public.incident_reports;

CREATE POLICY "Users insert own incident reports" ON public.incident_reports
    FOR INSERT TO authenticated WITH CHECK (
        LOWER(email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
    );

CREATE POLICY "Users read own incident reports" ON public.incident_reports
    FOR SELECT TO authenticated USING (
        LOWER(email) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
    );

CREATE POLICY "Administrators read incident reports" ON public.incident_reports
    FOR SELECT TO authenticated USING (public.is_system_administrator());

CREATE POLICY "Administrators manage incident reports" ON public.incident_reports
    FOR ALL TO authenticated USING (public.is_system_administrator()) WITH CHECK (public.is_system_administrator());

-- ============================================================================
-- 4. REFRESH SCHEMA CACHE
-- ============================================================================
DO $$
DECLARE
    table_name TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        FOREACH table_name IN ARRAY ARRAY[
            'users',
            'bins',
            'bin_history',
            'system_logs',
            'notifications',
            'active_dispatch'
        ]
        LOOP
            IF NOT EXISTS (
                SELECT 1
                FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                  AND schemaname = 'public'
                  AND tablename = table_name
            ) THEN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
            END IF;
        END LOOP;
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';