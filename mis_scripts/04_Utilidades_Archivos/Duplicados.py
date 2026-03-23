# DESC: Escanea tu carpeta de Descargas buscando clones exactos (verificando Hashes MD5) y los aísla.
# ARGS: <Ruta_Carpeta> <Ruta_Cuarentena>

import os
import hashlib
import shutil
import sys
from pathlib import Path

if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Configuración
argumentos = [arg for arg in sys.argv[1:] if not arg.startswith("--")]

if len(argumentos) >= 1:
    # Al unir los argumentos, soportamos rutas con espacios sin necesidad de comillas.
    RUTA_ESCANEO = " ".join(argumentos).strip('"').strip("'")
    if not os.path.exists(RUTA_ESCANEO):
        print(f"[X] ERROR: La ruta especificada no existe: {RUTA_ESCANEO}")
        sys.exit(1)
        
    # Bloqueo de seguridad: Evitar escanear carpetas del sistema
    ruta_abs = os.path.abspath(RUTA_ESCANEO).lower()
    rutas_prohibidas = [
        "c:\\windows", 
        "c:\\program files", 
        "c:\\program files (x86)", 
        "c:\\programdata"
    ]
    if ruta_abs == "c:\\" or any(ruta_abs.startswith(p) for p in rutas_prohibidas):
        print(f"\n[!] AVISO DE SEGURIDAD (HORUS ENGINE) [!]")
        print(f"[X] Está TERMINANTEMENTE PROHIBIDO escanear carpetas del sistema: {RUTA_ESCANEO}")
        print("[X] Windows utiliza miles de archivos duplicados (Librerías DLL) a propósito.")
        print("[X] Si el cazador de duplicados los aísla, romperás Windows o tus aplicaciones.")
        print("[X] Usa esta herramienta SÓLO en carpetas personales (Documentos, Fotos, Descargas, Discos Externos).\n")
        sys.exit(1)
else:
    RUTA_ESCANEO = os.path.join(Path.home(), "Downloads")

RUTA_PAPELERA = os.path.join(RUTA_ESCANEO, "DUPLICADOS_A_BORRAR")

def hash_archivo(ruta):
    """Crea una huella digital única (hash) del archivo para compararlo."""
    hasher = hashlib.md5()
    try:
        with open(ruta, 'rb') as f:
            buf = f.read(65536)
            while len(buf) > 0:
                hasher.update(buf)
                buf = f.read(65536)
        return hasher.hexdigest()
    except Exception:
        return None

print("="*65)
print("      ⚡ HORUS AUTOPILOT - CAZADOR DE DUPLICADOS ⚡      ")
print("="*65)
print(f"[*] Escaneando en profundidad: {RUTA_ESCANEO}\n")

if not os.path.exists(RUTA_PAPELERA):
    os.makedirs(RUTA_PAPELERA)

# 1. Agrupar archivos por tamaño (Filtro ultrarrápido)
print("[~] Fase 1: Analizando estructura y tamaños...")
archivos_por_tamano = {}

for raiz, _, archivos in os.walk(RUTA_ESCANEO):
    if RUTA_PAPELERA in raiz: 
        continue
        
    for archivo in archivos:
        ruta = os.path.join(raiz, archivo)
        try:
            peso = os.path.getsize(ruta)
            if peso in archivos_por_tamano:
                archivos_por_tamano[peso].append(ruta)
            else:
                archivos_por_tamano[peso] = [ruta]
        except Exception:
            pass

# Quedarnos solo con agrupaciones de tamaño que tengan 2 o más archivos
posibles_duplicados = {peso: rutas for peso, rutas in archivos_por_tamano.items() if len(rutas) > 1}

# 2. Hashing profundo solo para los que pesan exactamente lo mismo
print("[~] Fase 2: Ejecutando criptografía en candidatos seleccionados...")
hashes_verificados = {}
duplicados = 0

for rutas in posibles_duplicados.values():
    for ruta in rutas:
        file_hash = hash_archivo(ruta)
        
        if file_hash:
            if file_hash in hashes_verificados:
                duplicados += 1
                archivo_nombre = os.path.basename(ruta)
                nueva_ruta = os.path.join(RUTA_PAPELERA, archivo_nombre)
                
                # Prevenir sobreescrituras en cuarentena
                contador = 1
                base, ext = os.path.splitext(archivo_nombre)
                while os.path.exists(nueva_ruta):
                    nueva_ruta = os.path.join(RUTA_PAPELERA, f"{base} ({contador}){ext}")
                    contador += 1

                visual = archivo_nombre[:40] + '...' if len(archivo_nombre) > 40 else archivo_nombre
                try:
                    shutil.move(ruta, nueva_ruta)
                    print(f" [!] CLON AISLADO: {visual}")
                except Exception as e:
                    print(f" [X] ERROR aislando {visual}: {e}")
            else:
                hashes_verificados[file_hash] = ruta

print("\n" + "-" * 65)
if duplicados > 0:
    print(f"[OK] Se aislaron {duplicados} archivos duplicados en la carpeta 'DUPLICADOS_A_BORRAR'.")
    print("[I] Revisa la carpeta y elimínala manualmente cuando estés seguro.")
else:
    print("[OK] Sistema limpio. No se encontraron clones exactos.")
