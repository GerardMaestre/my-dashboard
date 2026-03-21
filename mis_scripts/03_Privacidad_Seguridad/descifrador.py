import os
import sys
import zipfile
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

archivo_cifrado = sys.argv[1]

# Interfaz gráfica base
root = tk.Tk()
root.withdraw()
root.configure(bg="#1e1e1e")

password_raw = simpledialog.askstring("HORUS ENGINE - AES-256", 
                                      f"Abrir Bóveda:\n{os.path.basename(archivo_cifrado)}\n\nIntroduce la llave maestra:", 
                                      show='*')

if not password_raw:
    sys.exit()

# Ventana de progreso visual
prog_win = tk.Toplevel(root)
prog_win.title("HORUS - Extrayendo Bóveda")
prog_win.geometry("400x120")
prog_win.configure(bg="#1e1e1e")
prog_win.resizable(False, False)

# Centrar
prog_win.update_idletasks()
x = (prog_win.winfo_screenwidth() - prog_win.winfo_reqwidth()) // 2
y = (prog_win.winfo_screenheight() - prog_win.winfo_reqheight()) // 2
prog_win.geometry(f"+{x}+{y}")

lbl_estado = tk.Label(prog_win, text="Desencriptando bloques... (0%)", bg="#1e1e1e", fg="#ffffff", font=("Segoe UI", 10))
lbl_estado.pack(pady=15)

style = ttk.Style()
style.theme_use('default')
style.configure("TProgressbar", thickness=15, background="#30D158", troughcolor="#333333")

prog_bar = ttk.Progressbar(prog_win, orient="horizontal", length=350, mode="determinate", style="TProgressbar")
prog_bar.pack()

root.update()

try:
    archivo_zip = archivo_cifrado.replace('.horus', '')
    peso_total = os.path.getsize(archivo_cifrado) - 32 # Restar salt y nonce
    
    with open(archivo_cifrado, 'rb') as f_in, open(archivo_zip, 'wb') as f_out:
        # Leer metadatos públicos de la cabecera
        salt = f_in.read(16)
        nonce = f_in.read(16)
        
        # Validaciones de seguridad para evitar saltos o archivos corruptos de otra versión
        if len(salt) < 16 or len(nonce) < 16:
            raise ValueError("Formato de bóveda corrupto o desactualizado.")

        kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=600000)
        key = kdf.derive(password_raw.encode())

        cipher = Cipher(algorithms.AES(key), modes.CTR(nonce), backend=default_backend())
        decryptor = cipher.decryptor()
        
        chunck_size = 64 * 1024
        bytes_procesados = 0
        
        while True:
            chunk = f_in.read(chunck_size)
            if len(chunk) == 0:
                break
                
            datos_descifrados = decryptor.update(chunk)
            f_out.write(datos_descifrados)
            bytes_procesados += len(chunk)
            
            # Actualizar barra gráfica
            if peso_total > 0:
                porcentaje = min(100, (bytes_procesados / peso_total) * 100)
                prog_bar["value"] = porcentaje
                lbl_estado.config(text=f"Reconstruyendo archivos... ({int(porcentaje)}%)")
                root.update()
                
        f_out.write(decryptor.finalize())

    lbl_estado.config(text="Desempaquetando estructura de carpetas...")
    root.update()
        
    carpeta_destino = archivo_zip.replace('.zip', '')
    with zipfile.ZipFile(archivo_zip, 'r') as zip_ref:
        zip_ref.extractall(carpeta_destino)
        
    os.remove(archivo_zip)
    prog_win.destroy()
    messagebox.showinfo("HORUS ENGINE", "BÓVEDA ABIERTA EXITOSAMENTE.\n\nTus datos han sido restaurados correctamente.")

except Exception as e:
    prog_win.destroy()
    if os.path.exists(archivo_zip):
        try:
            os.remove(archivo_zip) # Limpiar zip corrupto en caso de fallo
        except Exception:
            pass
    messagebox.showerror("ACCESO DENEGADO", "Contraseña incorrecta o archivo de bóveda dañado/incompatible.")
