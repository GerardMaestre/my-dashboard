# 🦅 Horus Engine

**God-Tier PC Automation**

Bienvenido a **Horus Engine**, una suite definitiva y avanzada de automatización, optimización y mantenimiento de PC. Diseñada para llevar el rendimiento de tu sistema al máximo nivel ("God-Tier"), cuenta con una moderna interfaz gráfica y cientos de herramientas especializadas para gaming, privacidad y configuración profunda de Windows.

---

## 🚀 Características Principales

El proyecto cuenta con un backend multi-lenguaje estructurado en múltiples módulos de automatización:

### 🧹 Mantenimiento de Windows
- **Desinstalador de Bloatware** y **Bloqueo de Telemetría** de Windows.
- Activador Universal, revisión de Mantenimiento de Disco (S.M.A.R.T), y God Mode.

### 🎮 Optimización Gaming
- **Despertar de Núcleos (Unparking):** Exprime cada núcleo de tu CPU.
- **Purgador de RAM & RAM Disk Dinámico:** Carga de juegos en memoria ultra-rápida.
- **Optimizador de Ping & Red:** Reducción de latencia al jugar online.

### 🛡️ Privacidad y Seguridad
- **Cifrado de Carpetas** y destrucción de metadatos.
- **MAC Spoofer** y revisiones de puertos abiertos.
- **Botón de Pánico** y Generador de Identidad Falsa.

### 📁 Utilidades de Archivos y MFT
- **Motor ultrarrápido en Rust (`mft_reader`):** Escaneo a nivel bajo de la *Master File Table* del disco.
- Buscador de duplicados, organizador inteligente y limpieza extrema.

### 🎨 Personalización & Multimedia
- **Inyector de Macros** y Lanzador robusto de Cloud Gaming.
- Setup automatizado de Spicetify.
- Descargador maestro de archivos y multimedia.

---

## 🛠️ Stack Tecnológico

La arquitectura de este proyecto es rica y diversa para lograr comunicarse directamente con el Sistema Operativo:

- **Interfaz Gráfica (GUI):** [Electron](https://www.electronjs.org/), JavaScript, HTML, CSS.
- **Lógica en segundo plano:** 
   - Scripts de **Python** (con entorno portable autoinstalable en primer arranque en modo instalador ligero).
  - Scripts **Batch (.bat)** para interacción directa con Windows PowerShell / CMD.
- **Rendimiento Extremo (Nativo):** **Rust** (Cargo) para acceso nativo al hardware y lectura MFT.

---

## ⚙️ Instalación y Configuración (Modo Desarrollador)

### Prerrequisitos
Asegúrate de tener instalados:
- [Node.js](https://nodejs.org/) (incluye NPM)
- [Python 3.11+](https://www.python.org/)
- [Rust & Cargo](https://rustup.rs/) (para compilar `mft_reader`)

### Pasos de ejecución

1. **Clonar este repositorio**
   ```bash
   git clone https://github.com/GerardMaestre/my-dashboard.git
   cd my-dashboard/my-app
   ```

2. **Instalar dependencias de Electron**
   ```bash
   npm install
   ```

3. **Compilar el analizador nativo (Rust)**
   ```bash
   npm run build:mft
   ```

4. **Ejecutar la App en modo desarrollo**
   ```bash
   npm start
   ```

---

## 📦 Compilación (Build)

Para exportar un empaquetado del software listo para instalarse o ejecutarse de forma portable en Windows:

```bash
# Validar prerequisitos de empaquetado
npm run verify:build

# Construir instalador
npm run build 

# Construir ejecutable empacado (.exe portable)
npm run build:portable

# Build estricto (requiere mft_reader.exe compilado)
npm run build:strict
npm run build:portable:strict
```

### Modo instalador ligero (actual)

- El build excluye `mis_scripts/env_python` para reducir tamaño del instalador.
- En primer arranque, Horus descarga e instala Python portable y WizTree en:
   - Instalado normal: `%APPDATA%\\HorusEngine\\runtime`
   - Portable: `HorusData\\runtime` junto al ejecutable portable
- Si no hay internet en el primer arranque, la app sigue funcionando con degradación controlada (fallbacks nativos y/o Python del sistema).

### Validación estricta opcional para `mft_reader.exe`

Si quieres obligar a que el binario Rust esté presente durante el build:

```bash
set HORUS_REQUIRE_MFT=1
npm run build:mft
npm run build

# Alternativa sin variable de entorno manual
npm run build:strict
```

---

## 👨‍💻 Autor

- **Creador:** Gerar
- **Versión:** 1.4.1

*Copyright © 2026 Gerar - Reservados todos los derechos.*
