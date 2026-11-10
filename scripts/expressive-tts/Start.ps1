param([int]$Port = 5003)
$ErrorActionPreference = 'Stop'
$config = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'voice.json') | ConvertFrom-Json
$python = $config.python
if (-not [IO.Path]::IsPathRooted($python)) { $python = Join-Path $PSScriptRoot $python }
$env:HF_HUB_OFFLINE = '1'
$env:NUMBA_CACHE_DIR = Join-Path $PSScriptRoot 'cache'
& $python -u (Join-Path $PSScriptRoot 'server.py') --port $Port
if ($LASTEXITCODE -ne 0) { throw "Expressive voice server exited with code $LASTEXITCODE" }
