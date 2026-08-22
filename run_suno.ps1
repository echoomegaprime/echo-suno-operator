$ErrorActionPreference='Stop'
$dir='C:\Users\bobmc\echo-suno-operator'
Get-Content (Join-Path $dir '.env') | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process') }
}
Set-Location $dir
& node src\server.js *>> "$dir\.data_server.log"
