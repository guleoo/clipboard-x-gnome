import {textChunks, typingDelay, typingSequence, typingTiming} from '../../../../src/clipboard/terminal/sequence.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const sequence = typingSequence("A中🙂\r\nB\rC\t'");
assert(sequence.length === 9, 'terminal typing must preserve every Unicode character and control character');
assert(sequence[0] === 'A', 'ASCII character is incorrect');
assert(sequence[1] === '中', 'CJK character is incorrect');
assert(sequence[2] === '🙂', 'non-BMP character is incorrect');
assert(sequence[3] === '\n' && sequence[5] === '\n',
  'line endings must be normalized to Return');
assert(sequence[7] === '\t', 'tab must remain a keyboard Tab');
assert(sequence[8] === "'", 'punctuation character is incorrect');

assert(typingSequence('').length === 0, 'empty text must not generate keyboard events');

const systemdUnit = `[Unit]

# 服务描述

Description=frp client

# 确保在网络就绪后启动

After=network.target

[Service]

# 运行类型，simple 表示直接运行前台进程

Type=simple

# 【重要】启动命令，请务必替换为你的实际路径

ExecStart=/opt/frp/frpc -c /opt/frp/frpc.toml

# 如果 frp 崩溃，自动重启

Restart=on-failure

# 重启等待秒数

RestartSec=5s

# 允许服务访问的目录，建议设置为配置文件所在目录

WorkingDirectory=/opt/frp

# 安全加固 (可选)，限制权限，提高安全性

NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes

[Install]

# 多用户模式下自启

WantedBy=multi-user.target
`;
assert(typingSequence(systemdUnit).join('') === systemdUnit,
  'long mixed-language multiline input must preserve its exact character order');
assert(typingDelay('中') > typingDelay('A'),
  'Unicode composition must receive more settling time than mapped ASCII keys');
for (const [speed, ascii, unicode] of [['standard', 4, 30], ['medium', 6, 40], ['slow', 8, 50]]) {
  assert(typingTiming(speed).settle === 75 && typingDelay('A', speed) === ascii
      && typingDelay('中', speed) === unicode && typingDelay('🙂', speed) === unicode,
    speed + ': initial, ASCII and Unicode timing must match the configured profile');
}

const encoder = new TextEncoder();
for (const source of ['', 'A'.repeat(256), '中'.repeat(257), '🙂'.repeat(513), systemdUnit,
  'A中🙂\r\nB\rC\t'.repeat(100)]) {
  const chunks = [...textChunks(source)];
  assert(chunks.join('') === typingSequence(source).join(''), 'Text chunks must preserve normalized text');
  assert(chunks.every(chunk => [...chunk].length <= 256 && encoder.encode(chunk).length <= 1024),
    'Every text submission must fit both character and UTF-8 byte limits');
}
assert([...textChunks('🙂'.repeat(257))].map(chunk => encoder.encode(chunk).length).join(',') === '1024,4',
  'A four-byte character must not be split across the byte boundary');
for (const invalid of ['A'.repeat(300) + '\0', '中\ud800', '\udfff']) {
  let yielded = false;
  let rejected = false;
  try {
    for (const _chunk of textChunks(invalid))
      yielded = true;
  } catch (error) {
    rejected = error.code === 'invalid_text';
  }
  assert(rejected && !yielded, 'Invalid text must be rejected before yielding even its valid prefix');
}
