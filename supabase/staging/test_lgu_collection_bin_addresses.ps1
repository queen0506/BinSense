[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script:results = [ordered]@{}
$script:failureCount = 0
$script:setupBlocked = $null
$script:serviceHeaders = $null
$script:anonHeaders = $null
$script:authUsers = @()
$script:createdAuthUsers = @()
$script:createdProfiles = @()
$script:createdBins = @()
$script:createdConnections = @()
$script:tokens = @()

$script:expectedStagingRef = 'fjdpfjfqcoafnowwelur'
$script:testMarker = 'binsense-lgu-route-address-integration'
$script:lguEmail = 'staging-lgu-route-address@admin.gov.ph'
$script:citizenOneEmail = 'staging-lgu-route-address-citizen-one@example.test'
$script:citizenTwoEmail = 'staging-lgu-route-address-citizen-two@example.test'
$script:collectorEmail = 'staging-lgu-route-address-collector@wastemanagement.com'
$script:fullBinId = 'STAGING-LGU-ROUTE-ADDRESS-FULL-01'
$script:nonFullBinId = 'STAGING-LGU-ROUTE-ADDRESS-NONFULL-01'
$script:multipleCitizensBinId = 'STAGING-LGU-ROUTE-ADDRESS-MULTI-01'

$script:requiredTests = @(
    'Staging project reference verified',
    'Staging REST preflight passed',
    'LGU address RPC is available',
    'Citizen address schema is available',
    'LGU Administrator profile has the exact role',
    'Citizen fixtures have confirmed addresses',
    'Waste Collector profile has the exact role',
    'Test bins and Citizen connections are available',
    'LGU Administrator receives the confirmed address',
    'RPC response contains only the allowed fields',
    'Citizen RPC request is denied',
    'Waste Collector RPC request is denied',
    'Anonymous RPC request is denied',
    'Non-full bin address is not exposed',
    'Multiple-Citizen bin address is not exposed',
    'Temporary fixture cleanup completed'
)

function Protect-Output {
    param([string]$Message)

    $safeMessage = [string]$Message
    foreach ($secret in @(
        $script:stagingAnonKey,
        $script:stagingServiceKey,
        $script:testPassword,
        $script:edgeDeviceSecret
    ) + @($script:tokens | ForEach-Object { $_.Value })) {
        if ($secret) {
            $safeMessage = $safeMessage.Replace([string]$secret, '[REDACTED]')
        }
    }
    $safeMessage = $safeMessage -replace 'Bearer\s+[A-Za-z0-9._-]+', 'Bearer [REDACTED]'
    $safeMessage = $safeMessage -replace 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED-JWT]'
    foreach ($email in @(
        $script:lguEmail,
        $script:citizenOneEmail,
        $script:citizenTwoEmail,
        $script:collectorEmail
    )) {
        if ($email) {
            $safeMessage = $safeMessage.Replace($email, '[test account]')
        }
    }
    if ($safeMessage.Length -gt 350) {
        $safeMessage = $safeMessage.Substring(0, 350) + '...'
    }
    return $safeMessage
}

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
        throw 'More than one Auth account uses a dedicated Staging test email.'
    }
    if ($matches.Count -eq 1) {
        if ($matches[0].user_metadata.test_fixture -ne $script:testMarker) {
            throw 'A dedicated test email is already used by an account not marked as this test fixture.'
        }
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

    $script:createdAuthUsers += [pscustomobject]@{
        id = [string]$created.id
        email = $Email
    }
    $script:authUsers += $created
    return $created
}

function Get-TestProfile {
    param([string]$UserId)

    $response = Invoke-StagingRest -Method Get `
        -Path "/rest/v1/users?select=id,email,name,role,address_confirmed,address_confirmed_at,house_number,street_name,barangay,city_municipality,province&id=eq.$UserId" `
        -Headers $script:serviceHeaders
    return @($response) | Select-Object -First 1
}

