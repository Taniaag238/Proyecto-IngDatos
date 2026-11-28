[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Initialize', 'Recover', 'Verify', 'Seed')]
    [string]$Action,

    [Parameter(Mandatory)]
    [string]$EnvFile,

    [ValidatePattern('^[a-z0-9][a-z0-9_-]*$')]
    [string]$Project = 'ventas-mysql-cluster-local',

    [string]$Context = 'desktop-linux'
)

$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot 'docker-compose.yml'
$composeArgs = @('--context', $Context, 'compose', '--project-name', $Project,
    '--env-file', (Resolve-Path -LiteralPath $EnvFile).Path, '-f', $composeFile)
$nodes = @('mysql-test-1', 'mysql-test-2', 'mysql-test-3')
$expected = '1000,1000,22000,22000,8000'
$catalog = @('categorias', 'proveedores', 'clientes', 'clientes_contacto', 'productos')
$settings = @{}

function Invoke-Compose([string[]]$Arguments) {
    $result = & docker @composeArgs @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed ($($Arguments[0]))." }
    $result
}

function Invoke-MySql($Node, $Sql) {
    $result = $Sql | & docker @composeArgs exec -T $Node sh -c 'export MYSQL_PWD=$MYSQL_ROOT_PASSWORD; exec mysql --protocol=tcp --host=localhost -uroot -N -B'
    if ($LASTEXITCODE -ne 0) { throw "MySQL query failed on $Node." }
    $result
}

function Invoke-Proxy($Sql, $Password = $settings.PROXYSQL_ADMIN_PASSWORD) {
    $inputLines = @($Password, $Sql)
    $result = $inputLines | & docker @composeArgs exec -T proxysql bash -c 'IFS= read -r MYSQL_PWD; MYSQL_PWD=${MYSQL_PWD%$''\r''}; export MYSQL_PWD; exec mysql --protocol=tcp --host=localhost --port=6032 --user=admin -N -B'
    if ($LASTEXITCODE -ne 0) { throw 'ProxySQL admin query failed.' }
    $result
}

function Invoke-ProxyApp($Sql) {
    $inputLines = @($settings.MYSQL_PASSWORD, $Sql)
    $result = $inputLines | & docker @composeArgs exec -T proxysql bash -c 'IFS= read -r MYSQL_PWD; MYSQL_PWD=${MYSQL_PWD%$''\r''}; export MYSQL_PWD; exec mysql --protocol=tcp --host=localhost --port=6033 --user=ventas_app --database=ventas_catalogo -N -B'
    if ($LASTEXITCODE -ne 0) { throw 'ProxySQL application query failed.' }
    $result
}

function Wait-Until($Description, [scriptblock]$Check, $Seconds = 120) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        try { if (& $Check) { return } } catch { }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out waiting for $Description."
}

function Get-Group {
    foreach ($node in $nodes) {
        $row = Invoke-MySql $node @"
SELECT @@server_uuid, @@GLOBAL.group_replication_group_name,
       COALESCE(NULLIF(@@GLOBAL.gtid_executed, ''), '-'),
       COALESCE(NULLIF((SELECT RECEIVED_TRANSACTION_SET FROM performance_schema.replication_connection_status
                        WHERE CHANNEL_NAME='group_replication_applier'), ''), '-'),
       COALESCE((SELECT MEMBER_STATE FROM performance_schema.replication_group_members WHERE MEMBER_ID=@@server_uuid), 'OFFLINE'),
       COALESCE(NULLIF((SELECT MEMBER_ROLE FROM performance_schema.replication_group_members WHERE MEMBER_ID=@@server_uuid), ''), '-');
"@
        $uuid, $group, $executed, $received, $state, $role = $row -split "`t"
        if ($group -ne $settings.MYSQL_GROUP_UUID) { throw "Unexpected group UUID on $node." }
        [pscustomobject]@{ Node=$node; Uuid=$uuid; Executed=$executed;
            Received=$received; State=$state; Role=$role }
    }
}

function Start-Group($Founder) {
    try {
        Invoke-MySql $Founder 'SET GLOBAL group_replication_bootstrap_group=ON; START GROUP_REPLICATION;'
    } finally {
        Invoke-MySql $Founder 'SET GLOBAL group_replication_bootstrap_group=OFF;'
    }
    Wait-Until "$Founder to become writable PRIMARY" { Test-StandalonePrimary $Founder }
}

