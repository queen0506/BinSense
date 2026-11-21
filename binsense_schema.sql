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

CREATE TABLE IF NOT EXISTS public.bin_sensor_readings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bin_id TEXT,
    bin_id_snapshot TEXT NOT NULL,
    hardware_id TEXT NOT NULL,
    fill_level SMALLINT NOT NULL,
    distance_cm DOUBLE PRECISION,
    status TEXT,
    recorded_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sensor_sequence TEXT,
    source TEXT NOT NULL DEFAULT 'esp32',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bin_sensor_readings_bin_fk
        FOREIGN KEY (bin_id)
        REFERENCES public.bins(id)
        ON DELETE SET NULL,
    CONSTRAINT bin_sensor_readings_fill_level_check
        CHECK (fill_level BETWEEN 0 AND 100),
    CONSTRAINT bin_sensor_readings_distance_check
        CHECK (distance_cm IS NULL OR distance_cm >= 0),
    CONSTRAINT bin_sensor_readings_status_check
        CHECK (
            status IS NULL
            OR LOWER(status) IN ('available', 'filling', 'full')
        )
);

COMMENT ON TABLE public.bin_sensor_readings IS
    'Append-only ESP32 telemetry history. Reading rows are retained when a bin is deleted.';

COMMENT ON COLUMN public.bin_sensor_readings.recorded_at IS
    'Server receipt timestamp used by this RPC. It is not proof of ESP32 sampling time.';

COMMENT ON COLUMN public.bin_sensor_readings.sensor_sequence IS
    'Optional future ESP32 or Edge Function idempotency sequence. It is not present in the confirmed current payload.';

CREATE UNIQUE INDEX IF NOT EXISTS bin_sensor_readings_sequence_idx
    ON public.bin_sensor_readings (bin_id, hardware_id, sensor_sequence)
    WHERE sensor_sequence IS NOT NULL;

