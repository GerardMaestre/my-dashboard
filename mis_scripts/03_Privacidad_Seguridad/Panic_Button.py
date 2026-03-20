# DESC: Destruye huellas: Cierra navegadores, borra Temp, DNS y vacía la papelera.
# ARGS: Ninguno

import os
import shutil
import getpass
import sqlite3
from pathlib import Path

def close_browsers():
    print("[*] Cerrando navegadores...")
    browsers = ['chrome.exe', 'msedge.exe', 'brave.exe']
    for b in browsers:
        os.system(f'taskkill /F /IM {b} /T >nul 2>&1')
    
    import time
    time.sleep(2) # Esperar a que se liberen los archivos lock de SQLite

def clear_browser_history():
    print("[*] Borrando historiales...")
    user = getpass.getuser()
    
    # Rutas típicas
    paths = {
        'Chrome': fr"C:\Users\{user}\AppData\Local\Google\Chrome\User Data\Default\History",
        'Edge': fr"C:\Users\{user}\AppData\Local\Microsoft\Edge\User Data\Default\History",
        'Brave': fr"C:\Users\{user}\AppData\Local\BraveSoftware\Brave-Browser\User Data\Default\History"
    }

    for name, path in paths.items():
        if os.path.exists(path):
            try:
                os.remove(path)
                print(f"[+] Historial de {name} eliminado.")
            except:
                print(f"[-] No se pudo borrar historial de {name} (puede estar en uso)")

def run():
    print("=== INICIANDO PROTOCOLO DE PÁNICO ===")
    close_browsers()
    clear_browser_history()
    
    print("[*] Vaciando DNS...")
    os.system('ipconfig /flushdns >nul')
    
    print("[*] Vaciando Papelera...")
    os.system('powershell.exe -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"')
    
    print("[*] Limpiando %TEMP%...")
    temp_path = os.getenv('TEMP')
    if temp_path:
        for item in os.listdir(temp_path):
            item_path = os.path.join(temp_path, item)
            try:
                if os.path.isfile(item_path):
                    os.remove(item_path)
                elif os.path.isdir(item_path):
                    shutil.rmtree(item_path)
            except:
                pass

    print("\n[V] RASTROS DESTRUIDOS. SISTEMA LIMPIO.")

if __name__ == "__main__":
    run()