# DESC: Falsifica la dirección MAC de tu adaptador de red para evitar baneos o límites de tiempo en redes Wi-Fi públicas.
# ARGS: Ninguno (Solicitará permisos de Administrador automáticamente)

import subprocess
import random
import ctypes
import sys
import re

if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

if not ctypes.windll.shell32.IsUserAnAdmin():
    print("[!] Escalando a Administrador para falsificar MAC...")
    ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, " ".join(sys.argv), None, 1)
    sys.exit()

print("="*65)
print("        ⚡ NEXUS SYSTEM - PROTOCOLO FANTASMA ⚡       ")
print("="*65)

def generar_mac_valida():
    # El segundo caracter de una MAC falsificada en Windows DEBE ser 2, 6, A, o E
    caracteres_validos = "26AE"
    hex_chars = "0123456789ABCDEF"
    mac = [random.choice(hex_chars) + random.choice(caracteres_validos)]
    for _ in range(5):
        mac.append(random.choice(hex_chars) + random.choice(hex_chars))
    return "-".join(mac)

nueva_mac = generar_mac_valida()
print(f"[*] Identidad de red falsa generada: {nueva_mac}")
print(f"[*] Buscando adaptador de red activo...")

try:
    # Usar PowerShell para cambiar la MAC de la forma más estable
    ps_cmd = f"""
    $adapter = Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -First 1
    if ($adapter) {{
        Write-Host " [>] Engañando al adaptador: $($adapter.Name)"
        Set-NetAdapterAdvancedProperty -Name $adapter.Name -RegistryKeyword "NetworkAddress" -RegistryValue "{nueva_mac.replace('-', '')}"
        Write-Host " [*] Reiniciando adaptador para aplicar el camuflaje..."
        Restart-NetAdapter -Name $adapter.Name
        Write-Host " [OK] Exito"
    }} else {{
        Write-Host " [X] Fallo"
    }}
    """
    resultado = subprocess.check_output(["powershell", "-Command", ps_cmd]).decode('utf-8', errors='replace')
    print(resultado)
except Exception as e:
    print(f"[X] Fallo crítico: {e}")