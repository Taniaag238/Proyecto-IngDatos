[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Initialize','Verify','Promote','Rewind','Clone','Start','Stop')]
    [string]$Action,
    [Parameter(Mandatory)][string]$EnvFile,
    [Parameter(Mandatory)][ValidatePattern('^ventas-pg-repl-[a-z0-9-]+$')][string]$Project,
    [ValidateSet('pg1','pg2')][string]$Target,
    [string]$Context = 'desktop-linux'
)

$ErrorActionPreference = 'Stop'
$compose = @('--context',$Context,'compose','-p',$Project,'--env-file',
    (Resolve-Path -LiteralPath $EnvFile).Path,'-f',(Join-Path $PSScriptRoot 'docker-compose.yml'))

function Compose([string[]]$Arguments) {
    $result = & docker @compose @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Compose failed: $($Arguments[0])." }
    $result
}

function Sql($Node,$Query) {
    $result = $Query | & docker @compose exec -T --user postgres $Node bash -c '
        if [[ $PG_NODE == pg1 ]]; then port=$PG_NODE1_PORT; else port=$PG_NODE2_PORT; fi
        pg_isready -q -h 127.0.0.1 -p "$port" || exit 1
        exec psql -XAt -p "$port" -U pgadmin -d ventas_operaciones -v ON_ERROR_STOP=1'
    if ($LASTEXITCODE -ne 0) { throw "SQL failed on $Node." }
    $result
}

