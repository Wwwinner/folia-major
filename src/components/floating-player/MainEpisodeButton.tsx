import { ListFilter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEpisodePlaybackStore } from '../../stores/useEpisodePlaybackStore';

// 广播剧的正片跳转按钮；只改变导航策略，始终保留全部队列条目。
export default function MainEpisodeButton({ color, disabled = false }: { color: string; disabled?: boolean }) {
    const { t } = useTranslation();
    const active = useEpisodePlaybackStore(state => state.mainOnly);
    const toggle = useEpisodePlaybackStore(state => state.toggleMainOnly);
    return <button type="button" data-testid="main-episode-toggle" aria-pressed={active}
        aria-label={t('episodes.mainOnly')} title={`${t(active ? 'episodes.mainOnlyOn' : 'episodes.mainOnlyOff')}\n${t('episodes.mainOnlyHint')}`}
        disabled={disabled} onClick={event => { event.stopPropagation(); toggle(); }}
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${disabled ? 'cursor-not-allowed opacity-20' : active ? 'opacity-100' : 'opacity-50 hover:opacity-100 hover:bg-current/10'}`}
        style={{ color, backgroundColor: active ? 'color-mix(in srgb, currentColor 16%, transparent)' : undefined }}>
        <ListFilter size={18} strokeWidth={active ? 2.4 : 1.8} aria-hidden="true" />
        {active && <span aria-hidden="true" className="absolute bottom-1 h-0.5 w-2 rounded-full bg-current" />}
    </button>;
}
