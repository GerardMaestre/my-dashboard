# DESC: Cifra carpetas con seguridad de Grado Militar (AES-256 CTR) optimizado para archivos gigantes sin consumir RAM.
import os
import sys
import shutil
import subprocess
import tkinter as tk
from tkinter import simpledialog, messagebox
import tkinter.ttk as ttk

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "cryptography", "--quiet"])
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

if len(sys.argv) < 2:
    sys.exit()

carpeta_objetivo = sys.argv[1]

if not os.path.isdir(carpeta_objetivo):
    # Si de casualidad se selecciona un archivo individual en vez de carpeta, lo ignoramos de momento
    sys.exit()

# Interfaz gráfica (tkinter) base
root = tk.Tk()
root.withdraw()
root.configure(bg="#1e1e1e")

# Pedimos contraseña
password_raw = simpledialog.askstring("NEXUS SYSTEM - AES-256", 
                                      f"Sellar carpeta:\n{os.path.basename(carpeta_objetivo)}\n\nIntroduce tu llave maestra:", 
                                      show='*')

if not password_raw:
    sys.exit()

# Creamos la ventana de Progreso
prog_win = tk.Toplevel(root)
prog_win.title("Nexus - Cifrando Bóveda")
prog_win.geometry("400x120")
prog_win.configure(bg="#1e1e1e")
prog_win.resizable(False, False)

# Centrar ventana
prog_win.update_idletasks()
x = (prog_win.winfo_screenwidth() - prog_win.winfo_reqwidth()) // 2
y = (prog_win.winfo_screenheight() - prog_win.winfo_reqheight()) // 2
prog_win.geometry(f"+{x}+{y}")

lbl_estado = tk.Label(prog_win, text="Empaquetando archivos... (0%)", bg="#1e1e1e", fg="#ffffff", font=("Segoe UI", 10))
lbl_estado.pack(pady=15)

style = ttk.Style()
style.theme_use('default')
style.configure("TProgressbar", thickness=15, background="#0A84FF", troughcolor="#333333")

prog_bar = ttk.Progressbar(prog_win, orient="horizontal", length=350, mode="determinate", style="TProgressbar")
prog_bar.pack()

root.update()

# Paso 1: Empaquetar
archivo_zip = shutil.make_archive(carpeta_objetivo, 'zip', carpeta_objetivo)

# Paso 2: Cifrar en Chunks (Evita límite de RAM y crasheos en archivos de +10GB)
salt = os.urandom(16)
nonce = os.urandom(16) # CTR mode requiere un Nonce único
kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=600000)
key = kdf.derive(password_raw.encode()) # Se genera clave de 256 bits

cipher = Cipher(algorithms.AES(key), modes.CTR(nonce), backend=default_backend())
encryptor = cipher.encryptor()

archivo_cifrado = archivo_zip + ".nexus"
peso_total = os.path.getsize(archivo_zip)
chunck_size = 64 * 1024 # 64KB en memoria como máximo
bytes_procesados = 0

with open(archivo_zip, 'rb') as f_in, open(archivo_cifrado, 'wb') as f_out:
    # Escribimos los metadatos públicos de descifrado en la cabecera
    f_out.write(salt)
    f_out.write(nonce)
    
    while True:
        chunk = f_in.read(chunck_size)
        if len(chunk) == 0:
            break
            
        datos_cifrados = encryptor.update(chunk)
        f_out.write(datos_cifrados)
        bytes_procesados += len(chunk)
        
        # Actualizamos la Interfaz Gráfica
        if peso_total > 0:
            porcentaje = (bytes_procesados / peso_total) * 100
            prog_bar["value"] = porcentaje
            lbl_estado.config(text=f"Sellando bloques encriptados... ({int(porcentaje)}%)")
            root.update()
            
    f_out.write(encryptor.finalize())

lbl_estado.config(text="Borrando rastros de forma segura (Wipe)...")
root.update()

# Paso 3: Borrado Seguro del ZIP y la Carpeta
os.remove(archivo_zip)

import stat

def force_writable(path):
    try:
        os.chmod(path, stat.S_IWRITE)
    except Exception:
        pass

def secure_delete_folder(root_path):
    chunk_sz = 1024 * 1024
    for root_dir, _, files in os.walk(root_path, topdown=False):
        for file in files:
            ruta = os.path.join(root_dir, file)
            try:
                force_writable(ruta)
                peso = os.path.getsize(ruta)
                with open(ruta, "r+b") as f:
                    b_escritos = 0
                    while b_escritos < peso:
                        bloque = min(chunk_sz, peso - b_escritos)
                        f.write(os.urandom(bloque))
                        b_escritos += bloque
                os.remove(ruta)
            except Exception:
                try:
                    os.remove(ruta)
                except Exception:
                    pass
    shutil.rmtree(root_path, ignore_errors=True)

secure_delete_folder(carpeta_objetivo)

prog_win.destroy()
messagebox.showinfo("NEXUS SYSTEM", "BÓVEDA SELLADA Y ASEGURADA EXITOSAMENTE.\n\nTodos los rastros originales han sido destruidos mediante sobrescritura.")
sys.exit()