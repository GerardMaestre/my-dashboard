# DESC: Escucha tu teclado a nivel hardware y expande atajos de texto cortos (ej. //correo) a frases completas (tu_correo@gmail.com) instantáneamente en CUALQUIER programa o juego.
# ARGS: Ninguno

import os
import sys
import json
import subprocess
import threading
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

# 1. Dependencias Automáticas
try:
    import keyboard
except ImportError:
    print("[*] Instalando motor de intercepción del núcleo del teclado (Librería 'keyboard')...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "keyboard", "--quiet"])
    import keyboard

print("="*65)
print("      ⚡ HORUS ENGINE - INYECTOR DE MACROS E INCOGNITO ⚡    ")
print("="*65)

# 2. Archivo de Configuración de Macros
APPDATA = os.environ.get("APPDATA", os.path.expanduser("~"))
HORUS_DIR = os.path.join(APPDATA, "HorusEngine")
if not os.path.exists(HORUS_DIR):
    try: os.makedirs(HORUS_DIR)
    except: pass
CONFIG_FILE = os.path.join(HORUS_DIR, "macros_config.json")

# Macros por defecto si es la primera vez
default_macros = {
    "/correo": "test@gmail.com",
    "/HORUS": "⚡ HORUS ENGINE ACTIVADO ⚡",
    "/atencion": "Hola, gracias por contactar. En un momento te atiendo.",
    "/gg": "Good Game Well Played! :)"
}

if not os.path.exists(CONFIG_FILE):
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(default_macros, f, indent=4, ensure_ascii=False)
    macros = default_macros
else:
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        try:
            macros = json.load(f)
            # Migración automática si el usuario venía de la versión con "//"
            migrated = False
            new_macros = {}
            for k, v in macros.items():
                if k.startswith('//'):
                    new_macros['/' + k[2:]] = v
                    migrated = True
                else:
                    new_macros[k] = v
            macros = new_macros
            if migrated:
                with open(CONFIG_FILE, 'w', encoding='utf-8') as fw:
                    json.dump(macros, fw, indent=4, ensure_ascii=False)
        except:
            macros = default_macros

# 3. Interfaz de Configuración Inicial (Omitida para fondo silencioso)
print(f"[*] Base de datos de macros lista: {len(macros)} atajos cargados.")
print(f"[!] Nota: Si deseas editar tus macros, edita el archivo '{os.path.basename(CONFIG_FILE)}' en esta misma carpeta y reinicia el script.")

# 4. Inyección en el Kernel de Windows
print("[*] Extrayendo los atajos de configuración:")
for trigger, replacement in macros.items():
    print(f"    [Teclado]: Escribir '{trigger}' -> Inyección instantánea")

import time
_buffer = ""

def on_key(event):
    global _buffer
    if len(event.name) == 1:
        _buffer += event.name
    elif event.name == "space":
        _buffer += " "
    elif event.name == "backspace":
        _buffer = _buffer[:-1]
    
    # Mantener el buffer pequeño por eficiencia
    if len(_buffer) > 50:
        _buffer = _buffer[-50:]
        
    for trigger, replacement in macros.items():
        if _buffer.endswith(trigger):
            # Encontrado! Borramos el trigger e inyectamos
            for _ in range(len(trigger)):
                keyboard.send("backspace")
            
            # Pequeña pausa para que el OS procese los backspaces
            time.sleep(0.02)
            keyboard.write(replacement)
            _buffer = "" # Reseteamos buffer
            break

# Hook supersónico global, sin requerir teclas de espacio
keyboard.on_press(on_key)

print("\n" + "="*65)
print("[✅] INYECTOR DE MACROS ONLINE Y OCULTO EN SEGUNDO PLANO.")
print("="*65)
print("\n[!] IMPORTANTE: Esta ventana se quedará en blanco escuchando tus teclas.")
print("[!] Minimízala o escóndela.")
print("    Si quieres apagar las macros, simplemente cierra el HORUS o detén este script.")
print("\n[Modo Silencioso Activado...]")

# Watchdog para cerrar automáticamente si se pierde conexión con el HORUS (EOF pipe)
def _watchdog():
    try:
        sys.stdin.read()
    except Exception:
        pass
    os._exit(0)

threading.Thread(target=_watchdog, daemon=True).start()

try:
    # Bloquea el hilo eternamente esperando que presiones la tecla final o cierres
    keyboard.wait()
except KeyboardInterrupt:
    print("\n[*] Apagando inyector...")
    os._exit(0)

