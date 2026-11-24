BEGIN;

CREATE TABLE IF NOT EXISTS public.bin_devices (
    hardware_id TEXT PRIMARY KEY,
    bin_id TEXT NOT NULL UNIQUE,
    device_secret_hash TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bin_devices_bin_id_fkey
        FOREIGN KEY (bin_id)
        REFERENCES public.bins(id)
        ON DELETE CASCADE
);

ALTER TABLE public.bin_devices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.bin_devices FROM PUBLIC, anon, authenticated;

COMMIT;
