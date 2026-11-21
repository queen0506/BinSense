BEGIN;

-- DESTRUCTIVE ROLLBACK
-- This script DROPS public.bin_sensor_readings and permanently deletes all
-- recorded historical telemetry stored in that table.
-- Back up/export bin_sensor_readings before running this script.

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

REVOKE ALL ON FUNCTION public.get_bin_sensor_reading_averages(
    TEXT,
    TEXT,
    TIMESTAMPTZ,
    TIMESTAMPTZ
) FROM authenticated;

DROP FUNCTION IF EXISTS public.get_bin_sensor_reading_averages(
    TEXT,
    TEXT,
    TIMESTAMPTZ,
    TIMESTAMPTZ
);

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

REVOKE ALL ON FUNCTION public.record_bin_sensor_reading(
    TEXT,
    DOUBLE PRECISION,
    INTEGER,
    TEXT,
    TEXT
) FROM service_role;

DROP FUNCTION IF EXISTS public.record_bin_sensor_reading(
    TEXT,
    DOUBLE PRECISION,
    INTEGER,
    TEXT,
    TEXT
);

DROP POLICY IF EXISTS "Citizens read connected bin sensor readings"
    ON public.bin_sensor_readings;
DROP POLICY IF EXISTS "LGU administrators read sensor readings"
    ON public.bin_sensor_readings;
DROP POLICY IF EXISTS "System administrators read sensor readings"
    ON public.bin_sensor_readings;

DROP TABLE IF EXISTS public.bin_sensor_readings;

COMMIT;
