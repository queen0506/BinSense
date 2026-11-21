BEGIN;

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

ALTER TABLE public.bin_sensor_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Citizens read connected bin sensor readings"
    ON public.bin_sensor_readings;
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

DROP POLICY IF EXISTS "LGU administrators read sensor readings"
    ON public.bin_sensor_readings;
CREATE POLICY "LGU administrators read sensor readings"
    ON public.bin_sensor_readings
    FOR SELECT TO authenticated
    USING (public.has_any_role(ARRAY['lgu admin']));

DROP POLICY IF EXISTS "System administrators read sensor readings"
    ON public.bin_sensor_readings;
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

NOTIFY pgrst, 'reload schema';

COMMIT;
