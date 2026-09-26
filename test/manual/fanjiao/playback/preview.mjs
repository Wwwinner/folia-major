// 验证页面只消费本机适配器给出的媒体 URL 与统一句级字幕，不接触签名或密钥。
const audio = document.querySelector('#audio');
const status = document.querySelector('#status');
const buttons = [...document.querySelectorAll('button')];
const diagnostics = { events: [], fatalErrors: [], refreshCount: 0 };
window.probeDiagnostics = diagnostics;
let episode;
let hls;
let rowElements = [];
let lastActive = '';

async function json(path, options) {
    const response = await fetch(path, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
}

function updateTimeline() {
    if (!episode) return;
    const time = audio.currentTime;
    document.querySelector('#clock').textContent = `${time.toFixed(2)} / ${(audio.duration || episode.duration).toFixed(2)} 秒`;
    const active = episode.lyrics?.lines.filter(line => time >= line.startTime && time < line.endTime) || [];
    const key = active.map(line => line.id).join('|');
    if (key === lastActive) return;
    lastActive = key;
    document.querySelector('#active-subtitle').textContent = active.map(line => line.fullText).join(' / ') || '…';
    for (const [index, row] of rowElements.entries()) row.classList.toggle('active', active.includes(episode.lyrics.lines[index]));
}

// 由 hls.js 把清晰 TS 转为 MSE 音频；媒体解码仍使用浏览器的原生播放器。
function loadMedia(position = 0, resume = false) {
    hls?.destroy();
    if (Hls.isSupported()) {
        hls = new Hls({ maxBufferLength: 10, maxMaxBufferLength: 15, backBufferLength: 10 });
        hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
                diagnostics.fatalErrors.push(data.details);
                status.textContent = `播放错误：${data.details}`;
            }
        });
        hls.loadSource('/media/index.m3u8');
        hls.attachMedia(audio);
    } else if (audio.canPlayType('application/vnd.apple.mpegurl')) audio.src = '/media/index.m3u8';
    else throw new Error('当前浏览器不支持此 HLS 验证');
    audio.addEventListener('loadedmetadata', async () => {
        if (position) audio.currentTime = Math.min(position, audio.duration - .1);
        if (resume) await audio.play();
    }, { once: true });
}

for (const name of ['loadedmetadata', 'playing', 'pause', 'seeking', 'seeked', 'ended', 'error']) {
    audio.addEventListener(name, () => {
        diagnostics.events.push({ name, time: audio.currentTime, at: performance.now() });
        if (diagnostics.events.length > 200) diagnostics.events.shift();
        if (name === 'playing') status.textContent = '播放中';
        if (name === 'pause') status.textContent = '已暂停';
        if (name === 'ended') status.textContent = '播放结束';
        if (name === 'error') diagnostics.fatalErrors.push(`media:${audio.error?.code}`);
        updateTimeline();
    });
}
audio.addEventListener('timeupdate', updateTimeline);
document.querySelector('#play').onclick = () => audio.play().catch(error => { status.textContent = error.message; });
document.querySelector('#pause').onclick = () => audio.pause();
document.querySelector('#seek').onclick = () => { audio.currentTime = Math.min(30, audio.duration - .1); };
document.querySelector('#refresh').onclick = async () => {
    const position = audio.currentTime;
    const resume = !audio.paused;
    audio.pause();
    status.textContent = '正在刷新播放地址…';
    buttons.forEach(button => { button.disabled = true; });
    try {
        await json('/api/test-expire', { method: 'POST' });
        episode = await json('/api/episode');
        diagnostics.refreshCount += 1;
        loadMedia(position, resume);
        status.textContent = '地址已刷新';
    } catch (error) { status.textContent = error.message; }
    finally { buttons.forEach(button => { button.disabled = false; }); }
};

try {
    episode = await json('/api/episode');
    window.probeEpisode = episode;
    document.querySelector('#title').textContent = episode.title;
    document.querySelector('#details').textContent = `${episode.duration.toFixed(2)} 秒 · ${episode.quality} · ${episode.format} · ${episode.segmentCount} 个分片`;
    rowElements = (episode.lyrics?.lines || []).map(line => {
        const row = document.createElement('li');
        row.dataset.cueId = line.id;
        const time = document.createElement('time');
        time.textContent = `${line.startTime.toFixed(2)}–${line.endTime.toFixed(2)} 秒`;
        row.append(time, document.createTextNode(line.fullText));
        document.querySelector('#subtitles').append(row);
        return row;
    });
    loadMedia();
    buttons.forEach(button => { button.disabled = false; });
    status.textContent = episode.subtitleWarning || '已准备好，点击播放';
    setInterval(async () => {
        try { document.querySelector('#stats').textContent = JSON.stringify(await json('/api/stats'), null, 2); }
        catch { /* 服务关闭时保留最后的验证状态。 */ }
    }, 1000);
} catch (error) { status.textContent = error.message; diagnostics.fatalErrors.push(error.message); }
