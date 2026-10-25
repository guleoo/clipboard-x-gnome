// Preserve the original regression sample verbatim; native typing reuses it.
export const systemdSample = [
  '[Unit]', '', '# 服务描述', '', 'Description=frp client', '',
  '# 确保在网络就绪后启动', '', 'After=network.target', '', '[Service]', '',
  '# 运行类型，simple 表示直接运行前台进程', '', 'Type=simple', '',
  '# 【重要】启动命令，请务必替换为你的实际路径', '',
  'ExecStart=/opt/frp/frpc -c /opt/frp/frpc.toml', '',
  '# 如果 frp 崩溃，自动重启', '', 'Restart=on-failure', '',
  '# 重启等待秒数', '', 'RestartSec=5s', '',
  '# 允许服务访问的目录，建议设置为配置文件所在目录', '', 'WorkingDirectory=/opt/frp', '',
  '# 安全加固 (可选)，限制权限，提高安全性', '',
  'NoNewPrivileges=yes', 'PrivateTmp=yes', 'ProtectSystem=full', 'ProtectHome=yes', '',
  '[Install]', '', '# 多用户模式下自启', '', 'WantedBy=multi-user.target', '',
].join('\n');
