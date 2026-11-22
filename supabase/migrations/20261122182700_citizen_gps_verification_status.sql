BEGIN;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS gps_verification_status text NOT NULL DEFAULT 'unverified',
    ADD COLUMN IF NOT EXISTS gps_verification_checked_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass
          AND conname = 'users_gps_verification_status_check'
    ) THEN
        ALTER TABLE public.users
            ADD CONSTRAINT users_gps_verification_status_check
            CHECK (
                gps_verification_status IN (
                    'unverified',
                    'gps_verified',
                    'outside_service_area',
                    'uncertain'
                )
                AND (
                    (gps_verification_status = 'unverified' AND gps_verification_checked_at IS NULL)
                    OR (gps_verification_status <> 'unverified' AND gps_verification_checked_at IS NOT NULL)
                )
            );
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_gps_verification_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF current_user NOT IN ('postgres', 'service_role') THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.gps_verification_status <> 'unverified'
                OR NEW.gps_verification_checked_at IS NOT NULL THEN
                RAISE EXCEPTION 'GPS verification status is server-managed';
            END IF;
        ELSIF NEW.gps_verification_status IS DISTINCT FROM OLD.gps_verification_status
            OR NEW.gps_verification_checked_at IS DISTINCT FROM OLD.gps_verification_checked_at THEN
            RAISE EXCEPTION 'GPS verification status is server-managed';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_gps_verification_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_gps_verification_status ON public.users;
CREATE TRIGGER guard_gps_verification_status
    BEFORE INSERT OR UPDATE OF gps_verification_status, gps_verification_checked_at
    ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_gps_verification_status();

COMMENT ON COLUMN public.users.gps_verification_status IS
    'Server-managed GPS service-area result; user address confirmation is stored separately.';
COMMENT ON COLUMN public.users.gps_verification_checked_at IS
    'Server timestamp for the latest GPS service-area evaluation; precise coordinates are not stored.';

COMMIT;
