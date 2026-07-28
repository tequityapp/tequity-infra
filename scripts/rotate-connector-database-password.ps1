[CmdletBinding(SupportsShouldProcess)]
param(
  [string] $VaultMount = 'secret',
  [string] $SecretPath = 'tequity/connector-database'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $PSCmdlet.ShouldProcess(
    "$VaultMount/$SecretPath",
    'Generate a new connector database password and write a new Vault KV version'
  )) {
  return
}

$vault = Get-Command vault -ErrorAction Stop
$randomBytes = [byte[]]::new(32)
$password = $null
try {
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
  $password = [Convert]::ToHexString($randomBytes).ToLowerInvariant()

  # Vault consumes the secret value from stdin. It never appears in argv, a
  # temporary file, Pulumi config/state, or this script's output.
  $password | & $vault.Source kv put "-mount=$VaultMount" $SecretPath password=-
  if ($LASTEXITCODE -ne 0) {
    throw "Vault rejected the connector credential rotation (exit $LASTEXITCODE)."
  }

  Write-Host "Stored a new connector database credential version at $VaultMount/$SecretPath."
} finally {
  [Array]::Clear($randomBytes, 0, $randomBytes.Length)
  $password = $null
}
