// 桌面代理设置的 IPC 数据合同；保存后在下一次启动时统一应用。
export type NetworkProxyMode = 'system' | 'direct' | 'custom';
export type NetworkProxySettings = { mode: NetworkProxyMode; address: string };