CREATE INDEX IF NOT EXISTS bin_sensor_readings_bin_recorded_idx
    ON public.bin_sensor_readings (bin_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS bin_sensor_readings_hardware_recorded_idx
    ON public.bin_sensor_readings (hardware_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS bin_sensor_readings_recorded_idx
    ON public.bin_sensor_readings (recorded_at DESC);

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
    collector TEXT,
    status TEXT NOT NULL DEFAULT 'Pending'
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

ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pending';
ALTER TABLE public.incident_reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pending';
ALTER TABLE public.incident_reports ADD COLUMN IF NOT EXISTS bin_id TEXT REFERENCES public.bins(id) ON DELETE SET NULL;
ALTER TABLE public.incident_reports ADD COLUMN IF NOT EXISTS location TEXT;
GRANT UPDATE (status) ON public.reports, public.incident_reports TO authenticated;

CREATE TABLE IF NOT EXISTS public.lgu_admin_notifications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id BIGINT REFERENCES public.reports(id) ON DELETE CASCADE,
    incident_report_id BIGINT REFERENCES public.incident_reports(id) ON DELETE CASCADE,
    recipient_role TEXT NOT NULL DEFAULT 'lgu admin' CHECK (recipient_role = 'lgu admin'),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    submitter_name TEXT NOT NULL,
    bin_id TEXT,
    location TEXT,
    incident_status TEXT NOT NULL DEFAULT 'Pending',
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT lgu_admin_notifications_single_report_check
        CHECK ((report_id IS NOT NULL) <> (incident_report_id IS NOT NULL))
);

ALTER TABLE public.lgu_admin_notifications
    ADD COLUMN IF NOT EXISTS incident_status TEXT NOT NULL DEFAULT 'Pending';

CREATE UNIQUE INDEX IF NOT EXISTS lgu_admin_notifications_report_id_idx
    ON public.lgu_admin_notifications (report_id) WHERE report_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lgu_admin_notifications_incident_report_id_idx
    ON public.lgu_admin_notifications (incident_report_id) WHERE incident_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lgu_admin_notifications_unread_idx
    ON public.lgu_admin_notifications (created_at DESC) WHERE is_read = false;
REVOKE ALL ON public.lgu_admin_notifications FROM anon, authenticated;
GRANT SELECT ON public.lgu_admin_notifications TO authenticated;
GRANT UPDATE (is_read) ON public.lgu_admin_notifications TO authenticated;

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

CREATE OR REPLACE FUNCTION public.notify_lgu_admin_of_collection_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    reporter_name TEXT;
    reporter_email TEXT;
    report_location TEXT;
BEGIN
    SELECT name, email
    INTO reporter_name, reporter_email
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'waste collector';

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT barangay
    INTO report_location
    FROM public.bins
    WHERE id = NEW.bin_id;

    INSERT INTO public.lgu_admin_notifications (
        report_id, title, message, submitter_name, bin_id, location, incident_status, created_at
    )
    VALUES (
        NEW.id,
        'Collection issue reported',
        format(
            '%s · Reported by %s (%s)%s%s',
            NEW.issue,
            COALESCE(NULLIF(reporter_name, ''), 'Collection personnel'),
            COALESCE(reporter_email, NEW.collector, 'unknown'),
            CASE WHEN NEW.bin_id IS NOT NULL THEN ' · Bin ' || NEW.bin_id ELSE '' END,
            CASE WHEN report_location IS NOT NULL THEN ' · ' || report_location ELSE '' END
        ),
        COALESCE(NULLIF(reporter_name, ''), 'Collection personnel'),
        NEW.bin_id,
        report_location,
        NEW.status,
        NEW.timestamp
    )
    ON CONFLICT DO NOTHING;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Could not create LGU notification for collection report %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_lgu_admin_of_incident_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    reporter_name TEXT;
    report_location TEXT;
BEGIN
    SELECT name
    INTO reporter_name
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'waste collector';

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    report_location := NEW.location;
    IF report_location IS NULL AND NEW.bin_id IS NOT NULL THEN
        SELECT barangay
        INTO report_location
        FROM public.bins
        WHERE id = NEW.bin_id;
    END IF;

    INSERT INTO public.lgu_admin_notifications (
        incident_report_id, title, message, submitter_name, bin_id, location, incident_status, created_at
    )
    VALUES (
        NEW.id,
        NEW.title,
        format(
            '%s · Reported by %s%s%s',
            LEFT(COALESCE(NULLIF(NEW.description, ''), 'No description provided'), 180),
            COALESCE(NULLIF(reporter_name, ''), NEW.email),
            CASE WHEN NEW.bin_id IS NOT NULL THEN ' · Bin ' || NEW.bin_id ELSE '' END,
            CASE WHEN report_location IS NOT NULL THEN ' · ' || report_location ELSE '' END
        ),
        COALESCE(NULLIF(reporter_name, ''), NEW.email),
        NEW.bin_id,
        report_location,
        NEW.status,
        NEW.timestamp
    )
    ON CONFLICT DO NOTHING;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Could not create LGU notification for incident report %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_report_lgu_notification ON public.reports;
CREATE TRIGGER collection_report_lgu_notification
    AFTER INSERT ON public.reports
    FOR EACH ROW EXECUTE FUNCTION public.notify_lgu_admin_of_collection_report();

DROP TRIGGER IF EXISTS incident_report_lgu_notification ON public.incident_reports;
CREATE TRIGGER incident_report_lgu_notification
    AFTER INSERT ON public.incident_reports
    FOR EACH ROW EXECUTE FUNCTION public.notify_lgu_admin_of_incident_report();

CREATE OR REPLACE FUNCTION public.sync_lgu_collection_report_notification_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        UPDATE public.lgu_admin_notifications
        SET incident_status = NEW.status
        WHERE report_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_lgu_incident_report_notification_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        UPDATE public.lgu_admin_notifications
        SET incident_status = NEW.status
        WHERE incident_report_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_report_notification_status_sync ON public.reports;
CREATE TRIGGER collection_report_notification_status_sync
    AFTER UPDATE OF status ON public.reports
    FOR EACH ROW EXECUTE FUNCTION public.sync_lgu_collection_report_notification_status();

DROP TRIGGER IF EXISTS incident_report_notification_status_sync ON public.incident_reports;
CREATE TRIGGER incident_report_notification_status_sync
    AFTER UPDATE OF status ON public.incident_reports
    FOR EACH ROW EXECUTE FUNCTION public.sync_lgu_incident_report_notification_status();

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
ALTER TABLE public.bin_sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lgu_admin_notifications ENABLE ROW LEVEL SECURITY;
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

-- Bin Sensor Readings Policies
DROP POLICY IF EXISTS "Citizens read connected bin sensor readings" ON public.bin_sensor_readings;
DROP POLICY IF EXISTS "LGU administrators read sensor readings" ON public.bin_sensor_readings;
DROP POLICY IF EXISTS "System administrators read sensor readings" ON public.bin_sensor_readings;

CREATE POLICY "Citizens read connected bin sensor readings"
    ON public.bin_sensor_readings
    FOR SELECT TO authenticated
    USING (
        bin_id IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.user_connected_bins AS connected
            WHERE connected.user_id = auth.uid()
              AND connected.bin_id = bin_sensor_readings.bin_id
        )
    );

