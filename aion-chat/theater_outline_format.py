"""Read common model punctuation variants without changing story text or filling gaps."""
import json
import re
import unicodedata


_PUNCT = {'｛':'{', '｝':'}', '［':'[', '］':']', '【':'[', '】':']',
          '：':':', '，':',', '、':',', '；':',', ';':','}
_QUOTES = '"＂“”\'＇‘’'
_DOUBLE = '"＂“”'
_ALIASES = {
    '故事共识':'consensus', '共识':'consensus',
    '全书大纲':'outline', '整体大纲':'outline', '总纲':'outline', '全书走向':'outline', '全书走向与结局':'outline',
    '章节':'chapters', '章节列表':'chapters', '章节大纲':'chapters', 'plans':'chapters',
    '标题':'title', '章节标题':'title', '章名':'title',
    '计划':'plan', '章节计划':'plan', '本章大纲':'plan',
    '字数下限':'min_chars', '字数上限':'max_chars',
}


def _key(text):
    key = unicodedata.normalize('NFKC', text).strip().lower()
    return _ALIASES.get(key, key)


def _fields(value, chapter=False):
    if not isinstance(value, dict):
        return value
    result = {}
    for name, item in value.items():
        key = 'plan' if chapter and name.strip() == '章节大纲' else _key(name)
        if key in result:
            raise ValueError('大纲包含重复字段：'+key)
        if key == 'chapters' and isinstance(item, list):
            item = [_fields(p, chapter=True) for p in item]
        if key in ('min_chars', 'max_chars') and isinstance(item, str):
            item = unicodedata.normalize('NFKC', item).strip()
        result[key] = item
    return result


class _Reader:
    def __init__(self, text, start):
        self.text, self.pos = text, start

    def error(self, message):
        raise json.JSONDecodeError(message, self.text, self.pos)

    def skip(self, pos=None):
        i = self.pos if pos is None else pos
        while i < len(self.text):
            if self.text[i].isspace() or self.text[i] == '\ufeff':
                i += 1
            elif self.text.startswith('//', i):
                end = self.text.find('\n', i+2)
                i = len(self.text) if end < 0 else end+1
            elif self.text.startswith('/*', i):
                end = self.text.find('*/', i+2)
                if end < 0:
                    self.error('Unterminated comment')
                i = end+2
            else:
                break
        if pos is None:
            self.pos = i
        return i

    def char(self, pos=None):
        i = self.pos if pos is None else pos
        return _PUNCT.get(self.text[i], self.text[i]) if i < len(self.text) else ''

    def key_ahead(self, pos):
        # A quoted/bare key followed by a colon, rather than punctuation in dialogue.
        return bool(re.match(r'''["＂“”'＇‘’]?[^\s{}｛｝\[\]［］【】,:：，、；;"＂“”'＇‘’]+["＂“”'＇‘’]?\s*[:：]''', self.text[pos:]))

    def string(self, key=False, parent='{'):
        opener = self.text[self.pos]
        quotes = _DOUBLE if opener in _DOUBLE else "'＇‘’"
        self.pos += 1
        chars = []
        while self.pos < len(self.text):
            c = self.text[self.pos]
            if c == '\\' and self.pos+1 < len(self.text):
                nxt = self.text[self.pos+1]
                if nxt == "'" and opener not in _DOUBLE:
                    chars.append("'"); self.pos += 2
                    continue
                size = 6 if nxt == 'u' else 2
                if re.match(r'\\u[dD][89aAbB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2}', self.text[self.pos:]):
                    size = 12
                escape = self.text[self.pos:self.pos+size]
                try:
                    decoded = json.loads('"'+escape+'"')
                except ValueError:
                    decoded, size = c, 1
                chars.append(decoded); self.pos += size
                continue
            if c in quotes:
                after = self.skip(self.pos+1)
                token = self.char(after)
                closing = token == ':' if key else token in ('}' if parent == '{' else ']', '')
                if not key and token == ',':
                    following = self.skip(after+1)
                    closing = (self.char(following) in ('}', ']') or
                               (self.key_ahead(following) if parent == '{' else
                                self.char(following) in ('{', '[', *list(_QUOTES)) or
                                bool(re.match(r'(?:[-0-9０-９]|true\b|false\b|null\b)', self.text[following:]))))
                if not key and parent == '{' and after < len(self.text) and self.text[after] in _QUOTES and self.key_ahead(after):
                    closing = True  # A missing separator between complete fields.
                if closing:
                    self.pos += 1
                    return ''.join(chars)
            chars.append(c); self.pos += 1
        self.error('Unterminated string')

    def value(self, parent='{'):
        self.skip()
        token = self.char()
        if token in ('{', '['):
            return self.container(token)
        if token in _QUOTES and token:
            return self.string(parent=parent)
        start = self.pos
        while self.pos < len(self.text) and self.char() not in ',}]:':
            if self.text[self.pos].isspace():
                break
            self.pos += 1
        raw = unicodedata.normalize('NFKC', self.text[start:self.pos])
        try:
            return json.loads(raw)
        except ValueError:
            self.error('Expected a JSON value')

    def container(self, opener):
        self.pos += 1
        result = {} if opener == '{' else []
        closer = '}' if opener == '{' else ']'
        self.skip()
        while self.char() != closer:
            if not self.char():
                self.error('Unclosed container')
            if opener == '{':
                if self.char() in _QUOTES:
                    name = self.string(key=True)
                else:
                    start = self.pos
                    while self.char() and self.char() not in ':,{}[]':
                        self.pos += 1
                    name = self.text[start:self.pos].strip()
                self.skip()
                if not name or self.char() != ':':
                    self.error('Expected a field name and colon')
                self.pos += 1
                if name in result:
                    self.error('Duplicate field')
                result[name] = self.value(opener)
            else:
                result.append(self.value(opener))
            self.skip()
            if self.char() == closer:
                break
            if self.char() == ',':
                self.pos += 1; self.skip()
            elif opener == '{' and self.key_ahead(self.pos):
                continue
            else:
                self.error('Expected a separator or closing bracket')
        self.pos += 1
        return result


def parse_outline(text):
    start = re.search('[{｛]', text)
    if not start:
        raise json.JSONDecodeError('No outline object', text, 0)
    try:
        # Valid JSON (including literal newlines in model strings) keeps its content intact.
        data, _ = json.JSONDecoder(strict=False).raw_decode(text, start.start())
    except json.JSONDecodeError:
        data = _Reader(text, start.start()).value()
    return _fields(data)
