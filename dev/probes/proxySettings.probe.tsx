import ProxySettingsSection from '../../src/components/modal/settings/ProxySettingsSection';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import type { ProbeDefinition } from './definition';

// 实际代理设置组件；测试通过 preload 合同注入受控的加载/保存响应。
function ProxySettingsProbe() {
    return <div className="dark min-h-screen bg-neutral-950 p-6" style={{ '--text-primary': '#eeeeee', '--text-secondary': '#b5b5b5' } as React.CSSProperties}>
        <div className="mx-auto max-w-2xl">
            <ProxySettingsSection borderColor="border-white/10" settingsCardClass="bg-white/5" isDaylight={false} theme={DEFAULT_THEME} />
        </div>
    </div>;
}
export default { id: 'proxySettings', title: '代理设置', description: '模式切换、地址校验、保存反馈和窄窗布局', Component: ProxySettingsProbe } satisfies ProbeDefinition;
