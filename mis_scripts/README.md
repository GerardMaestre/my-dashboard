# Colección de Herramientas y Scripts - Dashboard

Bienvenido al directorio central de **Herrramientas Útiles (`mis_scripts`)**. 
Anteriormente, había una gran cantidad de archivos `.bat` y `.py` mezclados en una sola carpeta, lo cual dificultaba la lectura y su uso cotidiano. 

Ahora cada herramienta tiene una función específica y está agrupada según su categoría principal.

## Directorio de Categorías:
Entra a la carpeta correspondiente para ver el `README.md` detallado de cada una.
1. **[01_Mantenimiento_Windows](./01_Mantenimiento_Windows)**: Actualizar aplicaciones, limpiar sistema base y optimizar discos.
2. **[02_Optimizacion_Gaming](./02_Optimizacion_Gaming)**: Exprimir al máximo la PC (RAM, CPU, red y shaders) al jugar.
3. **[03_Privacidad_Seguridad](./03_Privacidad_Seguridad)**: Cifrado pesado de carpetas, detectar intrusos, matar procesos ocultos o borrar metadatos.
4. **[04_Utilidades_Archivos](./04_Utilidades_Archivos)**: Buscar archivos duplicados y organizar dinámicamente carpetas como descargas o el escritorio.
5. **[05_Descargas_Multimedia](./05_Descargas_Multimedia)**: Motores de descarga masiva de alta calidad (Audio a 320k, video, YouTube-DL).
6. **[06_Personalizacion](./06_Personalizacion)**: Modding como inyectores de menú y customización de Spotify (Spicetify).

## Instalación de dependencias (Python)
Para que los scripts `.py` funcionen correctamente, es recomendable utilizar la carpeta `env_python` o asegurarte de ejecutar `pip install` cuando el script requiera de librerías externas.

## Estandar de metadatos (Dashboard)

El dashboard lee metadatos al inicio del archivo para mostrar descripcion, parametros y badges visuales.

En scripts Python:

```python
# DESC: Descripcion breve para usuario final
# ARGS: Parametros esperados
# RISK: normal|low|medium|high|critical
# PERM: user|admin
# MODE: internal|external
```

En scripts Batch:

```bat
:: DESC: Descripcion breve para usuario final
:: ARGS: Parametros esperados
:: RISK: normal|low|medium|high|critical
:: PERM: user|admin
:: MODE: internal|external
```

Notas:
- `DESC` y `ARGS` son compatibles con el formato historico.
- `RISK`, `PERM` y `MODE` son opcionales, pero recomendados para scripts nuevos o sensibles.

## Convención de seguridad

Para scripts de riesgo alto o critico:

1. Mostrar advertencia clara antes de ejecutar.
2. Pedir doble confirmacion por texto (ejemplo: `SI` y una palabra final de confirmacion).
3. Permitir cancelacion limpia sin aplicar cambios.
4. Mostrar resumen final con resultado.