CREATE POLICY "LGU administrators read sensor readings"
    ON public.bin_sensor_readings
    FOR SELECT TO authenticated
    USING (public.has_any_role(ARRAY['lgu admin']));

CREATE POLICY "System administrators read sensor readings"
    ON public.bin_sensor_readings
    FOR SELECT TO authenticated
    USING (public.is_system_administrator());

REVOKE ALL ON TABLE public.bin_sensor_readings FROM anon, authenticated;
GRANT SELECT ON TABLE public.bin_sensor_readings TO authenticated;

CREATE OR REPLACE FUNCTION public.record_bin_sensor_reading(
    p_hardware_id TEXT,
    p_distance_cm DOUBLE PRECISION,
    p_fill_level INTEGER,
    p_status TEXT DEFAULT NULL,
    p_sensor_sequence TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_bin_id TEXT;
    v_reading_id BIGINT;
    v_recorded_at TIMESTAMPTZ := clock_timestamp();
    v_bin_update_count INTEGER;
    v_device_update_count INTEGER;
BEGIN
    IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'Only the authorized server-side service role may record sensor telemetry';
    END IF;

    IF p_hardware_id IS NULL OR BTRIM(p_hardware_id) = '' THEN
        RAISE EXCEPTION 'hardware_id is required';
    END IF;

    IF p_fill_level IS NULL OR p_fill_level NOT BETWEEN 0 AND 100 THEN
        RAISE EXCEPTION 'fill_level must be between 0 and 100';
    END IF;

    IF p_distance_cm IS NOT NULL AND p_distance_cm < 0 THEN
        RAISE EXCEPTION 'distance_cm must not be negative';
    END IF;

    IF p_status IS NOT NULL
       AND LOWER(p_status) NOT IN ('available', 'filling', 'full') THEN
        RAISE EXCEPTION 'invalid bin status';
    END IF;

    SELECT device.bin_id
    INTO v_bin_id
    FROM public.bin_devices AS device
    WHERE device.hardware_id = p_hardware_id
      AND device.enabled = TRUE
    FOR UPDATE OF device;

    IF v_bin_id IS NULL THEN
        RAISE EXCEPTION 'hardware_id is not paired to an active bin';
    END IF;

    INSERT INTO public.bin_sensor_readings (
        bin_id,
        bin_id_snapshot,
        hardware_id,
        fill_level,
        distance_cm,
        status,
        recorded_at,
        received_at,
        sensor_sequence,
        source
    )
    VALUES (
        v_bin_id,
        v_bin_id,
        p_hardware_id,
        p_fill_level,
        p_distance_cm,
        p_status,
        v_recorded_at,
        v_recorded_at,
        p_sensor_sequence,
        'esp32'
    )
    ON CONFLICT (bin_id, hardware_id, sensor_sequence)
        WHERE sensor_sequence IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_reading_id;

    IF p_sensor_sequence IS NOT NULL THEN
        IF v_reading_id IS NULL THEN
            SELECT reading.id
            INTO v_reading_id
            FROM public.bin_sensor_readings AS reading
            WHERE reading.bin_id = v_bin_id
              AND reading.hardware_id = p_hardware_id
              AND reading.sensor_sequence = p_sensor_sequence
            LIMIT 1;

            IF v_reading_id IS NULL THEN
                RAISE EXCEPTION 'Unable to resolve duplicate sensor sequence';
            END IF;

            RETURN v_reading_id;
        END IF;
    END IF;

    UPDATE public.bins
    SET
        level = p_fill_level,
        status = COALESCE(p_status, status),
        last_sync = v_recorded_at
    WHERE id = v_bin_id;
    GET DIAGNOSTICS v_bin_update_count = ROW_COUNT;

    IF v_bin_update_count <> 1 THEN
        RAISE EXCEPTION 'Expected to update exactly one paired bin, updated %', v_bin_update_count;
    END IF;

    UPDATE public.bin_devices
    SET last_seen_at = v_recorded_at
    WHERE hardware_id = p_hardware_id
      AND bin_id = v_bin_id;
    GET DIAGNOSTICS v_device_update_count = ROW_COUNT;

    IF v_device_update_count <> 1 THEN
        RAISE EXCEPTION 'Expected to update exactly one paired device, updated %', v_device_update_count;
    END IF;

    RETURN v_reading_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_bin_sensor_reading(
    TEXT,
    DOUBLE PRECISION,
    INTEGER,
    TEXT,
    TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_bin_sensor_reading(
    TEXT,
    DOUBLE PRECISION,
    INTEGER,
    TEXT,
    TEXT
) FROM anon;
REVOKE ALL ON FUNCTION public.record_bin_sensor_reading(
    TEXT,
    DOUBLE PRECISION,
    INTEGER,
    TEXT,
    TEXT
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_bin_sensor_reading(
    TEXT,
    DOUBLE PRECISION,
    INTEGER,
    TEXT,
    TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_bin_sensor_reading_averages(
    p_bin_id TEXT,
    p_granularity TEXT,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ
)
RETURNS TABLE (
    bucket_start TIMESTAMPTZ,
    average_fill_level NUMERIC,
    reading_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required';
    END IF;

    IF p_granularity NOT IN ('hour', 'day') THEN
        RAISE EXCEPTION 'Invalid aggregation granularity';
    END IF;

    IF p_bin_id IS NULL OR BTRIM(p_bin_id) = '' THEN
        RAISE EXCEPTION 'bin_id is required';
    END IF;

    IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
        RAISE EXCEPTION 'Invalid aggregation period';
    END IF;

    IF p_end - p_start > INTERVAL '31 days' THEN
        RAISE EXCEPTION 'Aggregation period cannot exceed 31 days';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.user_connected_bins AS connected
        WHERE connected.user_id = auth.uid()
          AND connected.bin_id = p_bin_id
    ) THEN
        RAISE EXCEPTION 'Bin is not connected to the authenticated citizen';
    END IF;

    RETURN QUERY
    WITH grouped AS (
        SELECT
            CASE
                WHEN p_granularity = 'hour'
                    THEN pg_catalog.date_trunc(
                        'hour',
                        pg_catalog.timezone('Asia/Manila', reading.recorded_at)
                    )
                ELSE pg_catalog.date_trunc(
                    'day',
                    pg_catalog.timezone('Asia/Manila', reading.recorded_at)
                )
            END AS bucket_local,
            pg_catalog.round(
                pg_catalog.avg(reading.fill_level)::NUMERIC,
                2
            ) AS bucket_average,
            pg_catalog.count(*) AS bucket_count
        FROM public.bin_sensor_readings AS reading
        WHERE reading.bin_id = p_bin_id
          AND reading.recorded_at >= p_start
          AND reading.recorded_at < p_end
        GROUP BY 1
    )
    SELECT
        (grouped.bucket_local AT TIME ZONE 'Asia/Manila') AS bucket_start,
        grouped.bucket_average AS average_fill_level,
        grouped.bucket_count AS reading_count
    FROM grouped
    ORDER BY bucket_start;
END;
$$;

REVOKE ALL ON FUNCTION public.get_bin_sensor_reading_averages(
    TEXT,
    TEXT,
    TIMESTAMPTZ,
    TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_bin_sensor_reading_averages(
    TEXT,
    TEXT,
    TIMESTAMPTZ,
    TIMESTAMPTZ
) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_bin_sensor_reading_averages(
    TEXT,
    TEXT,
    TIMESTAMPTZ,
    TIMESTAMPTZ
) TO authenticated;

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
DROP POLICY IF EXISTS "Report owners and administrators read reports" ON public.reports;

CREATE POLICY "Collectors add reports" ON public.reports
    FOR INSERT TO authenticated WITH CHECK (
        public.has_any_role(ARRAY['waste collector'])
        AND LOWER(collector) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
    );

CREATE POLICY "Report owners and administrators read reports" ON public.reports
    FOR SELECT TO authenticated
    USING (
        (
            public.has_any_role(ARRAY['waste collector'])
            AND LOWER(collector) = LOWER(COALESCE(auth.jwt() ->> 'email', ''))
        )
        OR public.has_any_role(ARRAY['lgu admin', 'system administrator'])
    );

DROP POLICY IF EXISTS "LGU administrators update report status" ON public.reports;
CREATE POLICY "LGU administrators update report status" ON public.reports
    FOR UPDATE TO authenticated
    USING (public.has_any_role(ARRAY['lgu admin']))
    WITH CHECK (public.has_any_role(ARRAY['lgu admin']));

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

-- LGU incident notifications share read state across LGU modules.
DROP POLICY IF EXISTS "LGU administrators read incident notifications" ON public.lgu_admin_notifications;
DROP POLICY IF EXISTS "LGU administrators update incident notification read state" ON public.lgu_admin_notifications;

CREATE POLICY "LGU administrators read incident notifications" ON public.lgu_admin_notifications
    FOR SELECT TO authenticated
    USING (
        recipient_role = 'lgu admin'
        AND public.has_any_role(ARRAY['lgu admin'])
    );

CREATE POLICY "LGU administrators update incident notification read state" ON public.lgu_admin_notifications
    FOR UPDATE TO authenticated
    USING (
        recipient_role = 'lgu admin'
        AND public.has_any_role(ARRAY['lgu admin'])
    )
    WITH CHECK (
        recipient_role = 'lgu admin'
        AND public.has_any_role(ARRAY['lgu admin'])
    );

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
DROP POLICY IF EXISTS "LGU administrators read incident reports" ON public.incident_reports;
DROP POLICY IF EXISTS "LGU administrators update incident report status" ON public.incident_reports;

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

CREATE POLICY "LGU administrators read incident reports" ON public.incident_reports
    FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['lgu admin']));

CREATE POLICY "LGU administrators update incident report status" ON public.incident_reports
    FOR UPDATE TO authenticated
    USING (public.has_any_role(ARRAY['lgu admin']))
    WITH CHECK (public.has_any_role(ARRAY['lgu admin']));

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
            'lgu_admin_notifications',
            'reports',
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