function Wait-Ready([string]$Description,[scriptblock]$Check) {
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    do {
        try { if (& $Check) { return } } catch {}
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timeout: $Description."
}

function Writer {
    if (Test-Path -LiteralPath $writerFile) { [IO.File]::ReadAllText($writerFile).Trim() }
}

function Set-Writer([string]$Name) {
    [IO.File]::WriteAllText($pendingWriterFile, "$Name`n", [Text.Encoding]::ASCII)
    if ([IO.File]::Exists($writerFile)) {
        [IO.File]::Replace($pendingWriterFile,$writerFile,[NullString]::Value)
    } else {
        [IO.File]::Move($pendingWriterFile,$writerFile)
    }
}

function Other-Node($Node) {
    if ($Node -eq 'pg1') { 'pg2' } else { 'pg1' }
}

function Require-Writer {
    $name = Writer
    if ($name -notin @('pg1','pg2')) { throw 'Writer is fenced or uninitialized. Inspect roles before intervening.' }
    $name
}

function Local-Role($Node) {
    Sql $Node "SELECT CASE WHEN pg_is_in_recovery() THEN 'standby' WHEN current_setting('transaction_read_only')::boolean THEN 'read-only' ELSE 'primary' END;"
}

function Stop-Node($Node) {
    Compose @('stop','--timeout','120',$Node)
    if (@(Compose @('ps','--status','running','-q',$Node)).Count) { throw "$Node is still running." }
}

function Copy-Node($Node,$Method) {
    if ($Method -eq 'basebackup' -and (Compose @('run','--rm','--no-deps',$Node,'inspect')) -ne 'empty') {
        throw 'A new empty volume is required for the base backup.'
    }
    Stop-Node $Node
    Compose @('run','--rm','--no-deps',$Node,$Method)
    Compose @('up','-d','--no-deps',$Node)
}

function Assert-Proxy {
    $query = "SELECT NOT pg_is_in_recovery() AND NOT current_setting('transaction_read_only')::boolean;"
    $check = $query | & docker @compose exec -T haproxy bash -c 'export PGPASSWORD=$PG_CHECK_PASSWORD PGCONNECT_TIMEOUT=2; exec psql -XAtw -h 127.0.0.1 -p 5432 -U pgcheck -d ventas_operaciones'
    $LASTEXITCODE -eq 0 -and $check -eq 't'
}

function Verify-Cluster {
    $primary = Require-Writer
    $standby = Other-Node $primary
    Wait-Ready 'writable primary' { (Local-Role $primary 2>$null) -eq 'primary' }
    Wait-Ready 'streaming standby' {
        (Local-Role $standby 2>$null) -eq 'standby' -and
        (Sql $primary "SELECT count(*) FROM pg_stat_replication WHERE application_name='$standby' AND state='streaming';") -eq '1'
    }
    Wait-Ready 'writer endpoint' { Assert-Proxy 2>$null }
    $lsn = Sql $primary 'SELECT pg_current_wal_flush_lsn();'
    $lag = Sql $primary "SELECT state,sync_state,pg_wal_lsn_diff('$lsn',replay_lsn) FROM pg_stat_replication WHERE application_name='$standby';"
    "Primary=$primary standby=$standby flush_lsn=$lsn state|mode|lag_bytes=$lag"
    Wait-Ready "replay through $lsn" { (Sql $standby "SELECT pg_last_wal_replay_lsn() >= '$lsn'::pg_lsn;") -eq 't' }
    $query = Get-Content -Raw (Join-Path $PSScriptRoot 'config/verify.sql')
    $primaryRows = @(Sql $primary $query)
    $standbyRows = @(Sql $standby $query)
    if (($primaryRows + $standbyRows) -match '^sequence\|.*\|f$') {
        throw 'A sequence is behind existing identifiers.'
    }
    if (Compare-Object $primaryRows $standbyRows -SyncWindow 0) {
        throw 'Catalog or data differ. Pause writes and retry.'
    }
    if ((Sql $primary 'SELECT pg_current_wal_flush_lsn();') -ne $lsn -and
        (Compare-Object $primaryRows @(Sql $primary $query) -SyncWindow 0)) {
        throw 'Catalog changed during the comparison. Pause writes and retry.'
    }
    $primaryRows
}

$cfg = (Compose @('config','--format','json') | Out-String) | ConvertFrom-Json
$stateDirectory = @($cfg.services.haproxy.volumes | Where-Object target -eq '/authority')[0].source
$writerFile = Join-Path $stateDirectory 'writer'
$pendingWriterFile = Join-Path $stateDirectory 'writer.pending'
$volumeNames = @($cfg.volumes.pg1.name,$cfg.volumes.pg2.name)
if ($volumeNames[0] -eq $volumeNames[1] -or @($volumeNames | Where-Object {$_ -notmatch "^$($Project)_[a-z0-9_-]+$"}).Count) {
    throw 'Node data volumes must be distinct and scoped to this project.'
}
foreach ($key in @('POSTGRES_PASSWORD','PG_APP_PASSWORD','PG_REPL_PASSWORD','PG_CHECK_PASSWORD')) {
    if ($cfg.services.pg1.environment.$key -cnotmatch '^[A-Za-z0-9_!@%+=.,-]{12,128}$') {
        throw "Set a password of 12 to 128 allowed characters for $key."
    }
}
if (-not (Test-Path -LiteralPath $stateDirectory)) {
    if ($Action -ne 'Initialize') { throw 'Missing authority directory.' }
    New-Item -ItemType Directory -Path $stateDirectory | Out-Null
}

$lockPath = Join-Path $stateDirectory 'operation.lock'
$lock = [IO.File]::Open($lockPath,'OpenOrCreate','ReadWrite','None')
try {
    $projectFile = Join-Path $stateDirectory 'project'
    if (-not (Test-Path -LiteralPath $projectFile)) {
        if ($Action -ne 'Initialize' -or (Writer)) { throw 'Authority directory has no project identity.' }
        [IO.File]::WriteAllText($projectFile,$Project,[Text.Encoding]::ASCII)
    }
    if ([IO.File]::ReadAllText($projectFile) -ne $Project) { throw 'Authority belongs to a different project.' }
    switch ($Action) {
        Initialize {
            if (-not (Writer)) {
                foreach ($node in @('pg1','pg2')) {
                    if ((Compose @('run','--rm','--no-deps',$node,'inspect')) -ne 'empty') {
                        throw 'An existing data volume requires its original authority file.'
                    }
                }
                Set-Writer 'pg1'
            }
            $primary = Require-Writer
            $standby = Other-Node $primary
            Compose @('up','-d','--no-deps',$primary)
            Wait-Ready 'primary initialization' { (Local-Role $primary 2>$null) -eq 'primary' }
            $existing = if (@(Compose @('ps','--status','running','-q',$standby)).Count) { 'running' }
                else { Compose @('run','--rm','--no-deps',$standby,'inspect') }
            if ($existing -eq 'empty') { Copy-Node $standby 'basebackup' }
            elseif ($existing -eq 'standby') { Compose @('up','-d','--no-deps',$standby) }
            elseif ($existing -ne 'running') { throw 'Partial standby volume. Preserve it and choose a new volume.' }
            Compose @('up','-d','--no-deps','haproxy')
            Verify-Cluster
        }
        Verify { Verify-Cluster }
        Stop {
            Require-Writer | Out-Null
            Compose @('stop','--timeout','120','haproxy')
            Compose @('stop','--timeout','120',(Other-Node (Writer)),(Writer))
        }
        Start {
            $primary = Require-Writer
            Compose @('start',$primary)
            Wait-Ready 'primary after start' { (Local-Role $primary 2>$null) -eq 'primary' }
            Compose @('start',(Other-Node $primary),'haproxy')
            Verify-Cluster
        }
        Promote {
            if (-not $Target) { throw 'Choose the standby explicitly with -Target pg1 or pg2.' }
            $old = Require-Writer
            $candidate = $Target
            if ($candidate -eq $old) {
                Wait-Ready 'existing writer through HAProxy' { Assert-Proxy 2>$null }
                "Writer=$candidate"
                break
            }
            if ((Local-Role $candidate) -ne 'standby') { throw 'Only a running standby can be promoted.' }
            Compose @('stop','--timeout','120','haproxy')
            Stop-Node $old
            Set-Writer 'none'
            if ((Sql $candidate 'SELECT pg_promote(true,60);') -ne 't' -or (Local-Role $candidate) -ne 'primary') {
                throw 'Promotion failed. The writer remains fenced.'
            }
            Set-Writer $candidate
            Compose @('start','haproxy')
            Wait-Ready 'promoted writer through HAProxy' { Assert-Proxy 2>$null }
            "Writer=$candidate"
        }
        Rewind {
            $primary = Require-Writer
            if ((Local-Role $primary) -ne 'primary') { throw 'The authorized writer must be online.' }
            $standby = Other-Node $primary
            if ((Compose @('run','--rm','--no-deps',$standby,'inspect')) -eq 'standby') {
                Compose @('start',$standby)
            } else {
                Sql $primary 'CHECKPOINT;'
                Copy-Node $standby 'rewind'
            }
            Verify-Cluster
        }
        Clone {
            $primary = Require-Writer
            if ((Local-Role $primary) -ne 'primary') { throw 'The authorized writer must be online.' }
            Copy-Node (Other-Node $primary) 'basebackup'
            Verify-Cluster
        }
    }
} finally {
    $lock.Dispose()
}
