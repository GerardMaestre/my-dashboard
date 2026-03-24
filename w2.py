with open('src/preload.js', 'r', encoding='utf-8') as f:
    text = f.read()

old_str = "return await ghostUninstallApp(payload);"
new_str = """return await ghostUninstallApp(payload, force);
        },
        buscarRastrosApp: async (payload) => {
                return await ghostFindLeftovers(payload);
        },
        limpiarRastrosApp: async (items) => {
                return await ghostCleanLeftovers(items);"""

text = text.replace("desinstalarApp: async (payload) => {", "desinstalarApp: async (payload, force = false) => {")
text = text.replace(old_str, new_str)

with open('src/preload.js', 'w', encoding='utf-8') as f:
    f.write(text)
