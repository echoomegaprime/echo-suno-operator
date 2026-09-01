$ErrorActionPreference='Stop'
$dir=$PSScriptRoot
Get-Content (Join-Path $dir '.env') | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process') }
}
$node=(Get-Command node -ErrorAction Stop).Source
$stdout=Join-Path $dir '.data_server.log'
$stderr=Join-Path $dir '.data_server.error.log'
$process=Start-Process -FilePath $node -ArgumentList @('src\server.js') -WorkingDirectory $dir -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -Wait
exit $process.ExitCode
