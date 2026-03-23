with open(r'c:\Users\gerar\Desktop\mi-dashboard\my-app\src\preload.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

def rmlines(start, end):
    for i in range(start - 1, end):
        lines[i] = ""

rmlines(22, 36)
rmlines(126, 132)
rmlines(154, 479)
rmlines(685, 772)
rmlines(799, 816)

with open(r'c:\Users\gerar\Desktop\mi-dashboard\my-app\src\preload.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)
