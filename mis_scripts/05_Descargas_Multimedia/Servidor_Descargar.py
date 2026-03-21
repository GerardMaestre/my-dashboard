# DESC: Levanta un servidor web temporal en tu PC y genera un código QR para compartir archivos por Wi-Fi.
# ARGS: <Ruta_Carpeta>

import os
import sys
import socket
import threading
import http.server
import socketserver
import functools
import time

# Forzar codificación y evitar buffer
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

try:
    import qrcode
except ImportError:
    print("[*] Instalando motor de Códigos QR...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "qrcode[pil]", "colorama", "--quiet"])
    import qrcode

print("="*65)
print("      ⚡ HORUS ENGINE - SERVIDOR EFÍMERO CON QR ⚡      ")
print("="*65)

if len(sys.argv) < 2:
    print("[ERROR] Faltan parámetros.")
    print("En 'Flags / Args' debes poner la ruta de la carpeta que quieres compartir.")
    print("Ejemplo: \"C:\\Users\\gerar\\Desktop\\Peliculas\"")
    sys.exit()

carpeta_objetivo = " ".join(sys.argv[1:]).strip('"')

if not os.path.exists(carpeta_objetivo):
    print(f"[X] No se encontró la carpeta: {carpeta_objetivo}")
    sys.exit()

PUERTO = 8080

def obtener_ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No importa si la IP de destino es inalcanzable, esto saca la IP de tu tarjeta de red local
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

ip_local = obtener_ip_local()
url_descarga = f"http://{ip_local}:{PUERTO}"

print(f"[*] Preparando túnel de transferencia en: {carpeta_objetivo}")
print(f"[*] Generando Código QR para acceso rápido...\n")

# Generar QR en formato ASCII para la consola
qr = qrcode.QRCode(version=1, box_size=1, border=2)
qr.add_data(url_descarga)
qr.make(fit=True)
qr.print_ascii(invert=True)

print("\n" + "-"*65)
print(f"[OK] SERVIDOR ACTIVO EN: {url_descarga}")
print("[I] Pide a tus amigos que escaneen el QR con su móvil estando en tu Wi-Fi.")
print("[I] Para apagar el servidor, simplemente pulsa el botón 'Parar' en el HORUS.")
print("-" * 65)

# Iniciar el servidor web de forma silenciosa
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=carpeta_objetivo)
try:
    with socketserver.TCPServer(("", PUERTO), Handler) as httpd:
        httpd.serve_forever()
except OSError:
    print(f"[X] El puerto {PUERTO} ya está en uso. Cierra servidores previos.")
except KeyboardInterrupt:
    pass
