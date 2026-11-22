[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script:results = [ordered]@{}
$script:failureCount = 0
$script:createdDispatchId = $null
$script:authUsers = @()
$script:serviceHeaders = $null
$script:anonHeaders = $null
$script:setupBlocked = $null

$script:requiredTests = @(
    'Staging project reference verified',
    'Staging REST preflight passed',
    'Collector route RPC is available',
    'Citizen address schema is available',
    'Waste Collector test account is available',
    'Waste Collector profile is available with the correct role',
    'Citizen confirmed-address fixture is available',
    'Connected test bins are available',
    'Active dispatch fixture is available',
    'Collector receives the confirmed address',
    'RPC response contains only the allowed fields',
    'Citizen RPC request is denied',
    'Anonymous RPC request is denied',
    'Outside-dispatch bin address is not exposed',
    'Temporary dispatch cleanup completed'
)

$script:primaryBinId = 'STAGING-ROUTE-ADDRESS-01'
$script:citizenEmail = 'staging-route-address-citizen@example.test'
$script:collectorEmail = 'staging-route-address-collector@wastemanagement.com'
$script:testMarker = 'binsense-route-address-integration'
$script:expectedStagingRef = 'fjdpfjfqcoafnowwelur'

function Write-TestResult {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Detail
    )

    if ($script:results.Contains($Name)) {
        return
    }

    $script:results[$Name] = $Passed
    $safeDetail = Protect-Output $Detail
    if ($Passed) {
        Write-Host "PASS: $Name - $safeDetail" -ForegroundColor Green
    } else {
        $script:failureCount++
        Write-Host "FAIL: $Name - $safeDetail" -ForegroundColor Red
    }
}

function Protect-Output {
    param([string]$Message)

    $safeMessage = [string]$Message
    foreach ($secret in @(
        $script:stagingAnonKey,
        $script:stagingServiceKey,
        $script:testPassword,
        $script:edgeDeviceSecret,
        $script:collectorToken,
        $script:citizenToken
    )) {
        if ($secret) {
            $safeMessage = $safeMessage.Replace($secret, '[REDACTED]')
        }
    }
    $safeMessage = $safeMessage -replace 'Bearer\s+[A-Za-z0-9._-]+', 'Bearer [REDACTED]'
    $safeMessage = $safeMessage -replace 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED-JWT]'
    foreach ($email in @($script:citizenEmail, $script:collectorEmail)) {
        if ($email) {
            $safeMessage = $safeMessage.Replace($email, '[test account]')
        }
    }
    if ($safeMessage.Length -gt 350) {
        $safeMessage = $safeMessage.Substring(0, 350) + '...'
    }
    return $safeMessage
}