function Ensure-TestRoleProfile {
    param(
        [object]$AuthUser,
        [string]$Role,
        [string]$DisplayName
    )

    $profile = Get-TestProfile -UserId $AuthUser.id
    if (-not $profile) {
        $profileHeaders = $script:serviceHeaders.Clone()
        $profileHeaders['Prefer'] = 'resolution=ignore-duplicates,return=representation'
        $inserted = Invoke-StagingRest -Method Post `
            -Path '/rest/v1/users?on_conflict=id' `
            -Headers $profileHeaders `
            -Body @{
                id = $AuthUser.id
                email = $AuthUser.email
                name = $DisplayName
                role = $Role
            }
        if (@($inserted).Count -gt 0) {
            $script:createdProfiles += [pscustomobject]@{
                id = [string]$AuthUser.id
                email = [string]$AuthUser.email
                name = $DisplayName
                role = $Role
            }
        }
        $profile = Get-TestProfile -UserId $AuthUser.id
    }
    if (-not $profile -or $profile.role -ne $Role) {
        throw "The dedicated test profile does not have the exact role '$Role'."
    }
    return $profile
}

function Get-ConfirmedAddressLabel {
    param([object]$Profile)

    if (-not $Profile -or
        $Profile.role -ne 'citizen' -or
        $Profile.address_confirmed -ne $true) {
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

function Ensure-TestCitizen {
    param(
        [object]$AuthUser,
        [string]$DisplayName,
        [string]$HouseNumber,
        [string]$StreetName
    )

    $profile = Ensure-TestRoleProfile -AuthUser $AuthUser `
        -Role 'citizen' -DisplayName $DisplayName
    if (-not (Get-ConfirmedAddressLabel -Profile $profile)) {
        $profileHeaders = $script:serviceHeaders.Clone()
        $profileHeaders['Prefer'] = 'return=minimal'
        Invoke-StagingRest -Method Patch `
            -Path "/rest/v1/users?id=eq.$($AuthUser.id)" `
            -Headers $profileHeaders `
            -Body @{
                house_number = $HouseNumber
                street_name = $StreetName
                barangay = 'East Bajac-Bajac'
                city_municipality = 'Olongapo'
                province = 'Zambales'
                address_confirmed = $true
                address_confirmed_at = [DateTime]::UtcNow.ToString('o')
            } | Out-Null
        $profile = Get-TestProfile -UserId $AuthUser.id
    }
    if (-not (Get-ConfirmedAddressLabel -Profile $profile)) {
        throw 'The dedicated Citizen test profile has no confirmed address.'
    }
    return $profile
}

function Get-TestBin {
    param([string]$BinId)

    $response = Invoke-StagingRest -Method Get `
        -Path "/rest/v1/bins?select=id,status&id=eq.$BinId" `
        -Headers $script:serviceHeaders
    return @($response) | Select-Object -First 1
}

function Ensure-TestBin {
    param(
        [string]$BinId,
        [string]$Status,
        [int]$Level
    )

    $existing = Get-TestBin -BinId $BinId
    if ($existing) {
        if ([string]$existing.status -ine $Status) {
            throw "A dedicated test bin exists with an unexpected status; it was not modified."
        }
        return
    }

    $insertHeaders = $script:serviceHeaders.Clone()
    $insertHeaders['Prefer'] = 'return=minimal'
    Invoke-StagingRest -Method Post -Path '/rest/v1/bins' `
        -Headers $insertHeaders -Body @{
            id = $BinId
            status = $Status
            level = $Level
            volume = $Level
            lat = 14.8354
            lng = 120.2842
        } | Out-Null
    $script:createdBins += [pscustomobject]@{
        id = $BinId
        status = $Status
    }

    $createdBin = Get-TestBin -BinId $BinId
    if (-not $createdBin -or [string]$createdBin.status -ine $Status) {
        throw 'The dedicated Staging test bin was not created with its requested status.'
    }
}

function Get-TestConnections {
    param([string]$BinId)

    $response = Invoke-StagingRest -Method Get `
        -Path "/rest/v1/user_connected_bins?select=user_id,bin_id&bin_id=eq.$BinId" `
        -Headers $script:serviceHeaders
    return @($response)
}

function Ensure-TestConnections {
    param(
        [string]$BinId,
        [string[]]$ExpectedUserIds
    )

    $expected = @($ExpectedUserIds | Sort-Object -Unique)
    $connections = Get-TestConnections -BinId $BinId
    $existingIds = @($connections | ForEach-Object { [string]$_.user_id } | Sort-Object -Unique)
    $unexpectedIds = @($existingIds | Where-Object { $expected -notcontains $_ })
    if ($unexpectedIds.Count -gt 0) {
        throw 'A dedicated test bin has a connection to a non-test account; no existing link was changed.'
    }

    foreach ($userId in $expected) {
        if ($existingIds -contains $userId) {
            continue
        }
        $connectionHeaders = $script:serviceHeaders.Clone()
        $connectionHeaders['Prefer'] = 'return=minimal'
        Invoke-StagingRest -Method Post -Path '/rest/v1/user_connected_bins' `
            -Headers $connectionHeaders `
            -Body @{ user_id = $userId; bin_id = $BinId } | Out-Null
        $script:createdConnections += [pscustomobject]@{
            user_id = $userId
            bin_id = $BinId
        }
    }

    $connections = Get-TestConnections -BinId $BinId
    $actualIds = @($connections | ForEach-Object { [string]$_.user_id } | Sort-Object -Unique)
    if (@($connections).Count -ne $expected.Count -or
        (Compare-Object $expected $actualIds)) {
        throw 'The dedicated test bin does not have exactly the requested Citizen connections.'
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
        [string[]]$BinIds
    )

    $rows = Invoke-StagingRest -Method Post `
        -Path '/rest/v1/rpc/get_lgu_collection_bin_addresses' `
        -Headers $Headers `
        -Body @{ p_bin_ids = $BinIds }
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
        $null = Invoke-AddressRpc -Headers $Headers -BinIds @($BinId)
        return @{ Denied = $false; Detail = 'The RPC returned a successful response.' }
    } catch {
        $message = Protect-Output $_.Exception.Message
        if ($message -match 'status=(401|403)\b') {
            return @{ Denied = $true; Detail = "Request rejected with HTTP $($matches[1])." }
        }
        return @{ Denied = $false; Detail = $message }
    }
}

function Remove-TestFixtures {
    $cleanupErrors = New-Object 'System.Collections.Generic.List[string]'

    foreach ($connection in $script:createdConnections) {
        try {
            Invoke-StagingRest -Method Delete `
                -Path "/rest/v1/user_connected_bins?user_id=eq.$($connection.user_id)&bin_id=eq.$($connection.bin_id)" `
                -Headers $script:serviceHeaders | Out-Null
            if (@(Get-TestConnections -BinId $connection.bin_id |
                    Where-Object { $_.user_id -eq $connection.user_id }).Count -gt 0) {
                $cleanupErrors.Add('A test-created Citizen connection remains.')
            }
        } catch {
            $cleanupErrors.Add((Protect-Output $_.Exception.Message))
        }
    }

    foreach ($bin in $script:createdBins) {
        try {
            $existing = Get-TestBin -BinId $bin.id
            if (-not $existing) {
                continue
            }
            if ([string]$existing.status -ine [string]$bin.status) {
                $cleanupErrors.Add('A test-created bin changed during the test and was not deleted.')
                continue
            }
            $remainingConnections = Get-TestConnections -BinId $bin.id
            if (@($remainingConnections).Count -gt 0) {
                $cleanupErrors.Add('A test-created bin still has connections and was not deleted.')
                continue
            }

            Invoke-StagingRest -Method Delete `
                -Path "/rest/v1/bins?id=eq.$($bin.id)" `
                -Headers $script:serviceHeaders | Out-Null
            if (Get-TestBin -BinId $bin.id) {
                $cleanupErrors.Add('A test-created bin remains after cleanup.')
            }
        } catch {
            $cleanupErrors.Add((Protect-Output $_.Exception.Message))
        }
    }

    foreach ($profile in $script:createdProfiles) {
        $isNewAuthUser = @($script:createdAuthUsers |
            Where-Object { $_.id -eq $profile.id }).Count -gt 0
        if ($isNewAuthUser) {
            continue
        }
        try {
            $profileNow = Get-TestProfile -UserId $profile.id
            if (-not $profileNow) {
                continue
            }
            if ($profileNow.email -ine $profile.email -or
                $profileNow.name -ne $profile.name -or
                $profileNow.role -ne $profile.role) {
                $cleanupErrors.Add('A profile created by the test changed and was not deleted.')
                continue
            }
            Invoke-StagingRest -Method Delete `
                -Path "/rest/v1/users?id=eq.$($profile.id)" `
                -Headers $script:serviceHeaders | Out-Null
            if (Get-TestProfile -UserId $profile.id) {
                $cleanupErrors.Add('A test-created profile remains after cleanup.')
            }
        } catch {
            $cleanupErrors.Add((Protect-Output $_.Exception.Message))
        }
    }

    foreach ($authUser in $script:createdAuthUsers) {
        try {
            $remainingConnections = Invoke-StagingRest -Method Get `
                -Path "/rest/v1/user_connected_bins?select=bin_id&user_id=eq.$($authUser.id)" `
                -Headers $script:serviceHeaders
            if (@($remainingConnections).Count -gt 0) {
                $cleanupErrors.Add('A newly created test account still has a connection and was not deleted.')
                continue
            }

            $currentAuthUser = Invoke-StagingRest -Method Get `
                -Path "/auth/v1/admin/users/$($authUser.id)" `
                -Headers $script:serviceHeaders
            if ($currentAuthUser.email -ine $authUser.email -or
                $currentAuthUser.user_metadata.test_fixture -ne $script:testMarker) {
                $cleanupErrors.Add('A newly created Auth account no longer matches its test marker and was not deleted.')
                continue
            }
            Invoke-StagingRest -Method Delete `
                -Path "/auth/v1/admin/users/$($authUser.id)" `
                -Headers $script:serviceHeaders | Out-Null
            try {
                $remainingAuthUser = Invoke-StagingRest -Method Get `
                    -Path "/auth/v1/admin/users/$($authUser.id)" `
                    -Headers $script:serviceHeaders
                if ($remainingAuthUser.id) {
                    $cleanupErrors.Add('A test-created Auth account remains after cleanup.')
                }
            } catch {
                if ($_.Exception.Message -notmatch 'status=404\b') {
                    throw
                }
            }
        } catch {
            $cleanupErrors.Add((Protect-Output $_.Exception.Message))
        }
    }

    if ($cleanupErrors.Count -eq 0) {
        Write-TestResult -Name 'Temporary fixture cleanup completed' -Passed $true `
            -Detail 'Fixtures created during this run were removed; pre-existing test fixtures were retained.'
    } else {
        Write-TestResult -Name 'Temporary fixture cleanup completed' -Passed $false `
            -Detail ($cleanupErrors -join ' ')
    }
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

    $stagingUri = [Uri]$script:stagingUrl
    $referenceIsValid = (
        $script:stagingRef -eq $script:expectedStagingRef -and
        $stagingUri.Scheme -eq 'https' -and
        $stagingUri.Host -eq "$($script:stagingRef).supabase.co" -and
        $script:stagingRef -ne $script:productionRef
    )
    Write-TestResult -Name 'Staging project reference verified' -Passed $referenceIsValid `
        -Detail $(if ($referenceIsValid) {
            "Verified Staging ref $($script:stagingRef); production ref rejected."
        } else {
            'Configured URL or project reference is not the verified BinSense-Staging target.'
        })
    if (-not $referenceIsValid) {
        throw 'Staging target verification failed; no API requests or fixture writes were made.'
    }

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
        $rpcVisible = @($apiSchema.paths.PSObject.Properties.Name) `
            -contains '/rpc/get_lgu_collection_bin_addresses'
    }
    Write-TestResult -Name 'LGU address RPC is available' -Passed $rpcVisible `
        -Detail $(if ($rpcVisible) {
            'RPC is present in the Staging API schema.'
        } else {
            'Apply the reviewed LGU address RPC migration to Staging before running fixture tests.'
        })
    if (-not $rpcVisible) {
        throw 'LGU address RPC is not available in the Staging API schema.'
    }

    Invoke-StagingRest -Method Get `
        -Path '/rest/v1/users?select=id,address_confirmed,address_confirmed_at,house_number,street_name,barangay,city_municipality,province&limit=0' `
        -Headers $script:serviceHeaders | Out-Null
    Write-TestResult -Name 'Citizen address schema is available' -Passed $true `
        -Detail 'The required confirmed-address fields are exposed in Staging.'

    $script:serviceHeaders['Prefer'] = 'return=representation'
    $script:authUsers = @(Get-TestAuthUsers)

    $lguAuth = Ensure-TestAuthUser -Email $script:lguEmail `
        -DisplayName 'Staging LGU Route Address Test Administrator'
    $citizenOneAuth = Ensure-TestAuthUser -Email $script:citizenOneEmail `
        -DisplayName 'Staging LGU Route Address Test Citizen One'
    $citizenTwoAuth = Ensure-TestAuthUser -Email $script:citizenTwoEmail `
        -DisplayName 'Staging LGU Route Address Test Citizen Two'
    $collectorAuth = Ensure-TestAuthUser -Email $script:collectorEmail `
        -DisplayName 'Staging LGU Route Address Test Collector'

    $lguProfile = Ensure-TestRoleProfile -AuthUser $lguAuth `
        -Role 'lgu admin' -DisplayName 'Staging LGU Route Address Test Administrator'
    Write-TestResult -Name 'LGU Administrator profile has the exact role' -Passed $true `
        -Detail 'The dedicated Auth UUID has a public.users profile with role lgu admin.'

    $citizenOneProfile = Ensure-TestCitizen -AuthUser $citizenOneAuth `
        -DisplayName 'Staging LGU Route Address Test Citizen One' `
        -HouseNumber '#10' -StreetName 'Staging Route Test Street'
    $citizenTwoProfile = Ensure-TestCitizen -AuthUser $citizenTwoAuth `
        -DisplayName 'Staging LGU Route Address Test Citizen Two' `
        -HouseNumber '#20' -StreetName 'Staging Route Test Avenue'
    $citizenOneAddress = Get-ConfirmedAddressLabel -Profile $citizenOneProfile
    $citizenTwoAddress = Get-ConfirmedAddressLabel -Profile $citizenTwoProfile
    if ($citizenOneAddress -eq $citizenTwoAddress) {
        throw 'The dedicated multiple-Citizen fixtures must have different confirmed addresses.'
    }
    Write-TestResult -Name 'Citizen fixtures have confirmed addresses' -Passed $true `
        -Detail 'Both dedicated Citizen profiles have distinct confirmed address labels.'

    $collectorProfile = Ensure-TestRoleProfile -AuthUser $collectorAuth `
        -Role 'waste collector' -DisplayName 'Staging LGU Route Address Test Collector'
    Write-TestResult -Name 'Waste Collector profile has the exact role' -Passed $true `
        -Detail 'The dedicated Auth UUID has a public.users profile with role waste collector.'

    Ensure-TestBin -BinId $script:fullBinId -Status 'full' -Level 100
    Ensure-TestBin -BinId $script:nonFullBinId -Status 'available' -Level 0
    Ensure-TestBin -BinId $script:multipleCitizensBinId -Status 'full' -Level 100
    Ensure-TestConnections -BinId $script:fullBinId `
        -ExpectedUserIds @([string]$citizenOneAuth.id)
    Ensure-TestConnections -BinId $script:nonFullBinId `
        -ExpectedUserIds @([string]$citizenOneAuth.id)
    Ensure-TestConnections -BinId $script:multipleCitizensBinId `
        -ExpectedUserIds @([string]$citizenOneAuth.id, [string]$citizenTwoAuth.id)
    Write-TestResult -Name 'Test bins and Citizen connections are available' -Passed $true `
        -Detail 'Dedicated full, non-full, and multi-Citizen bins have the intended links.'

    $script:lguToken = Get-TestAccessToken -Email $script:lguEmail
    $script:citizenToken = Get-TestAccessToken -Email $script:citizenOneEmail
    $script:collectorToken = Get-TestAccessToken -Email $script:collectorEmail
    $script:tokens = @(
        [pscustomobject]@{ Value = $script:lguToken },
        [pscustomobject]@{ Value = $script:citizenToken },
        [pscustomobject]@{ Value = $script:collectorToken }
    )
    $lguHeaders = @{
        apikey = $script:stagingAnonKey
        Authorization = "Bearer $($script:lguToken)"
        'Content-Type' = 'application/json'
    }
    $citizenHeaders = @{
        apikey = $script:stagingAnonKey
        Authorization = "Bearer $($script:citizenToken)"
        'Content-Type' = 'application/json'
    }
    $collectorHeaders = @{
        apikey = $script:stagingAnonKey
        Authorization = "Bearer $($script:collectorToken)"
        'Content-Type' = 'application/json'
    }

    $fullRows = @()
    try {
        $fullRows = @(Invoke-AddressRpc -Headers $lguHeaders -BinIds @($script:fullBinId))
        $singleRow = @($fullRows | Where-Object { $_.bin_id -eq $script:fullBinId })
        $addressMatches = (
            $singleRow.Count -eq 1 -and
            $singleRow[0].location_label -eq $citizenOneAddress
        )
        Write-TestResult -Name 'LGU Administrator receives the confirmed address' `
            -Passed $addressMatches `
            -Detail $(if ($addressMatches) {
                'The unique connected Citizen address matches the confirmed profile.'
            } else {
                'Expected one row with the exact formatted address for the full test bin.'
            })

        $shapeMatches = $singleRow.Count -eq 1
        if ($shapeMatches) {
            $actualKeys = @($singleRow[0].PSObject.Properties.Name | Sort-Object)
            $expectedKeys = @('bin_id', 'location_label')
            $shapeMatches = -not (Compare-Object $expectedKeys $actualKeys)
        }
        Write-TestResult -Name 'RPC response contains only the allowed fields' `
            -Passed $shapeMatches `
            -Detail $(if ($shapeMatches) {
                'Only bin_id and location_label were returned.'
            } else {
                'Expected exactly bin_id and location_label in one result row.'
            })
    } catch {
        $detail = Protect-Output $_.Exception.Message
        Write-TestResult -Name 'LGU Administrator receives the confirmed address' `
            -Passed $false -Detail $detail
        Write-TestResult -Name 'RPC response contains only the allowed fields' `
            -Passed $false -Detail 'Not verifiable because the LGU RPC request failed.'
    }

    $citizenDenied = Test-RpcDenied -Headers $citizenHeaders -BinId $script:fullBinId
    Write-TestResult -Name 'Citizen RPC request is denied' -Passed $citizenDenied.Denied `
        -Detail $citizenDenied.Detail

    $collectorDenied = Test-RpcDenied -Headers $collectorHeaders -BinId $script:fullBinId
    Write-TestResult -Name 'Waste Collector RPC request is denied' -Passed $collectorDenied.Denied `
        -Detail $collectorDenied.Detail

    $anonymousDenied = Test-RpcDenied -Headers $script:anonHeaders -BinId $script:fullBinId
    Write-TestResult -Name 'Anonymous RPC request is denied' -Passed $anonymousDenied.Denied `
        -Detail $anonymousDenied.Detail

    try {
        $nonFullRows = @(Invoke-AddressRpc -Headers $lguHeaders -BinIds @($script:nonFullBinId))
        $nonFullHidden = $nonFullRows.Count -eq 0
        Write-TestResult -Name 'Non-full bin address is not exposed' -Passed $nonFullHidden `
            -Detail $(if ($nonFullHidden) {
                'No address was returned for the available test bin.'
            } else {
                'The RPC returned an address for a bin that is not full.'
            })
    } catch {
        Write-TestResult -Name 'Non-full bin address is not exposed' -Passed $false `
            -Detail (Protect-Output $_.Exception.Message)
    }

    try {
        $multipleRows = @(Invoke-AddressRpc -Headers $lguHeaders -BinIds @($script:multipleCitizensBinId))
        $multipleHidden = $multipleRows.Count -eq 0
        Write-TestResult -Name 'Multiple-Citizen bin address is not exposed' `
            -Passed $multipleHidden `
            -Detail $(if ($multipleHidden) {
                'No address was returned for the bin connected to two Citizens.'
            } else {
                'The RPC returned an address for a bin connected to multiple Citizens.'
            })
    } catch {
        Write-TestResult -Name 'Multiple-Citizen bin address is not exposed' -Passed $false `
            -Detail (Protect-Output $_.Exception.Message)
    }
} catch {
    $script:setupBlocked = Protect-Output $_.Exception.Message
} finally {
    if ($script:serviceHeaders) {
        Remove-TestFixtures
    } else {
        Write-TestResult -Name 'Temporary fixture cleanup completed' -Passed $true `
            -Detail 'No Staging fixture writes were made.'
    }
}

if ($script:setupBlocked) {
    Add-RequiredFailureResults -Reason $script:setupBlocked
}
Add-RequiredFailureResults -Reason 'The test did not reach this check.'

if ($script:failureCount -gt 0) {
    Write-Host "LGU route address integration test finished with $($script:failureCount) failure(s)." -ForegroundColor Red
    exit 1
}

Write-Host 'All LGU route address integration checks passed.' -ForegroundColor Green
exit 0