function Test-StandalonePrimary($Node) {
    $state = Invoke-MySql $Node @"
SELECT IF(COUNT(*)=1 AND SUM(MEMBER_ID=@@server_uuid AND MEMBER_STATE='ONLINE'
       AND MEMBER_ROLE='PRIMARY')=1 AND @@GLOBAL.super_read_only=0,1,0)
FROM performance_schema.replication_group_members;
"@
    $state -eq '1'
}

function Set-RecoveryChannel($Node) {
    Invoke-MySql $Node @"
SET SESSION sql_log_bin=0;
CREATE USER IF NOT EXISTS 'replicador'@'%' IDENTIFIED BY '$($settings.MYSQL_REPL_PASSWORD)';
ALTER USER 'replicador'@'%' IDENTIFIED BY '$($settings.MYSQL_REPL_PASSWORD)';
GRANT REPLICATION SLAVE, CONNECTION_ADMIN, BACKUP_ADMIN, GROUP_REPLICATION_STREAM ON *.* TO 'replicador'@'%';
CHANGE REPLICATION SOURCE TO SOURCE_USER='replicador', SOURCE_PASSWORD='$($settings.MYSQL_REPL_PASSWORD)'
FOR CHANNEL 'group_replication_recovery';
"@
}

function Join-Group($Group) {
    if (@($Group | Where-Object State -notin @('ONLINE', 'OFFLINE')).Count) {
        throw 'A member is recovering or in an unexpected state. Verify the group before retrying.'
    }
    foreach ($member in ($Group | Where-Object State -eq 'OFFLINE')) {
        Invoke-MySql $member.Node 'START GROUP_REPLICATION;'
    }
}

function Get-HealthyGroup {
    Wait-Until 'three ONLINE members and one PRIMARY' {
        $rows = @(Get-Group)
        @($rows | Where-Object State -eq 'ONLINE').Count -eq 3 -and
            @($rows | Where-Object Role -eq 'PRIMARY').Count -eq 1
    }
    $group = @(Get-Group)
    $primary = ($group | Where-Object Role -eq 'PRIMARY').Node
    $expectedMembers = ($nodes | Sort-Object) -join ','
    foreach ($node in $nodes) {
        $view = Invoke-MySql $node "SELECT GROUP_CONCAT(MEMBER_HOST ORDER BY MEMBER_HOST),MAX(CASE WHEN MEMBER_ROLE='PRIMARY' THEN MEMBER_HOST END),SUM(MEMBER_ROLE='PRIMARY') FROM performance_schema.replication_group_members WHERE MEMBER_STATE='ONLINE';"
        if ($view -ne "$expectedMembers`t$primary`t1") { throw "Inconsistent membership view on $node." }
    }
    $group
}

function Initialize-Catalog($Primary) {
    $accounts = Invoke-MySql $Primary "SELECT COUNT(*) FROM mysql.user WHERE Host='%' AND User IN ('ventas_app','proxysql_monitor');"
    $tables = Invoke-MySql $Primary "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='ventas_catalogo' AND table_name IN ('categorias','proveedores','clientes','clientes_contacto','productos');"
    if ($tables -ne '5') {
        $schema = Join-Path $PSScriptRoot '../../databases/mysql/schema.sql'
        Invoke-MySql $Primary (Get-Content -LiteralPath $schema -Raw -Encoding UTF8)
    }
    if ($accounts -ne '2') {
        Invoke-MySql $Primary @"
CREATE USER IF NOT EXISTS 'ventas_app'@'%' IDENTIFIED BY '$($settings.MYSQL_PASSWORD)';
GRANT ALL PRIVILEGES ON ventas_catalogo.* TO 'ventas_app'@'%';
CREATE USER IF NOT EXISTS 'proxysql_monitor'@'%' IDENTIFIED BY '$($settings.MYSQL_MONITOR_PASSWORD)';
GRANT REPLICATION CLIENT ON *.* TO 'proxysql_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'proxysql_monitor'@'%';
"@
    }
}

