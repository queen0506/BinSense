BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_bin_peaks (
    reading_date date NOT NULL,
    bin_id text NOT NULL,
    peak_level integer NOT NULL CHECK (peak_level BETWEEN 0 AND 100),
    reached_full boolean NOT NULL,
    PRIMARY KEY (reading_date, bin_id)
);

ALTER TABLE public.daily_bin_peaks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_bin_peaks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.daily_bin_peaks TO authenticated;

DROP POLICY IF EXISTS "Administrators read daily bin peaks" ON public.daily_bin_peaks;
CREATE POLICY "Administrators read daily bin peaks" ON public.daily_bin_peaks
    FOR SELECT TO authenticated
    USING (public.has_any_role(ARRAY['lgu admin', 'system administrator']));

CREATE OR REPLACE FUNCTION public.record_daily_bin_peak()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.last_sync IS NULL OR NEW.level IS NULL OR NEW.level NOT BETWEEN 0 AND 100
        OR NEW.last_collected >= NEW.last_sync THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.last_sync IS NOT NULL AND NEW.last_sync <= OLD.last_sync THEN
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO public.daily_bin_peaks AS daily (reading_date, bin_id, peak_level, reached_full)
    VALUES ((NEW.last_sync AT TIME ZONE 'Asia/Manila')::date, NEW.id, NEW.level,
        COALESCE(lower(NEW.status) = 'full', false) OR NEW.level = 100)
    ON CONFLICT (reading_date, bin_id) DO UPDATE
    SET peak_level = greatest(daily.peak_level, EXCLUDED.peak_level),
        reached_full = daily.reached_full OR EXCLUDED.reached_full
    WHERE EXCLUDED.peak_level > daily.peak_level
        OR (EXCLUDED.reached_full AND NOT daily.reached_full);

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_daily_bin_peak() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS record_daily_bin_peak ON public.bins;
CREATE TRIGGER record_daily_bin_peak
    AFTER INSERT OR UPDATE OF last_sync ON public.bins
    FOR EACH ROW EXECUTE FUNCTION public.record_daily_bin_peak();

INSERT INTO public.daily_bin_peaks (reading_date, bin_id, peak_level, reached_full)
SELECT (last_sync AT TIME ZONE 'Asia/Manila')::date, id, level,
    COALESCE(lower(status) = 'full', false) OR level = 100
FROM public.bins
WHERE last_sync IS NOT NULL AND level BETWEEN 0 AND 100
    AND (last_collected IS NULL OR last_collected < last_sync)
ON CONFLICT (reading_date, bin_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.lgu_daily_bin_trends(p_start date, p_end date)
RETURNS TABLE (reading_date date, average_peak integer, full_bins integer, reporting_bins integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT daily.reading_date, round(avg(daily.peak_level))::integer,
        count(*) FILTER (WHERE daily.reached_full)::integer, count(*)::integer
    FROM public.daily_bin_peaks AS daily
    WHERE daily.reading_date >= p_start AND daily.reading_date < p_end
    GROUP BY daily.reading_date
    ORDER BY daily.reading_date;
$$;

REVOKE ALL ON FUNCTION public.lgu_daily_bin_trends(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lgu_daily_bin_trends(date, date) TO authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
        AND NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'daily_bin_peaks'
        ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_bin_peaks;
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
