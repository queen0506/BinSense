[CmdletBinding()]
param(
    [switch]$Execute,
    [switch]$Preflight
)

$ErrorActionPreference = 'Stop'

$stagingUrl = $env:SUPABASE_STAGING_URL
$stagingAnonKey = $env:SUPABASE_STAGING_ANON_KEY
$stagingServiceKey = $env:SUPABASE_STAGING_SERVICE_ROLE_KEY
$stagingRef = $env:SUPABASE_STAGING_PROJECT_REF
$testPassword = $env:SUPABASE_STAGING_TEST_PASSWORD
$edgeDeviceSecret = $env:SUPABASE_STAGING_EDGE_DEVICE_SECRET
$productionRef = 'aldudtfxldlzmlkckhol'

function Assert-Staging {
    if (-not $stagingUrl -or -not $stagingAnonKey -or -not $stagingServiceKey -or
        -not $stagingRef -or -not $testPassword -or -not $edgeDeviceSecret) {
        throw 'Set all SUPABASE_STAGING_* variables before running staging tests.'
    }

    if ($edgeDeviceSecret.Length -lt 32 -or $edgeDeviceSecret.Length -gt 256) {
        throw 'SUPABASE_STAGING_EDGE_DEVICE_SECRET must be 32-256 characters.'
    }

    if ($stagingRef -eq $productionRef) {
        throw 'Refuses to use the known production project reference.'
    }

    if (-not $stagingUrl.StartsWith("https://$stagingRef.supabase.co")) {
        throw 'Staging URL and staging project reference do not match.'
    }

    function Get-JwtClaims {
        param([string]$Key)

        if ($Key -notmatch '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') {
            return $null
        }

        $parts = $Key.Split('.')
        $payload = $parts[1].Replace('-', '+').Replace('_', '/')
        switch ($payload.Length % 4) {
            2 { $payload += '==' }
            3 { $payload += '=' }
        }

        try {
            $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
            return $json | ConvertFrom-Json
        } catch {
            return $null
        }
    }

    $anonClaims = Get-JwtClaims -Key $stagingAnonKey
    $serviceClaims = Get-JwtClaims -Key $stagingServiceKey

    if ($anonClaims -and $anonClaims.role -ne 'anon') {
        throw 'SUPABASE_STAGING_ANON_KEY is not an anon/legacy-anon key.'
    }
    if ($anonClaims -and $anonClaims.ref -and $anonClaims.ref -ne $stagingRef) {
        throw 'SUPABASE_STAGING_ANON_KEY does not belong to the selected staging project.'
    }
    if ($serviceClaims -and $serviceClaims.role -ne 'service_role') {
        throw 'SUPABASE_STAGING_SERVICE_ROLE_KEY is not a service-role/legacy-service key.'
    }
    if ($serviceClaims -and $serviceClaims.ref -and $serviceClaims.ref -ne $stagingRef) {
        throw 'SUPABASE_STAGING_SERVICE_ROLE_KEY does not belong to the selected staging project.'
    }
}

Assert-Staging

$serviceHeaders = @{
    apikey = $stagingServiceKey
    Authorization = "Bearer $stagingServiceKey"
    'Content-Type' = 'application/json'
}

