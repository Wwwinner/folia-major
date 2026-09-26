import { Columns2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// 分集面板的局部布局切换；不改变队列或分集顺序。
export default function EpisodeListLayoutButton({ columns, onChange }: {
    columns: 1 | 2; onChange: (columns: 1 | 2) => void;
}) {
    const { t } = useTranslation();
    return <button type="button" data-testid="episode-columns-toggle"
        aria-label={t('episodes.twoColumns')} aria-pressed={columns === 2}
        title={t(columns === 2 ? 'episodes.switchToSingleColumn' : 'episodes.switchToTwoColumns')}
        onClick={() => onChange(columns === 2 ? 1 : 2)}
        className={`rounded-full p-2 hover:bg-current/10 focus-visible:outline focus-visible:outline-2 ${columns === 2 ? 'bg-current/10' : ''}`}>
        <Columns2 size={18} aria-hidden="true" />
    </button>;
}