function Import-StagingEnvironment {
    $envPath = Join-Path $PSScriptRoot '.env.staging'
    if (-not (Test-Path -LiteralPath $envPath)) {
        throw 'supabase/staging/.env.staging is missing.'
    }

    foreach ($line in Get-Content -LiteralPath $envPath) {
        if ($line -match '^\s*(#|$)') {
            continue
        }
        if ($line -match '^\s*(SUPABASE_STAGING_[A-Za-z0-9_]+)\s*=\s*(.*?)\s*$') {
            $key = $matches[1]
            $value = $matches[2].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            [Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }

    $script:stagingUrl = $env:SUPABASE_STAGING_URL.TrimEnd('/')
    $script:stagingRef = $env:SUPABASE_STAGING_PROJECT_REF
    $script:stagingAnonKey = $env:SUPABASE_STAGING_ANON_KEY
    $script:stagingServiceKey = $env:SUPABASE_STAGING_SERVICE_ROLE_KEY
    $script:testPassword = $env:SUPABASE_STAGING_TEST_PASSWORD
    $script:edgeDeviceSecret = $env:SUPABASE_STAGING_EDGE_DEVICE_SECRET
}

function Get-StagingHelperBundle {
    $helperPath = Join-Path $PSScriptRoot 'test_staging.ps1'
    if (-not (Test-Path -LiteralPath $helperPath)) {
        throw 'Existing staging test helper is missing.'
    }

    $tokens = $null
    $parseErrors = $null
    $helperAst = [System.Management.Automation.Language.Parser]::ParseFile(
        $helperPath,
        [ref]$tokens,
        [ref]$parseErrors
    )
    if ($parseErrors.Count -gt 0) {
        throw 'Existing staging test helper could not be parsed.'
    }

    $helperFunctions = $helperAst.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -in @('Assert-Staging', 'Invoke-StagingRest')
    }, $true)
    if ($helperFunctions.Name -notcontains 'Assert-Staging' -or
        $helperFunctions.Name -notcontains 'Invoke-StagingRest') {
        throw 'Required staging HTTP or safety helper was not found.'
    }

    $productionRefAssignment = $helperAst.Find({
        param($node)
        $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq '$productionRef'
    }, $true)
    if (-not $productionRefAssignment) {
        throw 'The existing helper does not define its production-project guard.'
    }
    $productionRefConstant = $productionRefAssignment.Right.Find({
        param($node)
        $node -is [System.Management.Automation.Language.StringConstantExpressionAst]
    }, $true)
    if (-not $productionRefConstant) {
        throw 'The existing helper production-project guard is not a literal value.'
    }

    return [pscustomobject]@{
        Functions = @($helperFunctions | ForEach-Object { $_.Extent.Text })
        ProductionRef = [string]$productionRefConstant.Value
    }
}

function Get-TestAuthUsers {
    $users = New-Object 'System.Collections.Generic.List[object]'
    for ($page = 1; $page -le 100; $page++) {
        $response = Invoke-StagingRest -Method Get `
            -Path "/auth/v1/admin/users?page=$page&per_page=1000" `
            -Headers $script:serviceHeaders
        $pageUsers = @($response.users)
        foreach ($user in $pageUsers) {
            if ($user) {
                $users.Add($user)
            }
        }
        if ($pageUsers.Count -lt 1000) {
            break
        }
    }
    return $users.ToArray()
}

