BEGIN;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS house_number text,
    ADD COLUMN IF NOT EXISTS street_name text,
    ADD COLUMN IF NOT EXISTS city_municipality text,
    ADD COLUMN IF NOT EXISTS province text,
    ADD COLUMN IF NOT EXISTS postal_code text,
    ADD COLUMN IF NOT EXISTS address_confirmed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS address_confirmed_at timestamptz;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Citizens update their own address" ON public.users;
CREATE POLICY "Citizens update their own address"
ON public.users
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Citizens read their own address" ON public.users;
CREATE POLICY "Citizens read their own address"
ON public.users
FOR SELECT
TO authenticated
USING (id = auth.uid());

NOTIFY pgrst, 'reload schema';

COMMIT;
