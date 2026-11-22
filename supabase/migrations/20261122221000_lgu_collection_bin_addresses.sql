BEGIN;

CREATE OR REPLACE FUNCTION public.get_lgu_collection_bin_addresses(p_bin_ids TEXT[])
RETURNS TABLE (bin_id TEXT, location_label TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL
       OR NOT public.has_any_role(ARRAY['lgu admin']::TEXT[]) THEN
        RAISE EXCEPTION 'Only authenticated LGU Administrators may access collection route addresses.'
            USING ERRCODE = '42501';
    END IF;

    IF p_bin_ids IS NULL OR cardinality(p_bin_ids) = 0 THEN
        RETURN;
    END IF;
    IF cardinality(p_bin_ids) > 500 THEN
        RAISE EXCEPTION 'Too many collection route bins were requested.'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH eligible_bins AS (
        SELECT DISTINCT bin.id AS bin_id
        FROM public.bins AS bin
        WHERE lower(coalesce(bin.status, '')) = 'full'
          AND bin.id = ANY(p_bin_ids)
    ),
    citizen_connections AS (
        SELECT DISTINCT eligible.bin_id, connection.user_id
        FROM eligible_bins AS eligible
        INNER JOIN public.user_connected_bins AS connection
            ON connection.bin_id = eligible.bin_id
        INNER JOIN public.users AS linked_user
            ON linked_user.id = connection.user_id
           AND linked_user.role = 'citizen'
    ),
    unique_citizen_connections AS (
        SELECT connection.bin_id, connection.user_id
        FROM citizen_connections AS connection
        INNER JOIN (
            SELECT grouped_connection.bin_id
            FROM citizen_connections AS grouped_connection
            GROUP BY grouped_connection.bin_id
            HAVING count(*) = 1
        ) AS unique_bin
            ON unique_bin.bin_id = connection.bin_id
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
           AND citizen.role = 'citizen'
        WHERE citizen.address_confirmed IS TRUE
    ),
    location_labels AS (
        SELECT
            address.bin_id,
            NULLIF(
                concat_ws(
                    ', ',
                    NULLIF(concat_ws(' ', address.house_number, address.street_name), ''),
                    address.barangay,
                    address.city_municipality,
                    address.province
                ),
                ''
            ) AS location_label
        FROM confirmed_addresses AS address
    )
    SELECT label.bin_id, label.location_label
    FROM location_labels AS label
    WHERE label.location_label IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_lgu_collection_bin_addresses(TEXT[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_lgu_collection_bin_addresses(TEXT[])
    TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
