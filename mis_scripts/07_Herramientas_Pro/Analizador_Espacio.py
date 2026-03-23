import os
import sys

# DESC: Analizador de Espacio Nativo (Escanea Disco C:)
# ARGS: 

MAX_TOP = 15

def format_size(size):
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0

def main():
    print("=" * 64)
    print("   HORUS PRO - ANALIZADOR VISUAL DE ESPACIO")
    print("=" * 64)
    print("Iniciando escaneo de carpetas pesadas en C:\\")
    print("Esto puede tardar unos segundos segun el tamano del disco.\n")
    
    root_path = "C:\\"
    folder_sizes = {}
    
    # Excluir carpetas del sistema para evitar errores de permisos y lentitud extrema
    excludes = ['windows', 'program files', 'program files (x86)', 'programdata', '$recycle.bin']
    analyzed_folders = 0
    skipped_folders = 0
    
    try:
        # Solo nivel 1 por velocidad (o podríamos usar os.walk pero tardaría mucho más sin C/C++)
        with os.scandir(root_path) as entries:
            for entry in entries:
                if entry.is_dir() and entry.name.lower() not in excludes and not entry.name.startswith('.'):
                    folder_path = entry.path
                    total_size = 0
                    analyzed_folders += 1
                    try:
                        for dirpath, dirnames, filenames in os.walk(folder_path):
                            dirnames[:] = [d for d in dirnames if d.lower() not in excludes]
                            for f in filenames:
                                fp = os.path.join(dirpath, f)
                                if not os.path.islink(fp):
                                    try:
                                        total_size += os.path.getsize(fp)
                                    except:
                                        pass
                        if total_size > 0:
                            folder_sizes[folder_path] = total_size
                            print(f"[{format_size(total_size)}] - {folder_path}")
                    except Exception as e:
                        skipped_folders += 1
    except Exception as e:
        print("Error accesando:", e)
        
    print("\n" + "-" * 64)
    print(f"TOP {MAX_TOP} CARPETAS MAS PESADAS")
    print("-" * 64)
    sorted_folders = sorted(folder_sizes.items(), key=lambda x: x[1], reverse=True)
    
    for idx, (folder, size) in enumerate(sorted_folders[:MAX_TOP], start=1):
        print(f"{str(idx).rjust(2)}. {format_size(size).ljust(10)} : {folder}")
    
    total_analyzed = sum(folder_sizes.values())
    print("\n" + "-" * 64)
    print(f"Carpetas analizadas : {analyzed_folders}")
    print(f"Carpetas omitidas   : {skipped_folders}")
    print(f"Total analizado     : {format_size(total_analyzed)}")
    print("-" * 64)
        
    print("[+] Escaneo completado. Usa esta informacion para liberar espacio manual.")

if __name__ == "__main__":
    main()