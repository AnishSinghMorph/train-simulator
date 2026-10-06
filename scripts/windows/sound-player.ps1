# Persistent, pre-loaded sound player for low latency. One instance runs per
# sound (horn, ambient) so they can play at the same time. Started once by
# src/lib/sound-player.js; commands arrive one per line on stdin:
#   play - play once from the start
#   loop - play on repeat until stopped
#   stop - stop
#   volume <0..1> - set this player's own volume live (no restart)
#   from <seconds> - play once starting at that second (Mode 'seek' only:
#                    the train soundtrack, which follows the video's position)
# WAV (PCM) only. Exits when stdin closes (i.e. when Node exits).
param([Parameter(Mandatory = $true)][string]$File, [string]$Mode = '')
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

if ($Mode -eq 'seek') {
  # Keep the raw WAV in memory; 'from' plays a copy that starts at the asked second.
  $bytes = [IO.File]::ReadAllBytes($File)
  $p = 12; $dataOff = -1; $dataLen = 0
  while ($p -lt $bytes.Length - 8) {
    $id = [Text.Encoding]::ASCII.GetString($bytes, $p, 4)
    $len = [BitConverter]::ToInt32($bytes, $p + 4)
    if ($id -eq 'fmt ') {
      $ch = [BitConverter]::ToInt16($bytes, $p + 10); $rate = [BitConverter]::ToInt32($bytes, $p + 12)
      $byteRate = [BitConverter]::ToInt32($bytes, $p + 16); $align = [BitConverter]::ToInt16($bytes, $p + 20)
      $bits = [BitConverter]::ToInt16($bytes, $p + 22)
    }
    if ($id -eq 'data') { $dataOff = $p + 8; $dataLen = [Math]::Min($len, $bytes.Length - $dataOff); break }
    $p += 8 + $len + ($len % 2)
  }
  if ($dataOff -lt 0) { throw "no data chunk in $File" }
  $player = New-Object System.Media.SoundPlayer
  $stream = $null
} else {
  $player = New-Object System.Media.SoundPlayer $File
  $player.Load()
}

# Plays the soundtrack from $sec seconds in (Mode 'seek').
function Play-From([double]$sec) {
  $player.Stop()
  if ($null -ne $script:stream) { $script:stream.Dispose(); $script:stream = $null }
  $start = [int64]([Math]::Max(0.0, $sec) * $byteRate)
  $start -= $start % $align
  if ($start -ge $dataLen) { return }
  $n = [int]($dataLen - $start)
  $ms = New-Object IO.MemoryStream (44 + $n)
  $w = New-Object IO.BinaryWriter $ms
  $w.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $w.Write([int](36 + $n))
  $w.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt ')); $w.Write([int]16); $w.Write([int16]1)
  $w.Write([int16]$ch); $w.Write([int]$rate); $w.Write([int]$byteRate); $w.Write([int16]$align); $w.Write([int16]$bits)
  $w.Write([Text.Encoding]::ASCII.GetBytes('data')); $w.Write([int]$n)
  $w.Write($bytes, [int]($dataOff + $start), $n)
  $w.Flush()
  $ms.Position = 0
  $script:stream = $ms
  $player.Stream = $ms
  $player.Load()
  [void](Set-Vol); $player.Play(); Start-Sleep -Milliseconds 120; [void](Set-Vol)
}
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
  if ($line.StartsWith('from ')) {
    Play-From ([double]::Parse($line.Substring(5), [Globalization.CultureInfo]::InvariantCulture))
    continue
  }
  switch ($line) {
    'play' { $player.Stop(); [void](Set-Vol); $player.Play(); Start-Sleep -Milliseconds 120; [void](Set-Vol) }
    'loop' { $player.Stop(); [void](Set-Vol); $player.PlayLooping(); Start-Sleep -Milliseconds 120; [void](Set-Vol) }
    'stop' { $player.Stop() }
  }
}
$player.Stop()
