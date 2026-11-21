BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_bin_fill (
    reading_date DATE PRIMARY KEY,
    level_total BIGINT NOT NULL,
    reading_count BIGINT NOT NULL CHECK (reading_count > 0)
);

ALTER TABLE public.daily_bin_fill ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_bin_fill FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.daily_bin_fill TO authenticated;

DROP POLICY IF EXISTS "Administrators read daily bin fill" ON public.daily_bin_fill;
CREATE POLICY "Administrators read daily bin fill" ON public.daily_bin_fill
    FOR SELECT TO authenticated
    USING (public.has_any_role(ARRAY['lgu admin', 'system administrator']));

CREATE OR REPLACE FUNCTION public.record_daily_bin_fill()
RETURNS TRIGGER
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

    INSERT INTO public.daily_bin_fill AS daily (reading_date, level_total, reading_count)
    VALUES ((NEW.last_sync AT TIME ZONE 'Asia/Manila')::date, NEW.level, 1)
    ON CONFLICT (reading_date) DO UPDATE SET
        level_total = daily.level_total + EXCLUDED.level_total,
        reading_count = daily.reading_count + EXCLUDED.reading_count;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_daily_bin_fill() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS record_daily_bin_fill ON public.bins;
CREATE TRIGGER record_daily_bin_fill
    AFTER INSERT OR UPDATE OF last_sync ON public.bins
    FOR EACH ROW EXECUTE FUNCTION public.record_daily_bin_fill();

-- Recover the latest saved reading per bin when it has survived subsequent collection.
INSERT INTO public.daily_bin_fill (reading_date, level_total, reading_count)
SELECT (last_sync AT TIME ZONE 'Asia/Manila')::date, SUM(level), COUNT(*)
FROM public.bins
WHERE last_sync IS NOT NULL AND level BETWEEN 0 AND 100
    AND (last_collected IS NULL OR last_collected < last_sync)
GROUP BY 1
ON CONFLICT (reading_date) DO NOTHING;

DO $$
DECLARE
    published_table TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        FOREACH published_table IN ARRAY ARRAY['daily_bin_fill', 'collection_logs']
        LOOP
            IF NOT EXISTS (
                SELECT 1 FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                    AND schemaname = 'public' AND tablename = published_table
            ) THEN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', published_table);
            END IF;
        END LOOP;
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