function Invoke-StagingRest {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Headers,
        [object]$Body = $null
    )

    $uri = "$stagingUrl$Path"
    try {
        if ($null -eq $Body) {
            return Invoke-RestMethod -Method $Method -Uri $uri -Headers $Headers
        }

        # Send JSON explicitly as UTF-8, matching the successful direct Citizen RPC test.
        # Keep the supplied Authorization and apikey headers unchanged.
        $jsonBody = $Body | ConvertTo-Json -Depth 10 -Compress
        return Invoke-RestMethod -Method $Method -Uri $uri `
            -Headers $Headers `
            -ContentType 'application/json; charset=utf-8' `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody))
    } catch {
        $status = 'unknown'
        $statusCode = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode.value__
            $status = "$statusCode"
        }

        $rawBody = ''
        if ($_.ErrorDetails.Message) {
            $rawBody = $_.ErrorDetails.Message
        } elseif ($_.Exception.Response) {
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                if ($stream) {
                    $reader = New-Object System.IO.StreamReader($stream)
                    $rawBody = $reader.ReadToEnd()
                    $reader.Dispose()
                }
            } catch {}
        }

        foreach ($sensitive in @(
            $stagingAnonKey,
            $stagingServiceKey,
            $testPassword,
            $edgeDeviceSecret
        )) {
            if ($sensitive) {
                $rawBody = $rawBody.Replace($sensitive, '[REDACTED]')
            }
        }
        $rawBody = $rawBody -replace 'Bearer\s+[A-Za-z0-9._-]+', 'Bearer [REDACTED]'
        $rawBody = $rawBody -replace 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED-JWT]'
        $rawBody = $rawBody.Trim()
        if ($rawBody.Length -gt 500) {
            $rawBody = $rawBody.Substring(0, 500) + '...'
        }

        throw "Staging HTTP failure: method=$Method path=$Path status=$status body=$rawBody"
    }
}

# Read-only preflight. This runs before any test bin, device, user, or reading write.
$anonPreflightHeaders = @{
    apikey = $stagingAnonKey
    Authorization = "Bearer $stagingAnonKey"
}
Invoke-StagingRest -Method Get -Path '/auth/v1/settings' -Headers $anonPreflightHeaders | Out-Null

$servicePreflightHeaders = $serviceHeaders.Clone()
Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bins?select=id&limit=1' `
    -Headers $servicePreflightHeaders | Out-Null

Write-Host 'Staging preflight passed: anon auth settings and service-role REST access are reachable.' -ForegroundColor Green

if ($Preflight) {
    exit 0
}

if (-not $Execute) {
    Write-Host 'Staging test script is loaded but not executed.' -ForegroundColor Yellow
    Write-Host 'Use -Preflight for read-only checks or -Execute only after staging writes are approved.'
    exit 0
}

$testBins = @(
    @{ id = 'STAGING-BIN-1'; barangay = 'Staging Barangay'; status = 'Available'; lat = 14.5995; lng = 120.9842; level = 0; volume = 0; last_sync = $null }
    @{ id = 'STAGING-BIN-2'; barangay = 'Staging Barangay'; status = 'Available'; lat = 14.5996; lng = 120.9843; level = 0; volume = 0; last_sync = $null }
)

# Create bins explicitly with the staging service role.
$binsBody = $testBins
$binsHeaders = $serviceHeaders.Clone()
$binsHeaders['Prefer'] = 'resolution=merge-duplicates,return=representation'
Invoke-StagingRest -Method Post -Path '/rest/v1/bins' -Headers $binsHeaders -Body $binsBody | Out-Null

$deviceSecret = $edgeDeviceSecret
$deviceSecretHash = ([System.Security.Cryptography.SHA256]::Create().ComputeHash(
    [System.Text.Encoding]::UTF8.GetBytes($deviceSecret)
) | ForEach-Object { $_.ToString('x2') }) -join ''

$devices = @(
    @{ hardware_id = 'STAGING-HW-1'; bin_id = 'STAGING-BIN-1'; device_secret_hash = $deviceSecretHash; enabled = $true }
    @{ hardware_id = 'STAGING-HW-DISABLED'; bin_id = 'STAGING-BIN-2'; device_secret_hash = $deviceSecretHash; enabled = $false }
)
$deviceHeaders = $serviceHeaders.Clone()
$deviceHeaders['Prefer'] = 'resolution=merge-duplicates,return=representation'
Invoke-StagingRest -Method Post -Path '/rest/v1/bin_devices' -Headers $deviceHeaders -Body $devices | Out-Null

$citizenEmail = 'staging-citizen@example.test'
$disconnectedEmail = 'staging-disconnected@example.test'

function Ensure-TestUser {
    param([string]$Email)

    $listResponse = Invoke-StagingRest -Method Get `
        -Path '/auth/v1/admin/users' -Headers $serviceHeaders

    $existingUser = @($listResponse.users | Where-Object { $_.email -eq $Email } | Select-Object -First 1)
    if ($existingUser.Count -gt 0) {
        return $existingUser[0]
    }

    $created = Invoke-StagingRest -Method Post `
        -Path '/auth/v1/admin/users' -Headers $serviceHeaders -Body @{
            email = $Email
            password = $testPassword
            email_confirm = $true
            user_metadata = @{ full_name = 'Staging Citizen' }
        }
    if ($created.id) {
        return $created
    }
    if ($created.user -and $created.user.id) {
        return $created.user
    }
    throw "Unable to create staging user: $Email"
}

$citizenUser = Ensure-TestUser -Email $citizenEmail
$disconnectedUser = Ensure-TestUser -Email $disconnectedEmail

$profileHeaders = $serviceHeaders.Clone()
$profileHeaders['Prefer'] = 'resolution=merge-duplicates,return=representation'
Invoke-StagingRest -Method Post -Path '/rest/v1/users' -Headers $profileHeaders -Body @(
    @{ id = $citizenUser.id; name = 'Staging Citizen'; email = $citizenEmail; role = 'citizen' }
    @{ id = $disconnectedUser.id; name = 'Staging Disconnected Citizen'; email = $disconnectedEmail; role = 'citizen' }
) | Out-Null

function Get-TestToken {
    param([string]$Email)

    $headers = @{
        apikey = $stagingAnonKey
        'Content-Type' = 'application/json'
    }
    $response = Invoke-StagingRest -Method Post `
        -Path '/auth/v1/token?grant_type=password' `
        -Headers $headers `
        -Body @{ email = $Email; password = $testPassword }
    return $response.access_token
}

$citizenToken = Get-TestToken -Email $citizenEmail
$disconnectedToken = Get-TestToken -Email $disconnectedEmail

$anonHeaders = @{ apikey = $stagingAnonKey }
$citizenHeaders = @{
    apikey = $stagingAnonKey
    Authorization = "Bearer $citizenToken"
}
$disconnectedHeaders = @{
    apikey = $stagingAnonKey
    Authorization = "Bearer $disconnectedToken"
}

$connectionHeaders = $serviceHeaders.Clone()
$connectionHeaders['Prefer'] = 'resolution=ignore-duplicates,return=minimal'
Invoke-StagingRest -Method Post -Path '/rest/v1/user_connected_bins?on_conflict=user_id,bin_id' `
    -Headers $connectionHeaders -Body @{
        user_id = $citizenUser.id
        bin_id = 'STAGING-BIN-1'
    } | Out-Null

$rpcHeaders = $serviceHeaders.Clone()
$rpcHeaders['Prefer'] = 'return=representation'

$validRpcBody = @{
    p_hardware_id = 'STAGING-HW-1'
    p_distance_cm = 125.0
    p_fill_level = 40
    p_status = 'filling'
    p_sensor_sequence = 'staging-sequence-1'
}
$validResult = Invoke-StagingRest -Method Post `
    -Path '/rest/v1/rpc/record_bin_sensor_reading' `
    -Headers $rpcHeaders -Body $validRpcBody

Invoke-StagingRest -Method Post `
    -Path '/rest/v1/rpc/record_bin_sensor_reading' `
    -Headers $rpcHeaders -Body $validRpcBody | Out-Null

$disabledRejected = $false
$disabledReadingsBefore = Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bin_sensor_readings?select=id&bin_id=eq.STAGING-BIN-2' `
    -Headers $serviceHeaders
try {
    Invoke-StagingRest -Method Post `
        -Path '/rest/v1/rpc/record_bin_sensor_reading' `
        -Headers $rpcHeaders -Body @{
            p_hardware_id = 'STAGING-HW-DISABLED'
            p_distance_cm = 100.0
            p_fill_level = 50
            p_status = 'filling'
            p_sensor_sequence = 'staging-disabled-1'
        } | Out-Null
} catch {
    $disabledRejected = $true
}
$disabledReadingsAfter = Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bin_sensor_readings?select=id&bin_id=eq.STAGING-BIN-2' `
    -Headers $serviceHeaders

$unknownRejected = $false
try {
    Invoke-StagingRest -Method Post `
        -Path '/rest/v1/rpc/record_bin_sensor_reading' `
        -Headers $rpcHeaders -Body @{
            p_hardware_id = 'STAGING-HW-UNKNOWN'
            p_distance_cm = 100.0
            p_fill_level = 50
            p_status = 'filling'
            p_sensor_sequence = 'staging-unknown-1'
        } | Out-Null
} catch {
    $unknownRejected = $true
}

$invalidRejected = $false
try {
    Invoke-StagingRest -Method Post `
        -Path '/rest/v1/rpc/record_bin_sensor_reading' `
        -Headers $rpcHeaders -Body @{
            p_hardware_id = 'STAGING-HW-1'
            p_distance_cm = -1.0
            p_fill_level = 150
            p_status = 'invalid'
            p_sensor_sequence = 'staging-invalid-1'
        } | Out-Null
} catch {
    $invalidRejected = $true
}

$periodEnd = (Get-Date).ToUniversalTime()
$periodStart = $periodEnd.AddDays(-7)
$aggregationDay = Invoke-StagingRest -Method Post `
    -Path '/rest/v1/rpc/get_bin_sensor_reading_averages' `
    -Headers $citizenHeaders -Body @{
        p_bin_id = 'STAGING-BIN-1'
        p_granularity = 'day'
        p_start = $periodStart.ToString('o')
        p_end = $periodEnd.ToString('o')
    }
$aggregationHour = Invoke-StagingRest -Method Post `
    -Path '/rest/v1/rpc/get_bin_sensor_reading_averages' `
    -Headers $citizenHeaders -Body @{
        p_bin_id = 'STAGING-BIN-1'
        p_granularity = 'hour'
        p_start = $periodEnd.AddHours(-24).ToString('o')
        p_end = $periodEnd.ToString('o')
    }

$anonAggregationFailed = $false
try {
    Invoke-StagingRest -Method Post `
        -Path '/rest/v1/rpc/get_bin_sensor_reading_averages' `
        -Headers $anonHeaders -Body @{
            p_bin_id = 'STAGING-BIN-1'
            p_granularity = 'day'
            p_start = $periodStart.ToString('o')
            p_end = $periodEnd.ToString('o')
        } | Out-Null
} catch {
    $anonAggregationFailed = $true
}

$citizenConnectedRows = Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bin_sensor_readings?select=id&bin_id=eq.STAGING-BIN-1' `
    -Headers $citizenHeaders
$citizenDisconnectedRows = Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bin_sensor_readings?select=id&bin_id=eq.STAGING-BIN-2' `
    -Headers $citizenHeaders
$disconnectedRows = Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bin_sensor_readings?select=id&bin_id=eq.STAGING-BIN-1' `
    -Headers $disconnectedHeaders

$citizenInsertDenied = $false
try {
    Invoke-StagingRest -Method Post `
        -Path '/rest/v1/bin_sensor_readings' `
        -Headers $citizenHeaders -Body @{
            bin_id = 'STAGING-BIN-1'
            bin_id_snapshot = 'STAGING-BIN-1'
            hardware_id = 'STAGING-HW-1'
            fill_level = 33
            distance_cm = 150
            status = 'filling'
            recorded_at = $periodEnd.ToString('o')
        } | Out-Null
} catch {
    $citizenInsertDenied = $true
}

$readingsBeforeReset = Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bin_sensor_readings?select=id&bin_id=eq.STAGING-BIN-1' `
    -Headers $serviceHeaders
Invoke-StagingRest -Method Patch `
    -Path '/rest/v1/bins?id=eq.STAGING-BIN-1' `
    -Headers $serviceHeaders -Body @{
        level = 0
        status = 'Available'
        last_collected = $periodEnd.ToString('o')
    } | Out-Null
$readingsAfterReset = Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bin_sensor_readings?select=id&bin_id=eq.STAGING-BIN-1' `
    -Headers $serviceHeaders

$staleRequestCreated = $false
try {
    Invoke-StagingRest -Method Post `
        -Path '/rest/v1/rpc/record_bin_sensor_reading' `
        -Headers $rpcHeaders -Body @{
            p_hardware_id = 'STAGING-HW-1'
            p_distance_cm = 220.0
            p_fill_level = 25
            p_status = 'filling'
            p_sensor_sequence = $null
        } | Out-Null
    $staleRequestCreated = $true
} catch {
    $staleRequestCreated = $false
}

$edgeValidHeaders = @{
    apikey = $stagingAnonKey
    'Content-Type' = 'application/json'
    'x-device-secret' = $edgeDeviceSecret
}

function Invoke-EdgeExpectedStatus {
    param(
        [object]$Payload,
        [string]$Secret,
        [int]$ExpectedStatus
    )

    $headers = @{
        apikey = $stagingAnonKey
        Authorization = "Bearer $stagingAnonKey"
        'Content-Type' = 'application/json'
        'x-device-secret' = $Secret
    }

    try {
        $body = Invoke-StagingRest -Method Post `
            -Path '/functions/v1/bin-telemetry' `
            -Headers $headers -Body $Payload
        return @{
            matched = ($ExpectedStatus -eq 200)
            status = 200
            body = $body
        }
    } catch {
        $statusCode = 0
        if ($_.Exception.Message -match 'status=(\d{3})') {
            $statusCode = [int]$Matches[1]
        }
        return @{
            matched = ($statusCode -eq $ExpectedStatus)
            status = $statusCode
            body = $null
        }
    }
}

$validEdgePayload = @{
    hardware_id = 'STAGING-HW-1'
    distance_cm = 140.0
    level = 42
    status = 'filling'
}

$validBinBefore = Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bins?select=id,level,status,last_sync&id=eq.STAGING-BIN-1' `
    -Headers $serviceHeaders
$validReadingCountBefore = Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bin_sensor_readings?select=id&bin_id=eq.STAGING-BIN-1' `
    -Headers $serviceHeaders

$validEdgeTest = Invoke-EdgeExpectedStatus `
    -Payload $validEdgePayload `
    -Secret $edgeDeviceSecret `
    -ExpectedStatus 200
$validEdgeAccepted = $validEdgeTest.matched
$validEdgeResult = $validEdgeTest.body

$validBinAfter = Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bins?select=id,level,status,last_sync&id=eq.STAGING-BIN-1' `
    -Headers $serviceHeaders
$validReadingCountAfter = Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bin_sensor_readings?select=id&bin_id=eq.STAGING-BIN-1' `
    -Headers $serviceHeaders
$latestEdgeReading = Invoke-StagingRest -Method Get `
    -Path '/rest/v1/bin_sensor_readings?select=bin_id,hardware_id,fill_level,distance_cm,status,recorded_at&bin_id=eq.STAGING-BIN-1&order=recorded_at.desc&limit=1' `
    -Headers $serviceHeaders
$edgeReadingVerified = (
    @($latestEdgeReading).Count -eq 1 -and
    $latestEdgeReading[0].bin_id -eq 'STAGING-BIN-1' -and
    $latestEdgeReading[0].hardware_id -eq 'STAGING-HW-1' -and
    [int]$latestEdgeReading[0].fill_level -eq 42 -and
    [double]$latestEdgeReading[0].distance_cm -eq 140.0 -and
    $latestEdgeReading[0].status -eq 'filling'
)

$invalidSecretTest = Invoke-EdgeExpectedStatus `
    -Payload $validEdgePayload `
    -Secret 'invalid-staging-device-secret-at-least-32-chars' `
    -ExpectedStatus 401
$invalidSecretRejected = $invalidSecretTest.matched

$disabledEdgeTest = Invoke-EdgeExpectedStatus `
    -Payload @{
        hardware_id = 'STAGING-HW-DISABLED'
        distance_cm = 100.0
        level = 50
        status = 'filling'
    } `
    -Secret $edgeDeviceSecret `
    -ExpectedStatus 401
$disabledEdgeRejected = $disabledEdgeTest.matched

$unknownEdgeTest = Invoke-EdgeExpectedStatus `
    -Payload @{
        hardware_id = 'STAGING-HW-UNKNOWN'
        distance_cm = 100.0
        level = 50
        status = 'filling'
    } `
    -Secret $edgeDeviceSecret `
    -ExpectedStatus 401
$unknownEdgeRejected = $unknownEdgeTest.matched

$invalidEdgeTest = Invoke-EdgeExpectedStatus `
    -Payload @{
        hardware_id = 'STAGING-HW-1'
        distance_cm = -1.0
        level = 150
        status = 'invalid'
    } `
    -Secret $edgeDeviceSecret `
    -ExpectedStatus 400
$invalidEdgeTelemetryRejected = $invalidEdgeTest.matched

Write-Host "Valid RPC reading ID: $validResult"
Write-Host "Disabled device rejected: $disabledRejected"
Write-Host "Disabled-device reading counts unchanged: $((@($disabledReadingsBefore).Count -eq @($disabledReadingsAfter).Count))"
Write-Host "Unknown device rejected: $unknownRejected"
Write-Host "Invalid telemetry rejected: $invalidRejected"
Write-Host "Daily/hour aggregation buckets: $(@($aggregationHour).Count)"
Write-Host "Weekly/daily aggregation buckets: $(@($aggregationDay).Count)"
Write-Host "Anonymous aggregation denied: $anonAggregationFailed"
Write-Host "Citizen connected-bin rows: $(@($citizenConnectedRows).Count)"
Write-Host "Citizen disconnected-bin rows: $(@($citizenDisconnectedRows).Count)"
Write-Host "Different citizen rows: $(@($disconnectedRows).Count)"
Write-Host "Citizen direct insert denied: $citizenInsertDenied"
Write-Host "Collection reset changed reading count: $((@($readingsBeforeReset).Count -ne @($readingsAfterReset).Count))"
Write-Host "Unsequenced stale-style RPC accepted: $staleRequestCreated"
Write-Host "Valid Edge telemetry accepted: $validEdgeAccepted"
Write-Host "Valid Edge bin level: $($validBinAfter[0].level)"
Write-Host "Valid Edge bin status: $($validBinAfter[0].status)"
Write-Host "Valid Edge reading count increased: $((@($validReadingCountAfter).Count -gt @($validReadingCountBefore).Count))"
Write-Host "Valid Edge latest reading verified: $edgeReadingVerified"
Write-Host "Invalid Edge secret rejected: $invalidSecretRejected"
Write-Host "Disabled Edge device rejected: $disabledEdgeRejected"
Write-Host "Unknown Edge device rejected: $unknownEdgeRejected"
Write-Host "Invalid Edge telemetry rejected: $invalidEdgeTelemetryRejected"
