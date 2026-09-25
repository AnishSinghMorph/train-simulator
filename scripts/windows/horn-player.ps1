# Persistent, pre-loaded horn player for low latency. Started once by
# src/lib/horn-player.js; each "play" line on stdin plays the horn
# immediately from memory (no process spawn per press). WAV (PCM) only.
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'

$player = New-Object System.Media.SoundPlayer $File
$player.Load()
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq 'play') {
    $player.Stop()
    $player.Play()
  }
}
