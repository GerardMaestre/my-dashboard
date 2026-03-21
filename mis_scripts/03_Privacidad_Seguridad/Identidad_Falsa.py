# DESC: Genera identidad falsa y correo desechable, se copia al portapapeles.
# ARGS: Ninguno

import urllib.request
import json
import string
import secrets
import subprocess
import time
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

def gen_password(length=14):
    chars = string.ascii_letters + string.digits + "!@#$%"
    return ''.join(secrets.choice(chars) for _ in range(length))

def run():
    print("[*] Solicitando datos fantasmas...")
    
    try:
        # Retry mechanism for 1secmail, which can be flaky
        email = None
        for attempt in range(3):
            try:
                req = urllib.request.Request("https://www.1secmail.com/api/v1/?action=genRandomMailbox&count=1", 
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
                with urllib.request.urlopen(req, timeout=10) as response:
                    email = json.loads(response.read().decode())[0]
                break
            except Exception:
                time.sleep(1)
        
        if not email:
            print("[!] Falló la conexión con 1secmail, usando correo local...")
            email = f"user_{random.randint(1000,9999)}@example.com"
            
        # Persona random
        req = urllib.request.Request("https://randomuser.me/api/?nat=es,us", headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as response:
            profile = json.loads(response.read().decode())['results'][0]
            
        nombre = f"{profile['name']['first']} {profile['name']['last']}"
        direccion = f"{profile['location']['street']['number']} {profile['location']['street']['name']}, {profile['location']['city']}"
        usuario = profile['login']['username']
        password = gen_password()
        
        info = f"""=== IDENTIDAD FANTASMA ===
Nombre: {nombre}
Edad: {profile['dob']['age']}
Dirección: {direccion}
Usuario: {usuario}
Password/Pass: {password}
Email: {email}
Bandeja: https://www.1secmail.com/
=========================="""

        print(info)
        subprocess.run("clip", text=True, input=info, shell=True)
        print("\n[V] Identidad copiada al portapapeles exitosamente.")
        
    except Exception as e:
        print(f"[X] Error generando identidad: {e}")

if __name__ == "__main__":
    run()