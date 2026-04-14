const { Tray, Menu } = require('electron');
const path = require('path');
const logger = require('../utils/logger');

class TrayIcon {
    constructor(mainWindow, iconPath, onOpen, onQuit) {
        this.mainWindow = mainWindow;
        this.iconPath = iconPath;
        this.onOpen = onOpen;
        this.onQuit = onQuit;
        this.tray = null;
    }

    init() {
        try {
            this.tray = new Tray(this.iconPath);
            const contextMenu = Menu.buildFromTemplate([
                { 
                    label: 'Abrir Horus Engine', 
                    click: () => {
                        this.mainWindow.show();
                        if (this.onOpen) this.onOpen();
                    } 
                },
                { type: 'separator' },
                { 
                    label: 'Actualizar Telemetría', 
                    click: () => {
                        if (this.onOpen) this.onOpen();
                    }
                },
                { type: 'separator' },
                { 
                    label: 'Salir Completamente', 
                    click: () => {
                        if (this.onQuit) this.onQuit();
                    } 
                }
            ]);

            this.tray.setToolTip('Horus Engine - Dashboard Pro');
            this.tray.setContextMenu(contextMenu);

            this.tray.on('double-click', () => {
                this.mainWindow.show();
                if (this.onOpen) this.onOpen();
            });

            logger.info('[TrayIcon] System tray initialized successfully.');
        } catch (e) {
            logger.error(`[TrayIcon] Failed to initialize tray: ${e.message}`);
        }
    }

    destroy() {
        if (this.tray) {
            this.tray.destroy();
        }
    }
}

module.exports = TrayIcon;