function Initialize-Proxy {
    $password = $settings.PROXYSQL_ADMIN_PASSWORD
    try { $null = Invoke-Proxy 'SELECT 1;' 2>$null }
    catch {
        if ((Invoke-Proxy 'SELECT COUNT(*) FROM mysql_users;' 'admin') -ne '0') {
            throw 'Existing ProxySQL configuration requires its current admin password.'
        }
        Invoke-Proxy @"
UPDATE global_variables SET variable_value='admin:$password' WHERE variable_name='admin-admin_credentials';
LOAD ADMIN VARIABLES TO RUNTIME;
SAVE ADMIN VARIABLES TO DISK;
"@ 'admin'
    }
    Invoke-Proxy @"
UPDATE global_variables SET variable_value='proxysql_monitor' WHERE variable_name='mysql-monitor_username';
UPDATE global_variables SET variable_value='$($settings.MYSQL_MONITOR_PASSWORD)' WHERE variable_name='mysql-monitor_password';
UPDATE global_variables SET variable_value='true' WHERE variable_name='mysql-monitor_enabled';
LOAD MYSQL VARIABLES TO RUNTIME;
SAVE MYSQL VARIABLES TO DISK;
INSERT INTO mysql_servers (hostgroup_id,hostname,port,max_connections,use_ssl)
SELECT 10,'mysql-test-1',3306,100,1 WHERE NOT EXISTS (
    SELECT 1 FROM mysql_servers WHERE hostname='mysql-test-1' AND port=3306
);
INSERT INTO mysql_servers (hostgroup_id,hostname,port,max_connections,use_ssl)
SELECT 30,'mysql-test-2',3306,100,1 WHERE NOT EXISTS (
    SELECT 1 FROM mysql_servers WHERE hostname='mysql-test-2' AND port=3306
);
INSERT INTO mysql_servers (hostgroup_id,hostname,port,max_connections,use_ssl)
SELECT 30,'mysql-test-3',3306,100,1 WHERE NOT EXISTS (
    SELECT 1 FROM mysql_servers WHERE hostname='mysql-test-3' AND port=3306
);
UPDATE mysql_servers SET use_ssl=1 WHERE hostname IN ('mysql-test-1','mysql-test-2','mysql-test-3') AND port=3306;
INSERT OR REPLACE INTO mysql_group_replication_hostgroups
(writer_hostgroup,backup_writer_hostgroup,reader_hostgroup,offline_hostgroup,active,max_writers,writer_is_also_reader,max_transactions_behind)
VALUES (10,20,30,40,1,1,0,100);
LOAD MYSQL SERVERS TO RUNTIME;
SAVE MYSQL SERVERS TO DISK;
INSERT OR REPLACE INTO mysql_users
(username,password,active,default_hostgroup,default_schema,transaction_persistent)
VALUES ('ventas_app','$($settings.MYSQL_PASSWORD)',1,10,'ventas_catalogo',1);
LOAD MYSQL USERS TO RUNTIME;
SAVE MYSQL USERS TO DISK;
"@
}

function Assert-Proxy($Primary) {
    $writer = "SELECT hostname FROM runtime_mysql_servers WHERE hostgroup_id=10 AND status='ONLINE' AND use_ssl=1;"
    Wait-Until "ProxySQL routing to $Primary" { (Invoke-Proxy $writer) -eq $Primary }
    $user = Invoke-Proxy "SELECT COUNT(*) FROM runtime_mysql_users WHERE username='ventas_app' AND active=1 AND default_hostgroup=10 AND default_schema='ventas_catalogo';"
    if ([int]$user -lt 1) { throw 'Missing ProxySQL application user.' }
    $hostgroups = Invoke-Proxy "SELECT COUNT(*) FROM runtime_mysql_group_replication_hostgroups WHERE writer_hostgroup=10 AND backup_writer_hostgroup=20 AND reader_hostgroup=30 AND offline_hostgroup=40 AND active=1 AND max_writers=1 AND writer_is_also_reader=0 AND max_transactions_behind=100;"
    if ($hostgroups -ne '1') { throw 'Unexpected ProxySQL hostgroup configuration.' }
    $monitor = Invoke-Proxy "SELECT COUNT(*) FROM runtime_global_variables WHERE (variable_name='mysql-monitor_enabled' AND variable_value='true') OR (variable_name='mysql-monitor_username' AND variable_value='proxysql_monitor');"
    if ($monitor -ne '2') { throw 'Unexpected ProxySQL monitor configuration.' }
    if ((Invoke-ProxyApp 'SELECT @@hostname,@@global.read_only;') -ne "$Primary`t0") {
        throw 'The application connection did not reach the writable primary.'
    }
    $rows = Invoke-Proxy "SELECT hostgroup_id,hostname,status,use_ssl FROM runtime_mysql_servers ORDER BY hostgroup_id,hostname;"
    Write-Host ("ProxySQL hostgroup / server / status / SSL`n" + ($rows -join "`n"))
}

