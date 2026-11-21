
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-device-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isValidHexHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqualHex(a: string, b: string): boolean {
  if (!isValidHexHash(a) || !isValidHexHash(b)) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return difference === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Parse the JSON body first.
  let payload: {
    hardware_id?: string;
    distance_cm?: number;
    level?: number;
    status?: string;
  };

  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // The ESP32 sends hardware_id in the JSON body,
  // not in an X-Hardware-ID header.
  const hardwareId =
    typeof payload.hardware_id === "string"
      ? payload.hardware_id.trim()
      : "";

  // The ESP32 sends the raw device secret in this header.
  const deviceSecret =
    req.headers.get("x-device-secret")?.trim() ?? "";

  if (!hardwareId || !deviceSecret) {
    return jsonResponse(
      { error: "Missing hardware ID or device secret" },
      401,
    );
  }

  if (
    hardwareId.length > 64 ||
    hardwareId === "00:00:00:00:00:00" ||
    deviceSecret.length < 32 ||
    deviceSecret.length > 256
  ) {
    return jsonResponse({ error: "Invalid device credentials" }, 401);
  }

  // Validate telemetry values.
  const distance = payload.distance_cm;
  const level = payload.level;
  const status = payload.status;

  if (
    typeof distance !== "number" ||
    !Number.isFinite(distance) ||
    distance < 0 ||
    distance > 1000 ||
    typeof level !== "number" ||
    !Number.isFinite(level) ||
    level < 0 ||
    level > 100 ||
    !["available", "filling", "full"].includes(status ?? "")
  ) {
    return jsonResponse({ error: "Invalid telemetry values" }, 400);
  }

  // These custom secrets must exist in Supabase Edge Function Secrets.
  const supabaseUrl = Deno.env.get("BINSENSE_PROJECT_URL");
  const serviceRoleKey = Deno.env.get("BINSENSE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing required Supabase server environment variables");

    return jsonResponse(
      { error: "Server configuration is incomplete" },
      500,
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    // Find the registered device.
    const { data: device, error: deviceError } = await supabase
      .from("bin_devices")
      .select("hardware_id, bin_id, device_secret_hash, enabled")
      .eq("hardware_id", hardwareId)
      .maybeSingle();

    if (deviceError) {
      console.error("Device lookup failed:", deviceError.message);
      return jsonResponse({ error: "Device lookup failed" }, 500);
    }

    if (!device || !device.enabled) {
      return jsonResponse({ error: "Unknown or disabled device" }, 401);
    }

    // Hash the supplied secret and compare it with the stored hash.
    const providedHash = await sha256Hex(deviceSecret);
    const storedHash = device.device_secret_hash;

    if (
      typeof storedHash !== "string" ||
      !safeEqualHex(providedHash, storedHash)
    ) {
      return jsonResponse({ error: "Invalid device credentials" }, 401);
    }

    const { data: readingId, error: rpcError } = await supabase.rpc(
      "record_bin_sensor_reading",
      {
        p_hardware_id: hardwareId,
        p_distance_cm: distance,
        p_fill_level: Math.round(level),
        p_status: status,
        p_sensor_sequence: null,
      },
    );

    if (rpcError) {
      console.error("Transactional telemetry RPC failed:", rpcError.message);
      return jsonResponse({ error: "Could not save telemetry" }, 500);
    }

    return jsonResponse({
      success: true,
      message: "Telemetry saved",
      hardware_id: hardwareId,
      bin_id: device.bin_id,
      distance_cm: distance,
      level: Math.round(level),
      status,
      reading_id: readingId,
    });
  } catch (error) {
    console.error(
      "Unexpected telemetry error:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