function Ensure-TestAuthUser {
    param(
        [string]$Email,
        [string]$DisplayName
    )

    $matches = @($script:authUsers | Where-Object { $_.email -ieq $Email })
    if ($matches.Count -gt 1) {
        throw 'More than one Auth account uses a dedicated staging test email.'
    }
    if ($matches.Count -eq 1) {
        return $matches[0]
    }

    $created = Invoke-StagingRest -Method Post `
        -Path '/auth/v1/admin/users' `
        -Headers $script:serviceHeaders `
        -Body @{
            email = $Email
            password = $script:testPassword
            email_confirm = $true
            user_metadata = @{
                full_name = $DisplayName
                test_fixture = $script:testMarker
            }
        }
    if (-not $created.id -and $created.user.id) {
        $created = $created.user
    }
    if (-not $created.id) {
        throw 'Supabase Auth did not return an ID for a newly created test account.'
    }
    $script:authUsers += $created
    return $created
}

function Get-TestProfile {
    param([string]$UserId)

    $response = Invoke-StagingRest -Method Get `
        -Path "/rest/v1/users?select=id,role,address_confirmed,address_confirmed_at,house_number,street_name,barangay,city_municipality,province&id=eq.$UserId" `
        -Headers $script:serviceHeaders
    return @($response) | Select-Object -First 1
}

function Get-ConfirmedAddressLabel {
    param([object]$Profile)

    if (-not $Profile -or $Profile.address_confirmed -ne $true) {
        return $null
    }

    $houseParts = @($Profile.house_number, $Profile.street_name) |
        ForEach-Object { ([string]$_).Trim() } |
        Where-Object { $_ -and $_ -notmatch '^(unassigned|unknown|n/a|not specified|global)$' }
    $houseAndStreet = $houseParts -join ' '

    $parts = @(
        $houseAndStreet,
        $Profile.barangay,
        $Profile.city_municipality,
        $Profile.province
    ) | ForEach-Object { ([string]$_).Trim() } |
        Where-Object { $_ -and $_ -notmatch '^(unassigned|unknown|n/a|not specified|global)$' }

    if ($parts.Count -eq 0) {
        return $null
    }
    return $parts -join ', '
}

function Ensure-TestProfiles {
    param(
        [string]$CollectorId,
        [string]$CollectorEmail,
        [string]$CitizenId
    )

    $collectorProfile = Get-TestProfile -UserId $CollectorId
    if (-not $collectorProfile) {
        $profileHeaders = $script:serviceHeaders.Clone()
        $profileHeaders['Prefer'] = 'resolution=ignore-duplicates,return=minimal'
        Invoke-StagingRest -Method Post -Path '/rest/v1/users?on_conflict=id' `
            -Headers $profileHeaders -Body @{
                id = $CollectorId
                email = $CollectorEmail
                role = 'waste collector'
                name = 'Staging Route Address Test Collector'
            } | Out-Null
        $collectorProfile = Get-TestProfile -UserId $CollectorId
    }
    if (-not $collectorProfile -or $collectorProfile.role -ne 'waste collector') {
        throw 'The dedicated Auth account does not have a profile with the required Waste Collector role.'
    }
    Write-TestResult -Name 'Waste Collector profile is available with the correct role' -Passed $true `
        -Detail 'The Auth UUID has a public.users profile with role waste collector.'

    $citizenProfile = Get-TestProfile -UserId $CitizenId
    if (-not $citizenProfile) {
        Invoke-StagingRest -Method Post -Path '/rest/v1/users' `
            -Headers $script:serviceHeaders -Body @{
                id = $CitizenId
                role = 'citizen'
                name = 'Staging Route Address Test Citizen'
                house_number = '#18'
                street_name = 'E 21st Street'
                barangay = 'East Bajac-Bajac'
                city_municipality = 'Olongapo'
                province = 'Zambales'
                address_confirmed = $true
                address_confirmed_at = [DateTime]::UtcNow.ToString('o')
            } | Out-Null
        $citizenProfile = Get-TestProfile -UserId $CitizenId
    } elseif ($citizenProfile.role -ne 'citizen') {
        throw 'The dedicated Auth account does not have a Citizen profile.'
    } elseif (-not (Get-ConfirmedAddressLabel -Profile $citizenProfile)) {
        $profileHeaders = $script:serviceHeaders.Clone()
        $profileHeaders['Prefer'] = 'return=minimal'
        Invoke-StagingRest -Method Patch `
            -Path "/rest/v1/users?id=eq.$CitizenId" `
            -Headers $profileHeaders `
            -Body @{
                house_number = '#18'
                street_name = 'E 21st Street'
                barangay = 'East Bajac-Bajac'
                city_municipality = 'Olongapo'
                province = 'Zambales'
                address_confirmed = $true
                address_confirmed_at = [DateTime]::UtcNow.ToString('o')
            } | Out-Null
        $citizenProfile = Get-TestProfile -UserId $CitizenId
    }
    if (-not (Get-ConfirmedAddressLabel -Profile $citizenProfile)) {
        throw 'The staging Citizen profile has no confirmed address label.'
    }
    return $citizenProfile
}

function Ensure-TestBin {
    param([string]$BinId)

    $response = Invoke-StagingRest -Method Get `
        -Path "/rest/v1/bins?select=id&id=eq.$BinId" `
        -Headers $script:serviceHeaders
    if (@($response).Count -gt 0) {
        return
    }

    $insertHeaders = $script:serviceHeaders.Clone()
    $insertHeaders['Prefer'] = 'return=minimal'
    Invoke-StagingRest -Method Post -Path '/rest/v1/bins' `
        -Headers $insertHeaders -Body @{
            id = $BinId
            status = 'Full'
            level = 100
            volume = 100
            lat = 14.8354
            lng = 120.2842
        } | Out-Null
}