function Test-Catalog($Primary) {
    $gtid = Invoke-MySql $Primary 'SELECT @@GLOBAL.gtid_executed;'
    $countSql = 'SELECT CONCAT_WS('','', ' + (($catalog | ForEach-Object { "(SELECT COUNT(*) FROM ventas_catalogo.$_)" }) -join ',') + ');'
    $checksumSql = 'CHECKSUM TABLE ' + (($catalog | ForEach-Object { "ventas_catalogo.$_" }) -join ',') + ' EXTENDED;'
    $baseline = $null
    foreach ($node in $nodes) {
        if ((Invoke-MySql $node "SELECT WAIT_FOR_EXECUTED_GTID_SET('$gtid',300);") -ne '0') {
            throw "$node did not apply the primary's GTID set within 300 seconds."
        }
        if ((Invoke-MySql $node 'SELECT @@GLOBAL.gtid_executed;') -ne $gtid) {
            throw "GTID mismatch on $node. Run verification with catalogue writes paused."
        }
        $caughtUp = Invoke-MySql $node "SELECT GTID_SUBSET(COALESCE(RECEIVED_TRANSACTION_SET,''),@@GLOBAL.gtid_executed) FROM performance_schema.replication_connection_status WHERE CHANNEL_NAME='group_replication_applier';"
        if ($caughtUp -ne '1') { throw "$node still has certified transactions to apply." }
        $counts = Invoke-MySql $node $countSql
        $checksums = @(Invoke-MySql $node $checksumSql)
        if ($checksums.Count -ne $catalog.Count -or ($checksums -match '\tNULL$')) {
            throw "Missing table checksum on $node."
        }
        $signature = (@($counts) + $checksums) -join '|'
        if ($null -eq $baseline) { $baseline = $signature } elseif ($signature -ne $baseline) { throw "Catalogue differs on $node." }
        Write-Host "$node GTID=$gtid rows=$counts"
        $checksums | Write-Host
    }
    if ((Invoke-MySql $Primary 'SELECT @@GLOBAL.gtid_executed;') -ne $gtid) {
        throw 'Catalogue changed during verification. Pause writes and retry.'
    }
    Invoke-MySql $Primary $countSql
}

function Invoke-Seed {
    $binding = Invoke-Compose @('port','proxysql','6033')
    if ($binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw "Unexpected ProxySQL binding: $binding" }
    $seedEnv = @{ MYSQL_HOST='127.0.0.1'; MYSQL_PORT=$Matches[1]; MYSQL_DATABASE='ventas_catalogo';
        MYSQL_USER='ventas_app'; MYSQL_PASSWORD=$settings.MYSQL_PASSWORD }
    $saved = @{}
    foreach ($name in $seedEnv.Keys) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $seedEnv[$name], 'Process')
    }
    try {
        $seedFile = Join-Path $PSScriptRoot '../../backend/src/seeds/seedMysql.js'
        & node $seedFile
        if ($LASTEXITCODE -ne 0) { throw 'MySQL seed failed.' }
    } finally {
        foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    }
}

foreach ($line in (Invoke-Compose @('config','--environment'))) {
    if ($line -match '^(MYSQL_GROUP_UUID|MYSQL_ROOT_PASSWORD|MYSQL_REPL_PASSWORD|MYSQL_PASSWORD|MYSQL_MONITOR_PASSWORD|PROXYSQL_ADMIN_PASSWORD)=(.*)$') {
        $settings[$Matches[1]] = $Matches[2]
    }
}
if ($Action -eq 'Initialize') {
    foreach ($name in @('MYSQL_ROOT_PASSWORD','MYSQL_REPL_PASSWORD','MYSQL_PASSWORD','MYSQL_MONITOR_PASSWORD','PROXYSQL_ADMIN_PASSWORD')) {
        if ($settings[$name] -cnotmatch '^[A-Za-z0-9_!@%+=.,-]{12,128}$') {
            throw "$name must contain 12 to 128 characters from A-Za-z0-9_!@%+=.,-."
        }
    }
}
foreach ($name in @('MYSQL_PASSWORD','PROXYSQL_ADMIN_PASSWORD')) {
    if (-not $settings[$name]) { throw "Set $name to the current password for this cluster." }
}
if ($settings.MYSQL_GROUP_UUID -notmatch '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$') {
    throw 'Set MYSQL_GROUP_UUID to the UUID configured for this cluster.'
}

