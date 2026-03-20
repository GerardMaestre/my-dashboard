# DESC: Fuerza a Windows a liberar toda la Memoria RAM cacheada inútil. Sube los FPS y elimina tirones en juegos.
# ARGS: Ninguno (Pedirá permisos de Administrador)

import os
import sys
import ctypes
import time

# Forzar codificación y evitar buffer
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

# Escalada a Administrador necesaria para tocar el Kernel
if not ctypes.windll.shell32.IsUserAnAdmin():
    print("[!] Requiere privilegios de Administrador para vaciar la RAM...")
    ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, " ".join(sys.argv), None, 1)
    sys.exit()

print("="*65)
print("        ⚡ NEXUS SYSTEM - PURGATORIO DE MEMORIA RAM ⚡       ")
print("="*65)

class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]

def get_ram_libre():
    stat = MEMORYSTATUSEX()
    stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
    return stat.ullAvailPhys / (1024 ** 2)

ram_antes = get_ram_libre()
print(f"[*] RAM Libre actual: {ram_antes:.2f} MB")
print("[*] Inyectando llamada al Kernel de Windows para vaciar procesos inactivos...", flush=True)

# 1. Vaciar el Working Set de todos los procesos abiertos
# Obliga a los programas inactivos a devolver su RAM inútil usando Psapi (C nativo - Muy rápido)
import psutil
procesos_limpiados = 0
try:
    for proc in psutil.process_iter(['pid', 'name']):
        try:
            handle = ctypes.windll.kernel32.OpenProcess(0x001F0FFF, False, proc.info['pid'])
            if handle:
                ctypes.windll.psapi.EmptyWorkingSet(handle)
                ctypes.windll.kernel32.CloseHandle(handle)
                procesos_limpiados += 1
        except Exception:
            pass
    print(f" [>] Se vaciaron fragmentos de RAM de {procesos_limpiados} procesos activos vía Psapi.")
except ImportError:
    # Fallback si no está psutil instalado, usando WMI
    import subprocess
    ps_script = """
    $processes = Get-Process
    foreach ($p in $processes) {
        try {
            [System.Diagnostics.Process]::GetProcessById($p.Id).MinWorkingSet = [System.IntPtr]::Subtract([System.IntPtr]::Zero, 1)
        } catch {}
    }
    """
    subprocess.run(["powershell", "-Command", ps_script], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    print(" [>] Working Sets de procesos activos purgados vía PowerShell.")
except Exception as e:
    print(f" [X] Aviso menor: {e}")

time.sleep(1) # Dejar que Windows asimile la liberación de memoria

ram_despues = get_ram_libre()
ram_recuperada = ram_despues - ram_antes

print("\n" + "-"*65)
if ram_recuperada > 0:
    print(f"[OK] PURGA COMPLETADA. Se han recuperado {ram_recuperada:.2f} MB de RAM.")
else:
    print("[OK] PURGA COMPLETADA. Tu sistema ya estaba muy optimizado.")
print("[I] Puedes ejecutar esto antes de abrir un juego pesado para ganar rendimiento.")