function Ensure-TestConnection {
    param(
        [string]$BinId,
        [string]$CitizenId
    )

    $response = Invoke-StagingRest -Method Get `
        -Path "/rest/v1/user_connected_bins?select=user_id,bin_id&bin_id=eq.$BinId" `
        -Headers $script:serviceHeaders
    $connections = @($response)
    if ($connections.Count -eq 0) {
        $connectionHeaders = $script:serviceHeaders.Clone()
        $connectionHeaders['Prefer'] = 'resolution=ignore-duplicates,return=minimal'
        Invoke-StagingRest -Method Post `
            -Path '/rest/v1/user_connected_bins?on_conflict=user_id,bin_id' `
            -Headers $connectionHeaders `
            -Body @{ user_id = $CitizenId; bin_id = $BinId } | Out-Null
        $response = Invoke-StagingRest -Method Get `
            -Path "/rest/v1/user_connected_bins?select=user_id,bin_id&bin_id=eq.$BinId" `
            -Headers $script:serviceHeaders
        $connections = @($response)
    }

    if ($connections.Count -ne 1 -or $connections[0].user_id -ne $CitizenId) {
        throw 'A dedicated test bin has a conflicting Citizen connection; no existing link was changed.'
    }
}

function Get-TestAccessToken {
    param([string]$Email)

    $headers = @{
        apikey = $script:stagingAnonKey
        'Content-Type' = 'application/json'
    }
    $response = Invoke-StagingRest -Method Post `
        -Path '/auth/v1/token?grant_type=password' `
        -Headers $headers `
        -Body @{ email = $Email; password = $script:testPassword }
    if (-not $response.access_token) {
        throw 'Supabase Auth did not return a test access token.'
    }
    return [string]$response.access_token
}

function Invoke-AddressRpc {
    param(
        [hashtable]$Headers,
        [string]$BinId
    )

    $rows = Invoke-StagingRest -Method Post `
        -Path '/rest/v1/rpc/get_collector_route_bin_addresses' `
        -Headers $Headers `
        -Body @{ p_bin_ids = @($BinId) }
    foreach ($row in $rows) {
        $row
    }
}

function Test-RpcDenied {
    param(
        [hashtable]$Headers,
        [string]$BinId
    )

    try {
        $null = Invoke-AddressRpc -Headers $Headers -BinId $BinId
        return @{ Denied = $false; Detail = 'The RPC returned a successful response.' }
    } catch {
        $message = Protect-Output $_.Exception.Message
        if ($message -match 'status=(401|403)\b') {
            return @{ Denied = $true; Detail = "Request rejected with HTTP $($matches[1])." }
        }
        return @{ Denied = $false; Detail = $message }
    }
}

function Get-CurrentActiveDispatch {
    $response = Invoke-StagingRest -Method Get `
        -Path '/rest/v1/active_dispatch?select=id,bin_ids,status,dispatched_at&status=eq.In%20Progress&order=dispatched_at.desc&limit=1' `
        -Headers $script:serviceHeaders
    return @($response) | Select-Object -First 1
}

function Add-RequiredFailureResults {
    param([string]$Reason)

    foreach ($testName in $script:requiredTests) {
        if (-not $script:results.Contains($testName)) {
            Write-TestResult -Name $testName -Passed $false -Detail "Not run: $Reason"
        }
    }
}

try {
    Import-StagingEnvironment
    $helperBundle = Get-StagingHelperBundle
    foreach ($helperFunction in $helperBundle.Functions) {
        Invoke-Expression $helperFunction
    }
    $script:productionRef = $helperBundle.ProductionRef
    Assert-Staging

    if ($script:stagingRef -ne $script:expectedStagingRef) {
        throw 'Configured project reference is not the verified BinSense-Staging project.'
    }
    $stagingUri = [Uri]$script:stagingUrl
    if ($stagingUri.Scheme -ne 'https' -or
        $stagingUri.Host -ne "$($script:stagingRef).supabase.co" -or
        $script:stagingRef -eq $script:productionRef) {
        throw 'Staging URL validation failed; no fixture writes were made.'
    }
    Write-TestResult -Name 'Staging project reference verified' -Passed $true `
        -Detail "Verified Staging ref $($script:stagingRef); production ref rejected."

    $script:serviceHeaders = @{
        apikey = $script:stagingServiceKey
        Authorization = "Bearer $($script:stagingServiceKey)"
        'Content-Type' = 'application/json'
    }
    $script:anonHeaders = @{
        apikey = $script:stagingAnonKey
        'Content-Type' = 'application/json'
    }

    Invoke-StagingRest -Method Get -Path '/auth/v1/settings' `
        -Headers $script:anonHeaders | Out-Null
    Invoke-StagingRest -Method Get -Path '/rest/v1/bins?select=id&limit=1' `
        -Headers $script:serviceHeaders | Out-Null
    Write-TestResult -Name 'Staging REST preflight passed' -Passed $true `
        -Detail 'Auth and service-role REST endpoints responded.'

    $apiSchema = Invoke-StagingRest -Method Get -Path '/rest/v1/' `
        -Headers $script:serviceHeaders
    $rpcVisible = $false
    if ($apiSchema.paths) {
        $rpcVisible = @($apiSchema.paths.PSObject.Properties.Name) -contains '/rpc/get_collector_route_bin_addresses'
    }
    Write-TestResult -Name 'Collector route RPC is available' -Passed $rpcVisible `
        -Detail $(if ($rpcVisible) { 'RPC is present in the Staging API schema.' } else { 'Apply the reviewed RPC migration to Staging first.' })
    if (-not $rpcVisible) {
        throw 'Collector route RPC is not available in the Staging API schema.'
    }

    try {
        Invoke-StagingRest -Method Get `
            -Path '/rest/v1/users?select=id,address_confirmed,address_confirmed_at,house_number,street_name,barangay,city_municipality,province&limit=0' `
            -Headers $script:serviceHeaders | Out-Null
        Write-TestResult -Name 'Citizen address schema is available' -Passed $true `
            -Detail 'The required confirmed-address columns are exposed in Staging.'
    } catch {
        Write-TestResult -Name 'Citizen address schema is available' -Passed $false `
            -Detail 'Staging is missing the confirmed-address columns; the existing citizen-address-fields migration must be applied before this integration test can run.'
        throw 'Staging does not expose the confirmed-address fields required by the RPC.'
    }

    $script:serviceHeaders['Prefer'] = 'return=representation'
    $currentDispatch = Get-CurrentActiveDispatch
    if ($currentDispatch -and $currentDispatch.bin_ids -notcontains $script:primaryBinId) {
        Write-TestResult -Name 'Active dispatch fixture is available' -Passed $false `
            -Detail 'A different active route exists; refusing to replace or modify it.'
        throw 'A different active dispatch is already running. No fixture writes were made.'
    }

    $outsideCandidates = @(
        'STAGING-ROUTE-ADDRESS-OUTSIDE',
        'STAGING-ROUTE-ADDRESS-OUTSIDE-2',
        'STAGING-ROUTE-ADDRESS-OUTSIDE-3'
    )
    $activeBinIds = @()
    if ($currentDispatch) {
        $activeBinIds = @($currentDispatch.bin_ids)
    }
    $script:outsideBinId = $outsideCandidates |
        Where-Object { $activeBinIds -notcontains $_ } |
        Select-Object -First 1
    if (-not $script:outsideBinId) {
        Write-TestResult -Name 'Active dispatch fixture is available' -Passed $false `
            -Detail 'No unused outside-route test bin ID is available.'
        throw 'Cannot prepare an outside-dispatch test without changing the active route.'
    }

    $script:authUsers = @(Get-TestAuthUsers)
    $collectorAuth = Ensure-TestAuthUser -Email $script:collectorEmail `
        -DisplayName 'Staging Route Address Test Collector'
    $citizenAuth = Ensure-TestAuthUser -Email $script:citizenEmail `
        -DisplayName 'Staging Route Address Test Citizen'
    Write-TestResult -Name 'Waste Collector test account is available' -Passed $true `
        -Detail 'Dedicated Staging Auth account exists or was created.'

    $citizenProfile = Ensure-TestProfiles -CollectorId $collectorAuth.id `
        -CollectorEmail $collectorAuth.email -CitizenId $citizenAuth.id
    $expectedAddressLabel = Get-ConfirmedAddressLabel -Profile $citizenProfile
    Write-TestResult -Name 'Citizen confirmed-address fixture is available' -Passed $true `
        -Detail 'Dedicated Citizen profile has a confirmed, usable address.'

    Ensure-TestBin -BinId $script:primaryBinId
    Ensure-TestBin -BinId $script:outsideBinId
    Ensure-TestConnection -BinId $script:primaryBinId -CitizenId $citizenAuth.id
    Ensure-TestConnection -BinId $script:outsideBinId -CitizenId $citizenAuth.id
    Write-TestResult -Name 'Connected test bins are available' -Passed $true `
        -Detail 'Both dedicated bins have exactly one link to the test Citizen.'

    if (-not $currentDispatch) {
        $dispatchHeaders = $script:serviceHeaders.Clone()
        $dispatchHeaders['Prefer'] = 'return=representation'
        $createdDispatch = Invoke-StagingRest -Method Post `
            -Path '/rest/v1/active_dispatch' `
            -Headers $dispatchHeaders `
            -Body @{
                bin_ids = @($script:primaryBinId)
                status = 'In Progress'
                dispatched_at = [DateTime]::UtcNow.ToString('o')
            }
        $createdDispatchRow = @($createdDispatch) | Select-Object -First 1
        if (-not $createdDispatchRow.id) {
            throw 'The temporary Staging dispatch was not created with a returned ID.'
        }
        $script:createdDispatchId = [string]$createdDispatchRow.id
        $currentDispatch = Get-CurrentActiveDispatch
    }
    if (-not $currentDispatch -or $currentDispatch.bin_ids -notcontains $script:primaryBinId) {
        throw 'The latest active dispatch does not include the primary test bin.'
    }
    Write-TestResult -Name 'Active dispatch fixture is available' -Passed $true `
        -Detail 'The primary test bin is in the latest In Progress dispatch.'

    $collectorToken = Get-TestAccessToken -Email $script:collectorEmail
    $citizenToken = Get-TestAccessToken -Email $script:citizenEmail
    $collectorHeaders = @{
        apikey = $script:stagingAnonKey
        Authorization = "Bearer $collectorToken"
        'Content-Type' = 'application/json'
    }
    $citizenHeaders = @{
        apikey = $script:stagingAnonKey
        Authorization = "Bearer $citizenToken"
        'Content-Type' = 'application/json'
    }

    try {
        $collectorRows = @(Invoke-AddressRpc -Headers $collectorHeaders -BinId $script:primaryBinId)
        $primaryRows = @($collectorRows | Where-Object { $_.bin_id -eq $script:primaryBinId })
        $addressMatches = (
            $primaryRows.Count -eq 1 -and
            $primaryRows[0].location_label -eq $expectedAddressLabel
        )
        Write-TestResult -Name 'Collector receives the confirmed address' -Passed $addressMatches `
            -Detail $(if ($addressMatches) { 'The unique connected Citizen address matches the confirmed profile.' } else { 'Expected one route address matching the confirmed test profile.' })

        $shapeMatches = $primaryRows.Count -eq 1
        $actualKeys = @()
        if ($shapeMatches) {
            $actualKeys = @($primaryRows[0].PSObject.Properties.Name | Sort-Object)
            $expectedKeys = @('bin_id', 'location_label')
            $shapeMatches = -not (Compare-Object $expectedKeys $actualKeys)
        }
        Write-TestResult -Name 'RPC response contains only the allowed fields' -Passed $shapeMatches `
            -Detail $(if ($shapeMatches) {
                'Only bin_id and location_label were returned.'
            } elseif ($primaryRows.Count -eq 1) {
                "Expected only bin_id and location_label; received keys: $($actualKeys -join ', ')."
            } else {
                "Expected one result row with only bin_id and location_label; received $($primaryRows.Count) matching rows."
            })
    } catch {
        $detail = Protect-Output $_.Exception.Message
        Write-TestResult -Name 'Collector receives the confirmed address' -Passed $false -Detail $detail
        Write-TestResult -Name 'RPC response contains only the allowed fields' -Passed $false `
            -Detail 'Not verifiable because the Collector RPC request failed.'
    }

    $citizenDenied = Test-RpcDenied -Headers $citizenHeaders -BinId $script:primaryBinId
    Write-TestResult -Name 'Citizen RPC request is denied' -Passed $citizenDenied.Denied `
        -Detail $citizenDenied.Detail

    $anonymousDenied = Test-RpcDenied -Headers $script:anonHeaders -BinId $script:primaryBinId
    Write-TestResult -Name 'Anonymous RPC request is denied' -Passed $anonymousDenied.Denied `
        -Detail $anonymousDenied.Detail

    try {
        $outsideRows = @(Invoke-AddressRpc -Headers $collectorHeaders -BinId $script:outsideBinId)
        $outsideHidden = $outsideRows.Count -eq 0
        Write-TestResult -Name 'Outside-dispatch bin address is not exposed' -Passed $outsideHidden `
            -Detail $(if ($outsideHidden) {
                'No address was returned for a connected bin outside the active dispatch.'
            } else {
                $returnedBinIds = @($outsideRows | ForEach-Object { $_.bin_id })
                "The RPC returned rows for bin IDs: $($returnedBinIds -join ', ')."
            })
    } catch {
        Write-TestResult -Name 'Outside-dispatch bin address is not exposed' -Passed $false `
            -Detail (Protect-Output $_.Exception.Message)
    }
} catch {
    $script:setupBlocked = Protect-Output $_.Exception.Message
} finally {
    if ($script:createdDispatchId -and $script:serviceHeaders) {
        try {
            $dispatchNow = Invoke-StagingRest -Method Get `
                -Path "/rest/v1/active_dispatch?select=id,bin_ids,status&id=eq.$($script:createdDispatchId)" `
                -Headers $script:serviceHeaders
            $dispatchRows = @($dispatchNow)
            if ($dispatchRows.Count -eq 0) {
                Write-TestResult -Name 'Temporary dispatch cleanup completed' -Passed $true `
                    -Detail 'The temporary test dispatch was already absent.'
            } elseif ($dispatchRows.Count -eq 1 -and
                $dispatchRows[0].status -eq 'In Progress' -and
                @($dispatchRows[0].bin_ids).Count -eq 1 -and
                $dispatchRows[0].bin_ids[0] -eq $script:primaryBinId) {
                Invoke-StagingRest -Method Delete `
                    -Path "/rest/v1/active_dispatch?id=eq.$($script:createdDispatchId)" `
                    -Headers $script:serviceHeaders | Out-Null
                $remaining = Invoke-StagingRest -Method Get `
                    -Path "/rest/v1/active_dispatch?select=id&id=eq.$($script:createdDispatchId)" `
                    -Headers $script:serviceHeaders
                Write-TestResult -Name 'Temporary dispatch cleanup completed' `
                    -Passed (@($remaining).Count -eq 0) `
                    -Detail $(if (@($remaining).Count -eq 0) { 'The exact temporary dispatch was removed.' } else { 'The temporary dispatch remains; inspect it manually.' })
            } else {
                Write-TestResult -Name 'Temporary dispatch cleanup completed' -Passed $false `
                    -Detail 'The dispatch changed during the test; it was not deleted.'
            }
        } catch {
            Write-TestResult -Name 'Temporary dispatch cleanup completed' -Passed $false `
                -Detail (Protect-Output $_.Exception.Message)
        }
    } else {
        Write-TestResult -Name 'Temporary dispatch cleanup completed' -Passed $true `
            -Detail 'No temporary dispatch was created.'
    }
}

if ($script:setupBlocked) {
    Add-RequiredFailureResults -Reason $script:setupBlocked
}
Add-RequiredFailureResults -Reason 'The test did not reach this check.'

if ($script:failureCount -gt 0) {
    Write-Host "Integration test finished with $($script:failureCount) failure(s)." -ForegroundColor Red
    exit 1
}

Write-Host 'All Collector route address integration checks passed.' -ForegroundColor Green
exit 0