$lock = [System.Threading.Mutex]::new($false, "Local\ProyectoIngDatos-$Context-$Project")
$ownsLock = $false
try {
    try { $ownsLock = $lock.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $ownsLock = $true }
    if (-not $ownsLock) { throw "Another cluster command is running for $Project." }

    foreach ($node in $nodes) {
        Wait-Until "MySQL on $node" { (Invoke-MySql $node 'SELECT 1;' 2>$null) -eq '1' } 900
    }
    $group = @(Get-Group)
    if (($group.Uuid | Select-Object -Unique).Count -ne 3) { throw 'The nodes must have different server UUIDs.' }
    $offline = @($group | Where-Object State -eq 'OFFLINE').Count
    $online = @($group | Where-Object State -eq 'ONLINE').Count

    if ($Action -eq 'Initialize' -and $offline -eq 3) {
        if (@($group | Where-Object { $_.Executed -ne '-' -or $_.Received -ne '-' }).Count) {
            throw 'Existing GTIDs detected. Use Recover for a stopped existing group.'
        }
        foreach ($node in $nodes) {
            $schemas = Invoke-MySql $node "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name NOT IN ('mysql','information_schema','performance_schema','sys');"
            if ($schemas -ne '0') { throw "Existing user schemas on $node. Bootstrap aborted." }
        }
        foreach ($node in $nodes) { Set-RecoveryChannel $node }
        Start-Group $nodes[0]
        Join-Group @(Get-Group)
    } elseif ($Action -eq 'Recover' -and $offline -eq 3) {
        $group | Format-Table Node,Executed,Received | Out-Host
        $founder = $null
        foreach ($candidate in $group) {
            $coversAll = $true
            foreach ($other in $group) {
                $required = (@($other.Executed,$other.Received) | Where-Object { $_ -ne '-' }) -join ','
                $available = (@($candidate.Executed,$candidate.Received) | Where-Object { $_ -ne '-' }) -join ','
                if ((Invoke-MySql $candidate.Node "SELECT GTID_SUBSET('$required','$available');") -ne '1') { $coversAll = $false; break }
            }
            if ($coversAll -and $candidate.Executed -ne '-') { $founder = $candidate.Node; break }
        }
        if (-not $founder) { throw 'No member with the complete existing GTID set. Bootstrap aborted.' }
        Start-Group $founder
        Join-Group @(Get-Group)
    } elseif ($Action -eq 'Recover' -and $online -eq 1 -and $offline -eq 2) {
        $running = ($group | Where-Object State -eq 'ONLINE').Node
        if (-not (Test-StandalonePrimary $running)) {
            throw 'The only ONLINE member does not see a writable singleton group. Recovery aborted.'
        }
        Join-Group $group
    } elseif ($Action -eq 'Recover' -and $online -ge 2) {
        Join-Group $group
    } elseif ($online -ne 3) {
        throw 'Expected a new group or three ONLINE nodes. Use Recover to diagnose/rejoin an existing group.'
    }

    $group = @(Get-HealthyGroup)
    $group | Format-Table Node,State,Role | Out-Host
    $primary = ($group | Where-Object Role -eq 'PRIMARY').Node
    if ($Action -eq 'Initialize') {
        Initialize-Catalog $primary
        Initialize-Proxy
    }
    Assert-Proxy $primary
    $counts = Test-Catalog $primary
    if ($Action -eq 'Seed') {
        if ($counts -eq '0,0,0,0,0') { Invoke-Seed; $counts = Test-Catalog $primary }
        if ($counts -ne $expected) { throw "Unexpected catalogue counts ($counts). No reset was performed." }
    }
    if ($Action -eq 'Verify' -and $counts -notin @($expected,'0,0,0,0,0')) {
        throw "Unexpected catalogue counts ($counts)."
    }
    Write-Host "Completed $Action. Primary: $primary. Catalogue counts: $counts."

} finally {
    if ($ownsLock) { $lock.ReleaseMutex() }
    $lock.Dispose()
}
