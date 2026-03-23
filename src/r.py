with open(r'c:\Users\gerar\Desktop\mi-dashboard\my-app\src\renderer.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

def rmlines(start, end):
    for i in range(start - 1, end):
        lines[i] = ""

# Delete large Ojo de Dios blocks
rmlines(682, 1129)
rmlines(1285, 1324)
rmlines(1333, 1388)

# Target specific replacements by 1-index
lines[675] = "" # await cargarMotoresFantasma();
lines[1221] = "" # cargarMotoresFantasma();
lines[1222] = "" # bindGhostEvents();
lines[1327] = "" # cerrarOjoDeDios();
lines[1401] = "" # window.abrirOjoDeDios = abrirOjoDeDios;
lines[1402] = "" # window.cerrarOjoDeDios = cerrarOjoDeDios;

with open(r'c:\Users\gerar\Desktop\mi-dashboard\my-app\src\renderer.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)
