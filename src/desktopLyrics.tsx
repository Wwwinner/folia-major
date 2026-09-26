import React from 'react';
import { createRoot } from 'react-dom/client';
import './i18n/config';
import DesktopLyricsApp from './components/desktop-lyrics/DesktopLyricsApp';

// 轻量独立入口，不加载主 App、音频节点、封面缓存、shader 或启动遮罩。
createRoot(document.getElementById('root')!).render(<React.StrictMode><DesktopLyricsApp /></React.StrictMode>);
