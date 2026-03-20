# DESC: Inyecta +100k dominios bloqueados en el núcleo (hosts) para eliminar anuncios globales.
# ARGS: Ninguno (Pide permisos de Administrador automáticamente)

import urllib.request
import os
import shutil
import ctypes
import sys

if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

if not ctypes.windll.shell32.IsUserAnAdmin():
    print("[!] Solicitando privilegios de Administrador...")
    ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, " ".join(sys.argv), None, 1)
    sys.exit()

HOSTS_PATH = r"C:\Windows\System32\drivers\etc\hosts"
BACKUP_PATH = r"C:\Windows\System32\drivers\etc\hosts.nexus.bak"
BLOCKLIST_URL = "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"

print("="*65)
print("        ⚡ NEXUS SYSTEM - ESCUDO ADBLOCK GLOBAL ⚡       ")
print("="*65)

try:
    if not os.path.exists(BACKUP_PATH):
        try:
            shutil.copyfile(HOSTS_PATH, BACKUP_PATH)
            print(f"[*] Backup del archivo hosts original creado con éxito.")
        except IOError as e:
            print(f"[X] Error al crear backup: {e}")
            sys.exit(1)
    else:
        print(f"[*] El backup del sistema ya existe. Procediendo...")

    # Restauración si se pasa argumento
    if len(sys.argv) > 1 and sys.argv[1] == '--restore':
        print("[*] Restaurando el archivo hosts original...")
        if os.path.exists(BACKUP_PATH):
            shutil.copyfile(BACKUP_PATH, HOSTS_PATH)
            os.system("ipconfig /flushdns >nul 2>&1")
            print("[OK] Hosts restaurado a su estado de fábrica.")
        else:
            print("[X] No se encontró un backup para restaurar.")
        sys.exit(0)

    print(f"[*] Conectando con servidores de bloqueo (Descargando ~100k dominios)...")
    try:
        req = urllib.request.Request(BLOCKLIST_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as response:
            datos_bloqueo = response.read().decode('utf-8')
    except Exception as e:
        print(f"[X] Fallo la descarga de la lista negra: {e}")
        sys.exit(1)

    print("[*] Inyectando reglas de bloqueo en el firewall DNS de Windows...")
    with open(HOSTS_PATH, 'w', encoding='utf-8') as f:
        f.write("# =======================================================\n")
        f.write("# NEXUS AUTOPILOT - ADBLOCK & ANTI-TELEMETRY SHIELD\n")
        f.write("# =======================================================\n")
        f.write("127.0.0.1 localhost\n::1 localhost\n\n")
        f.write(datos_bloqueo)

    # CORRECCIÓN: Optimizar el Cliente DNS para evitar desbordamiento de RAM
    print("[*] Optimizando servicio DNS para soportar listas masivas...")
    os.system('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Dnscache\\Parameters" /v MaxCacheTtl /t REG_DWORD /d 1 /f >nul 2>&1')
    os.system('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Dnscache\\Parameters" /v MaxNegativeCacheTtl /t REG_DWORD /d 0 /f >nul 2>&1')
    
    os.system("ipconfig /flushdns >nul 2>&1")

    print("\n" + "=" * 65)
    print("[OK] ESCUDO ACTIVADO. Tu PC ahora es inmune a la publicidad a nivel de red.")
    print("=================================================================")

except Exception as e:
    print(f"\n[X] Error crítico: {e}")
    print("[!] Asegúrate de estar ejecutando Nexus Executor como Administrador.")