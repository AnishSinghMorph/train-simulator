# Persistent, pre-loaded sound player for low latency. One instance runs per
# sound (horn, ambient) so they can play at the same time. Started once by
# src/lib/sound-player.js; commands arrive one per line on stdin:
#   play - play once from the start
#   loop - play on repeat until stopped
#   stop - stop
#   volume <0..1> - set this player's own volume live (no restart)
# WAV (PCM) only. Exits when stdin closes (i.e. when Node exits).
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'

# waveOutSetVolume sets this process's own audio session volume (Vista+),
# so it changes only this sound, live, without touching Windows master volume.
Add-Type -Namespace Win -Name Audio -MemberDefinition '[DllImport("winmm.dll")] public static extern int waveOutSetVolume(System.IntPtr hwo, uint dwVolume);'

# Last volume asked for. Re-applied every time playback starts, because Windows
# can hand a freshly (re)started sound the default level again.
$script:vol = 1.0
function Set-Vol {
  $lvl = [uint32][Math]::Round($script:vol * 65535)
  return [Win.Audio]::waveOutSetVolume([IntPtr]::Zero, [uint32](($lvl * 65536) + $lvl))
}

$player = New-Object System.Media.SoundPlayer $File
$player.Load()
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.StartsWith('volume ')) {
    $script:vol = [Math]::Max(0.0, [Math]::Min(1.0, [double]($line.Substring(7))))
    $rc = Set-Vol
    if ($rc -ne 0) { [Console]::Out.WriteLine("VOLUME_FAIL $rc"); [Console]::Out.Flush() }
    continue
  }
  switch ($line) {
    'play' { $player.Stop(); [void](Set-Vol); $player.Play(); Start-Sleep -Milliseconds 120; [void](Set-Vol) }
    'loop' { $player.Stop(); [void](Set-Vol); $player.PlayLooping(); Start-Sleep -Milliseconds 120; [void](Set-Vol) }
    'stop' { $player.Stop() }
  }
}
$player.Stop()
