# Mo cong cho dev LAN: chay PowerShell "Run as administrator".
# Neu khong chay elevated, Windows se tu choi.

$ErrorActionPreference = "Stop"
$ports = @(4200, 3000)
foreach ($port in $ports) {
  $name = "AKOOL dev TCP $port"
  netsh advfirewall firewall delete rule name="$name" 2>$null
  netsh advfirewall firewall add rule name="$name" dir=in action=allow protocol=TCP localport=$port profile=any
  Write-Host "OK: $name"
}
Write-Host "Xong. Thu lai tren may khac: http://<IPv4-LAN-cua-may>:4200"
