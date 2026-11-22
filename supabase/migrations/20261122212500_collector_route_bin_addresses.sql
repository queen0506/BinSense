BEGIN;

-- active_dispatch has no collector ID; mirror the app's current active-route access model.
CREATE OR REPLACE FUNCTION public.get_collector_route_bin_addresses(p_bin_ids TEXT[])
RETURNS TABLE (bin_id TEXT, location_label TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL
       OR NOT public.has_any_role(ARRAY['waste collector']::TEXT[]) THEN
        RAISE EXCEPTION 'Only authenticated Waste Collectors may access route addresses.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH current_route AS (
        SELECT dispatch.bin_ids
        FROM public.active_dispatch AS dispatch
        WHERE dispatch.status = 'In Progress'
        ORDER BY dispatch.dispatched_at DESC
        LIMIT 1
    ),
    requested_route_bins AS (
        SELECT DISTINCT requested.bin_id
        FROM unnest(COALESCE(p_bin_ids, ARRAY[]::TEXT[])) AS requested(bin_id)
        INNER JOIN current_route AS route
            ON requested.bin_id = ANY(route.bin_ids)
    ),
    unique_citizen_connections AS (
        SELECT
            connection.bin_id,
            (array_agg(connection.user_id))[1] AS user_id
        FROM public.user_connected_bins AS connection
        INNER JOIN requested_route_bins AS route USING (bin_id)
        INNER JOIN public.users AS linked_user
            ON linked_user.id = connection.user_id
           AND linked_user.role = 'citizen'
        GROUP BY connection.bin_id
        HAVING count(*) = 1
    ),
    confirmed_citizen_addresses AS (
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
        INNER JOIN public.users AS citizen ON citizen.id = connection.user_id
        WHERE citizen.role = 'citizen'
          AND citizen.address_confirmed IS TRUE
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
        FROM confirmed_citizen_addresses AS address
    )
    SELECT label.bin_id, label.location_label
    FROM location_labels AS label
    WHERE label.location_label IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_collector_route_bin_addresses(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_collector_route_bin_addresses(TEXT[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
