module.exports = {
  packagerConfig: {
    asar: true,
    extraResource: [
      "./mis_scripts" 
    ],
    icon: './assets/icon' // (Opcional) Pon aquí la ruta de tu icono sin el .ico
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'NexusSystem',
        setupExe: 'Nexus_Setup.exe', // Este será el ÚNICO archivo que compartirás
        setupIcon: './assets/icon.ico' // (Opcional) Icono para el instalador
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html: './src/index.html',
              js: './src/renderer.js',
              name: 'main_window',
              preload: {
                js: './src/preload.js',
              },
            },
          ],
        },
      },
    },
  ],
};