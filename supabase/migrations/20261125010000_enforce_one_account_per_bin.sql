BEGIN;

LOCK TABLE public.user_connected_bins IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.user_connected_bins
        GROUP BY bin_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Some bins are linked to multiple accounts.'
            USING HINT = 'Review the duplicate bin links and retain the intended account for each bin before rerunning this migration.';
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS user_connected_bins_one_account_per_bin_idx
    ON public.user_connected_bins (bin_id);

COMMIT;
