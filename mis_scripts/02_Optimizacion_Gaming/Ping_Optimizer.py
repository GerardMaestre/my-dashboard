# DESC: Mide la latencia contra los mejores DNS del mundo y te muestra cuál es el servidor más rápido para tu conexión.
# ARGS: Ninguno (Solicitará permisos de Administrador)

import subprocess
import ctypes
import sys
import re

if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

import atexit, tempfile, time
def _horus_cleanup():
    if "HORUS_LOG_FILE" in os.environ:
        try: open(os.environ["HORUS_LOG_FILE"] + ".done", "w").close()
        except: pass
atexit.register(_horus_cleanup)

if "--horus-log" in sys.argv:
    idx = sys.argv.index("--horus-log")
    log_file = sys.argv[idx + 1]
    sys.stdout = open(log_file, "w", encoding="utf-8")
    sys.stderr = sys.stdout
    del sys.argv[idx:idx+2]
    os.environ["HORUS_LOG_FILE"] = log_file
elif not ctypes.windll.shell32.IsUserAnAdmin():
    print("[!] Solicitando permisos de Administrador para cambiar DNS (Acepta el escudo amarillo)...", flush=True)
    log_file = os.path.join(tempfile.gettempdir(), f"horus_admin_{os.getpid()}.log")
    open(log_file, "w").close()
    params = f'"{os.path.abspath(__file__)}" ' + " ".join(f'"{a}"' for a in sys.argv[1:]) + f' --horus-log "{log_file}"'
    if ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, params, None, 0) <= 32:
        print("[X] Elevación UAC rechazada.", flush=True); sys.exit(1)
    
    print("[*] Privilegios obtenidos. Ejecutando en segundo plano...", flush=True)
    done_file = log_file + ".done"
    with open(log_file, "r", encoding="utf-8", errors="replace") as f:
        while True:
            line = f.readline()
            if not line:
                if os.path.exists(done_file):
                    res = f.read()
                    if res: print(res, end="", flush=True)
                    break
                time.sleep(0.1)
                continue
            print(line, end="", flush=True)
    try: os.remove(log_file); os.remove(done_file)
    except: pass
    sys.exit(0)

SERVIDORES_DNS = {
    "Google (Recomendado)": "8.8.8.8",
    "Cloudflare (Rápido/Privado)": "1.1.1.1",
    "Quad9 (Seguridad)": "9.9.9.9",
    "OpenDNS (Estable)": "208.67.222.222"
}

print("="*65)
print("        ⚡ HORUS ENGINE - PING OPTIMIZER ⚡        ")
print("="*65)
print("[*] Lanzando micro-paquetes ICMP a los servidores globales...\n")

resultados = {}

for nombre, ip in SERVIDORES_DNS.items():
    try:
        salida = subprocess.check_output(f"ping -n 3 -w 1000 {ip}", shell=True).decode('utf-8', errors='replace')
        match = re.search(r"Media = (\d+) ms|Average = (\d+)ms", salida)
        if match:
            ms = int(match.group(1) or match.group(2))
            resultados[nombre] = {"ip": ip, "ms": ms}
            print(f" [>] {nombre:<25} : {ms} ms")
        else:
            print(f" [X] {nombre:<25} : Tiempo de espera agotado")
    except subprocess.CalledProcessError:
        print(f" [X] {nombre:<25} : Fallo de conexión")

if not resultados:
    print("\n[!] Error: No hay conexión a internet.")
    sys.exit()

# Encontrar el más rápido
mejor_dns = min(resultados.items(), key=lambda x: x[1]['ms'])
mejor_nombre = mejor_dns[0]
mejor_ip = mejor_dns[1]['ip']
mejor_ms = mejor_dns[1]['ms']

print("\n" + "-"*65)
print(f"[*] GANADOR: {mejor_nombre} con {mejor_ms} ms")
print(f"[*] Aplicando la mejor configuración DNS al adaptador de red principal...")

try:
    ps_cmd = f"""
    $adapter = Get-NetAdapter | Where-Object Status -eq 'Up' | Where-Object MediaType -Match '802.3|802.11' | Select-Object -First 1
    if ($adapter) {{
        Write-Host " [>] Configurando servidor DNS en $($adapter.Name)..." -NoNewline
        Set-DnsClientServerAddress -InterfaceAlias $adapter.Name -ServerAddresses ("{mejor_ip}")
        Write-Host " [OK]"
        ipconfig /flushdns | Out-Null
    }} else {{
        Write-Host " [X] No se encontró adaptador activo."
    }}
    """
    resultado = subprocess.check_output(["powershell", "-Command", ps_cmd]).decode('utf-8', errors='replace')
    print(resultado.strip())
except Exception as e:
    print(f"[X] Fallo al establecer el DNS automáticamente: {e}")

print("-" * 65)
