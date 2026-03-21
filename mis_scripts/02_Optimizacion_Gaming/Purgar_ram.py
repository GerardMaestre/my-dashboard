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
# Usa kernel32 directamente para enumerar PIDs sin necesitar psutil
procesos_limpiados = 0
try:
    # Enumerar todos los PIDs del sistema usando EnumProcesses
    ArrayType = ctypes.c_ulong * 4096
    pids = ArrayType()
    bytes_returned = ctypes.c_ulong()
    ctypes.windll.psapi.EnumProcesses(ctypes.byref(pids), ctypes.sizeof(pids), ctypes.byref(bytes_returned))
    num_pids = bytes_returned.value // ctypes.sizeof(ctypes.c_ulong)
    
    PROCESS_ALL_ACCESS = 0x001F0FFF
    for i in range(num_pids):
        pid = pids[i]
        if pid == 0:
            continue
        try:
            handle = ctypes.windll.kernel32.OpenProcess(PROCESS_ALL_ACCESS, False, pid)
            if handle:
                ctypes.windll.psapi.EmptyWorkingSet(handle)
                ctypes.windll.kernel32.CloseHandle(handle)
                procesos_limpiados += 1
        except Exception:
            pass
    print(f" [>] Se vaciaron fragmentos de RAM de {procesos_limpiados} procesos activos vía Kernel32.")
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