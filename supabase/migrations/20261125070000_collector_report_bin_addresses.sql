BEGIN;

CREATE OR REPLACE FUNCTION public.get_collector_report_bin_addresses(p_bin_ids TEXT[])
RETURNS TABLE (bin_id TEXT, location_label TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL
       OR NOT public.has_any_role(ARRAY['waste collector']::TEXT[]) THEN
        RAISE EXCEPTION 'Only authenticated Waste Collectors may access their report bin addresses.'
            USING ERRCODE = '42501';
    END IF;

    IF p_bin_ids IS NULL OR cardinality(p_bin_ids) = 0 THEN
        RETURN;
    END IF;
    IF cardinality(p_bin_ids) > 500 THEN
        RAISE EXCEPTION 'Too many report bins were requested.'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH owned_report_bins AS (
        SELECT DISTINCT report.bin_id
        FROM public.reports AS report
        WHERE report.bin_id = ANY(p_bin_ids)
          AND lower(btrim(coalesce(report.collector, ''))) =
              lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
    ),
    citizen_connections AS (
        SELECT DISTINCT requested.bin_id, connection.user_id
        FROM owned_report_bins AS requested
        INNER JOIN public.user_connected_bins AS connection
            ON connection.bin_id = requested.bin_id
        INNER JOIN public.users AS linked_user
            ON linked_user.id = connection.user_id
           AND lower(btrim(linked_user.role)) = 'citizen'
    ),
    unique_citizen_connections AS (
        SELECT connection.bin_id, (array_agg(connection.user_id))[1] AS user_id
        FROM citizen_connections AS connection
        GROUP BY connection.bin_id
        HAVING count(*) = 1
    ),
    confirmed_addresses AS (
        SELECT
            connection.bin_id,
            CASE
                WHEN lower(btrim(coalesce(citizen.house_number, ''))) IN
                    ('unassigned', 'unknown', 'n/a', 'not specified', 'global')
                    THEN NULL
                ELSE NULLIF(btrim(citizen.house_number), '')
            END AS house_number,
            CASE
                WHEN lower(btrim(coalesce(citizen.street_name, ''))) IN
                    ('unassigned', 'unknown', 'n/a', 'not specified', 'global')
                    THEN NULL
                ELSE NULLIF(btrim(citizen.street_name), '')
            END AS street_name,
            CASE
                WHEN lower(btrim(coalesce(citizen.barangay, ''))) IN
                    ('unassigned', 'unknown', 'n/a', 'not specified', 'global')
                    THEN NULL
                ELSE NULLIF(btrim(citizen.barangay), '')
            END AS barangay,
            CASE
                WHEN lower(btrim(coalesce(citizen.city_municipality, ''))) IN
                    ('unassigned', 'unknown', 'n/a', 'not specified', 'global')
                    THEN NULL
                ELSE NULLIF(btrim(citizen.city_municipality), '')
            END AS city_municipality,
            CASE
                WHEN lower(btrim(coalesce(citizen.province, ''))) IN
                    ('unassigned', 'unknown', 'n/a', 'not specified', 'global')
                    THEN NULL
                ELSE NULLIF(btrim(citizen.province), '')
            END AS province
        FROM unique_citizen_connections AS connection
        INNER JOIN public.users AS citizen
            ON citizen.id = connection.user_id
           AND lower(btrim(citizen.role)) = 'citizen'
        WHERE citizen.address_confirmed IS TRUE
    ),
    location_labels AS (
        SELECT
            requested.bin_id,
            COALESCE(
                NULLIF(
                    concat_ws(
                        ', ',
                        NULLIF(concat_ws(' ', address.house_number, address.street_name), ''),
                        address.barangay,
                        address.city_municipality,
                        address.province
                    ),
                    ''
                ),
                NULLIF(
                    concat_ws(
                        ', ',
                        CASE
                            WHEN lower(btrim(coalesce(bin.street, ''))) IN
                                ('unassigned', 'unknown', 'n/a', 'not specified', 'global')
                                THEN NULL
                            ELSE NULLIF(btrim(bin.street), '')
                        END,
                        CASE
                            WHEN lower(btrim(coalesce(bin.barangay, ''))) IN
                                ('unassigned', 'unknown', 'n/a', 'not specified', 'global')
                                THEN NULL
                            ELSE NULLIF(btrim(bin.barangay), '')
                        END
                    ),
                    ''
                )
            ) AS location_label
        FROM owned_report_bins AS requested
        LEFT JOIN confirmed_addresses AS address
            ON address.bin_id = requested.bin_id
        LEFT JOIN public.bins AS bin
            ON bin.id = requested.bin_id
    )
    SELECT label.bin_id, label.location_label
    FROM location_labels AS label
    WHERE label.location_label IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_collector_report_bin_addresses(TEXT[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_collector_report_bin_addresses(TEXT[])
    TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
