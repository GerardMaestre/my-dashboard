# mft_reader

Scanner nativo para Horus Engine pensado para lectura NTFS MFT en Windows.

## Estado actual

- CLI y contrato JSON implementados.
- Integrado en Electron como primer motor de escaneo (MFT -> WizTree -> PowerShell).
- Lectura MFT directa esta en construccion; por ahora el binario devuelve error controlado para activar fallback.

## Uso

```powershell
cargo build --manifest-path native_modules/mft_reader/Cargo.toml --release
native_modules\mft_reader\target\release\mft_reader.exe scan --root C:\ --format json
```

## Requisitos Windows para compilar

```powershell
winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements --silent
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --norestart --nocache --installPath C:\\BuildTools --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Sin `link.exe` (MSVC), Cargo no puede enlazar el binario.

## Contrato de salida esperado

```json
{
  "engine": "mft",
  "items": [
    {
      "id": "mft-0",
      "fullPath": "C:\\Users",
      "name": "Users",
      "sizeBytes": 123,
      "percent": 12.3,
      "isDir": true
    }
  ],
  "extensions": [
    {
      "ext": ".log",
      "sizeBytes": 456,
      "percent": 4.1
    }
  ]
}
```
