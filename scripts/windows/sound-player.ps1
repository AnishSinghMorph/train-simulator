# Persistent, pre-loaded sound player for low latency. One instance runs per
# sound (horn, ambient) so they can play at the same time. Started once by
# src/lib/sound-player.js; commands arrive one per line on stdin:
#   play - play once from the start
#   loop - play on repeat until stopped
#   stop - stop
# WAV (PCM) only. Exits when stdin closes (i.e. when Node exits).
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'

$player = New-Object System.Media.SoundPlayer $File
$player.Load()
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  switch ($line) {
    'play' { $player.Stop(); $player.Play() }
    'loop' { $player.Stop(); $player.PlayLooping() }
    'stop' { $player.Stop() }
  }
}
$player.Stop()
