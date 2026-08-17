import {tokenizeText} from '../src/text-processors.js';

const TEST_SENTENCES = Object.freeze({
  zh: [
    '你好，世界！',
    '今天是2026年8月17日。',
    '他说：“这件事，我不同意。”',
    '第一项、第二项；第三项？',
    '价格是¥1,299.50，折扣20%。',
    '请访问https://example.com/帮助，然后继续。',
    '邮箱是user@example.com，请及时联系。',
    '版本v2.1.0（测试版）已经发布。',
    '真的吗？！我不相信……',
    '路径/home/user/file.txt不能被误拆。',
    '会议时间：09:30-11:00；地点：A-301。',
    '甲→乙→丙，流程结束。',
    '“Clipboard X”支持中文、English和日本語。',
    '手机号138-0013-8000需要作为结构化数字处理。',
    '没有标点的中文句子用于检查基础分词',
    '表情🙂、符号©以及#标签都不应凭空消失。',
  ],
  en: [
    "I can't do that.I can't do that.",
    'Hello, world!',
    'Wait...what happened?!',
    'She said, "No, thank you."',
    '(One) [two] {three}.',
    'Version v2.1.0-beta is ready.',
    'Email user@example.com, then wait.',
    'Open https://example.com/a?x=1&y=2, please.',
    'The total is $1,299.50 (20% off).',
    'Meet at 09:30-11:00; room A-301.',
    'rock-and-roll isn\'t dead.',
    'First/second\\third|fourth.',
    'One sentence.Another sentence.A third one.',
    'Question?Answer!Statement.',
    'Plain English words without punctuation',
    'Emoji 🙂, copyright ©, and #hashtags remain visible.',
  ],
  ko: [
    '안녕하세요, 세계!',
    '오늘은 2026년 8월 17일입니다.',
    '그는 “할 수 없어요.”라고 말했다.',
    '첫째·둘째·셋째를 확인하세요.',
    '가격은 ₩12,900이며 할인율은 20%입니다.',
    'https://example.com/도움 페이지를 여세요.',
    'user@example.com으로 연락해 주세요.',
    '정말요?!믿을 수 없어요…',
    '오전 09:30-11:00; 회의실 A-301.',
    '(서울) [부산] {제주}',
    '문장 하나.문장 둘.문장 셋.',
    '예/아니요 중 하나를 선택하세요.',
    'Clipboard X는 한국어와 English를 지원합니다.',
    '전화번호 010-1234-5678을 확인하세요.',
    '문장부호가없는한국어문장',
    '이모지🙂, 기호©, #태그도 유지해야 합니다.',
  ],
  ja: [
    'こんにちは、世界！',
    '今日は2026年8月17日です。',
    '彼は「できません。」と言った。',
    '一つ目・二つ目・三つ目を確認する。',
    '価格は¥1,299.50、割引は20％です。',
    'https://example.com/ヘルプを開いてください。',
    'user@example.comへ連絡してください。',
    '本当ですか？！信じられない……',
    '会議は09:30-11:00；部屋はA-301です。',
    '（東京）［大阪］｛京都｝',
    '文その一。文その二。文その三。',
    'はい／いいえを選択してください。',
    'Clipboard Xは日本語とEnglishに対応します。',
    '電話番号090-1234-5678を確認する。',
    '句読点のない日本語の文章',
    '絵文字🙂、記号©、#タグも保持する。',
  ],
});

const EXACT_CASES = Object.freeze([
  {
    name: 'reported adjacent English sentences',
    text: "I can't do that.I can't do that.",
    expected: ['I', "can't", 'do', 'that', '.', 'I', "can't", 'do', 'that', '.'],
  },
  {
    name: 'English punctuation boundary chain',
    text: 'Question?Answer!Statement.',
    expected: ['Question', '?', 'Answer', '!', 'Statement', '.'],
  },
]);

const SPECIAL_CASES = Object.freeze([
  ['url', '请访问https://example.com/帮助，然后继续。', 'https://example.com/帮助'],
  ['url', 'Open https://example.com/a?x=1&y=2, please.', 'https://example.com/a?x=1&y=2'],
  ['email', '邮箱是user@example.com，请及时联系。', 'user@example.com'],
  ['email', 'user@example.com으로 연락해 주세요.', 'user@example.com'],
  ['number', '会议时间：09:30-11:00；地点：A-301。', '09:30-11:00'],
  ['number', '電話番号090-1234-5678を確認する。', '090-1234-5678'],
]);

const failures = [];
let sentenceCount = 0;

for (const [language, sentences] of Object.entries(TEST_SENTENCES)) {
  for (const [index, text] of sentences.entries()) {
    sentenceCount++;
    validateSentence(`${language}-${String(index + 1).padStart(2, '0')}`, text);
  }
}

for (const testCase of EXACT_CASES) {
  const actual = tokenizeText(testCase.text).map(token => token.text);
  if (!equal(actual, testCase.expected)) {
    failures.unshift(`${testCase.name}: expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(actual)}`);
  }
}

for (const [type, text, expectedText] of SPECIAL_CASES) {
  const match = tokenizeText(text).find(token => token.type === type && token.text === expectedText);
  if (!match)
    failures.unshift(`special ${type}: missing ${JSON.stringify(expectedText)} in ${JSON.stringify(text)}`);
}

if (failures.length > 0) {
  const languageSummary = Object.keys(TEST_SENTENCES)
    .map(language => `${language}=${failures.filter(failure => failure.startsWith(`${language}-`)).length}`)
    .join(', ');
  const droppedCharacters = failures.filter(failure => failure.includes(': dropped ')).length;
  const shown = failures.slice(0, 24).join('\n');
  const omitted = failures.length > 24 ? `\n... ${failures.length - 24} more failures` : '';
  throw new Error(
    `Tokenizer matrix failed ${failures.length} checks across ${sentenceCount} sentences `
    + `(${languageSummary}, dropped characters=${droppedCharacters}).\n${shown}${omitted}`,
  );
}

function validateSentence(name, source) {
  const tokens = tokenizeText(source);
  for (const [index, token] of tokens.entries()) {
    if (token.index !== index)
      failures.push(`${name}: token index ${token.index} is not sequential at position ${index}`);
    if (!Number.isInteger(token.start) || !Number.isInteger(token.end)
        || token.start < 0 || token.end <= token.start || token.end > source.length) {
      failures.push(`${name}: invalid token range ${token.start}-${token.end} for ${JSON.stringify(token.text)}`);
      continue;
    }
    if (source.slice(token.start, token.end) !== token.text)
      failures.push(`${name}: token text does not match its source range: ${JSON.stringify(token.text)}`);
    if (index > 0 && tokens[index - 1].end > token.start)
      failures.push(`${name}: tokens overlap at ${tokens[index - 1].end}/${token.start}`);
  }

  for (let offset = 0; offset < source.length;) {
    const codePoint = source.codePointAt(offset);
    const character = String.fromCodePoint(codePoint);
    const end = offset + character.length;
    if (!/^\s$/u.test(character)
        && !tokens.some(token => token.start <= offset && token.end >= end)) {
      failures.push(`${name}: dropped ${JSON.stringify(character)} at UTF-16 offset ${offset} in ${JSON.stringify(source)}`);
    }
    offset = end;
  }
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
