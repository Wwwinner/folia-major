// 独立字幕窗的设置与屏幕边界校验；位置和锁定不会跟随外观导入。
const DEFAULT_APPEARANCE = { fontSize: 36, glowIntensity: 1 };
const finite = (value, fallback, min, max) => Math.min(max, Math.max(min,
  typeof value === 'number' && Number.isFinite(value) ? value : fallback));
function normalizeDesktopLyricsState(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return { enabled: value.enabled === true, locked: value.locked === true,
    fontSize: finite(value.fontSize, 36, 24, 64), glowIntensity: finite(value.glowIntensity, 1, 0, 2) };
}
function resolveDesktopLyricsBounds(bounds, displays, primary) {
  const work = displays.find(display => bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
    && bounds.x < display.workArea.x + display.workArea.width && bounds.x + (bounds.width || 720) > display.workArea.x
    && bounds.y < display.workArea.y + display.workArea.height && bounds.y + (bounds.height || 240) > display.workArea.y)?.workArea
    || primary.workArea;
  const width = Math.round(finite(bounds?.width, 720, Math.min(320, work.width), work.width));
  const height = Math.round(finite(bounds?.height, 240, Math.min(140, work.height), work.height));
  return { width, height,
    x: Math.round(finite(bounds?.x, work.x + (work.width - width) / 2, work.x, work.x + work.width - width)),
    y: Math.round(finite(bounds?.y, work.y + work.height - height - 64, work.y, work.y + work.height - height)) };
}
function projectDesktopLyricsSnapshot(snapshot) {
  if (!snapshot) return null;
  return { hasTrack: !!snapshot.hasTrack, trackKey: snapshot.trackKey ?? null, lyrics: snapshot.lyrics ?? null,
    currentTime: finite(snapshot.currentTime, 0, 0, Number.MAX_SAFE_INTEGER),
    duration: finite(snapshot.duration, 0, 0, Number.MAX_SAFE_INTEGER), playerState: snapshot.playerState,
    playbackRate: finite(snapshot.playbackRate, 1, 0.25, 4), isAdvancing: snapshot.isAdvancing === true,
    lyricOffsetMs: finite(snapshot.lyricOffsetMs, 0, -3600000, 3600000), updatedAt: snapshot.updatedAt };
}
module.exports = { DEFAULT_APPEARANCE, normalizeDesktopLyricsState, resolveDesktopLyricsBounds, projectDesktopLyricsSnapshot };
