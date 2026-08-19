import {tokenizeText} from '../../../src/clipboard/tokenizer/processors.js';

const SUPPORTED_LOCALES = Object.freeze([
  'ar', 'bg', 'ca', 'cs', 'de', 'el', 'es', 'eu', 'fa', 'fi', 'fr_FR', 'hu',
  'it', 'ja', 'kn', 'ko', 'nl', 'oc', 'pl', 'pt_BR', 'ru', 'sk', 'tr', 'uk', 'zh_CN',
]);

const TEST_SENTENCES = Object.freeze({
  ar: [
    'مرحبًا بالعالم! هذا اختبارٌ بسيط.',
    'افتح https://example.com/help، ثم أرسل رسالة إلى user@example.com.',
    'موعد الاجتماع 09:30-11:00؛ الغرفة A-301.',
  ],
  bg: [
    'Здравей, свят! Това е кратък тест.',
    'Отворете https://example.com/help, после пишете на user@example.com.',
    'Срещата е от 09:30 до 11:00; стая A-301.',
  ],
  ca: [
    'Hola, món! Aquesta és una prova breu.',
    'Obriu https://example.com/help i escriviu a user@example.com.',
    'La reunió és de 09:30 a 11:00; sala A-301.',
  ],
  cs: [
    'Ahoj, světe! Toto je krátká zkouška.',
    'Otevřete https://example.com/help a napište na user@example.com.',
    'Schůzka je od 09:30 do 11:00; místnost A-301.',
  ],
  de: [
    'Hallo, Welt! Dies ist ein kurzer Test.',
    'Öffnen Sie https://example.com/help und schreiben Sie an user@example.com.',
    'Das Treffen ist von 09:30 bis 11:00; Raum A-301.',
  ],
  el: [
    'Γεια σου, κόσμε! Αυτή είναι μια σύντομη δοκιμή.',
    'Ανοίξτε το https://example.com/help και γράψτε στο user@example.com.',
    'Η συνάντηση είναι 09:30-11:00· αίθουσα A-301.',
  ],
  es: [
    '¡Hola, mundo! Esta es una prueba breve.',
    'Abre https://example.com/help y escribe a user@example.com.',
    'La reunión es de 09:30 a 11:00; sala A-301.',
  ],
  eu: [
    'Kaixo, mundua! Hau proba labur bat da.',
    'Ireki https://example.com/help eta idatzi user@example.com helbidera.',
    'Bilera 09:30etik 11:00etara da; A-301 gela.',
  ],
  fa: [
    'سلام دنیا! این یک آزمایش کوتاه است.',
    'نشانی https://example.com/help را باز کنید و به user@example.com بنویسید.',
    'جلسه از 09:30 تا 11:00؛ اتاق A-301 است.',
  ],
  fi: [
    'Hei, maailma! Tämä on lyhyt testi.',
    'Avaa https://example.com/help ja kirjoita osoitteeseen user@example.com.',
    'Kokous on 09:30-11:00; huone A-301.',
  ],
  fr_FR: [
    'Bonjour, le monde ! Ceci est un test court.',
    'Ouvrez https://example.com/help et écrivez à user@example.com.',
    'La réunion a lieu de 09:30 à 11:00 ; salle A-301.',
  ],
  hu: [
    'Helló, világ! Ez egy rövid teszt.',
    'Nyissa meg a https://example.com/help oldalt, és írjon a user@example.com címre.',
    'A találkozó 09:30-11:00 között lesz; A-301 terem.',
  ],
  it: [
    'Ciao, mondo! Questa è una breve prova.',
    'Apri https://example.com/help e scrivi a user@example.com.',
    'La riunione è dalle 09:30 alle 11:00; sala A-301.',
  ],
  kn: [
    'ನಮಸ್ಕಾರ, ಜಗತ್ತು! ಇದು ಒಂದು ಚಿಕ್ಕ ಪರೀಕ್ಷೆ.',
    'https://example.com/help ತೆರೆಯಿರಿ ಮತ್ತು user@example.com ಗೆ ಬರೆಯಿರಿ.',
    'ಸಭೆಯ ಸಮಯ 09:30-11:00; ಕೊಠಡಿ A-301.',
  ],
  nl: [
    'Hallo, wereld! Dit is een korte test.',
    'Open https://example.com/help en schrijf naar user@example.com.',
    'De vergadering is van 09:30 tot 11:00; kamer A-301.',
  ],
  oc: [
    'Bonjorn, mond! Aquò es un tèst cort.',
    'Dobritz https://example.com/help e escrivètz a user@example.com.',
    'La reünion es de 09:30 a 11:00; sala A-301.',
  ],
  pl: [
    'Witaj, świecie! To jest krótki test.',
    'Otwórz https://example.com/help i napisz na user@example.com.',
    'Spotkanie trwa od 09:30 do 11:00; sala A-301.',
  ],
  pt_BR: [
    'Olá, mundo! Este é um teste curto.',
    'Abra https://example.com/help e escreva para user@example.com.',
    'A reunião será das 09:30 às 11:00; sala A-301.',
  ],
  ru: [
    'Привет, мир! Это короткая проверка.',
    'Откройте https://example.com/help и напишите на user@example.com.',
    'Встреча пройдёт с 09:30 до 11:00; кабинет A-301.',
  ],
  sk: [
    'Ahoj, svet! Toto je krátka skúška.',
    'Otvorte https://example.com/help a napíšte na user@example.com.',
    'Stretnutie je od 09:30 do 11:00; miestnosť A-301.',
  ],
  tr: [
    'Merhaba, dünya! Bu kısa bir testtir.',
    'https://example.com/help adresini açın ve user@example.com adresine yazın.',
    'Toplantı 09:30-11:00 arasındadır; oda A-301.',
  ],
  uk: [
    'Привіт, світе! Це коротка перевірка.',
    'Відкрийте https://example.com/help і напишіть на user@example.com.',
    'Зустріч триватиме з 09:30 до 11:00; кімната A-301.',
  ],
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

const TEST_LOCALES = Object.freeze({
  fr_FR: 'fr-FR',
  pt_BR: 'pt-BR',
  zh: 'zh-CN',
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

for (const locale of SUPPORTED_LOCALES) {
  const language = locale === 'zh_CN' ? 'zh' : locale;
  if (!TEST_SENTENCES[language]?.length)
    failures.push(`${locale}: supported locale has no tokenizer sentences`);
}

for (const [language, sentences] of Object.entries(TEST_SENTENCES)) {
  for (const [index, text] of sentences.entries()) {
    sentenceCount++;
    validateSentence(
      `${language}-${String(index + 1).padStart(2, '0')}`,
      text,
      TEST_LOCALES[language] ?? language,
    );
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

function validateSentence(name, source, locale) {
  const tokens = tokenizeText(source, locale);
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
