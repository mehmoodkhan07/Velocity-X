const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('vx', { platform: process.platform, desktop: true });
