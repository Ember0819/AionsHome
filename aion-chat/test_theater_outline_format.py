import json
import unittest

from theater_outline_format import parse_outline


class OutlineFormatTests(unittest.TestCase):
    def test_valid_story_punctuation_is_preserved_verbatim(self):
        content = '他说：“Wait，别走！”；她答：\'OK\'。【雨夜】范围［１，２］，路径 C:\\notes。😸'
        proposal = dict(consensus=content, outline=content, chapters=[dict(title='第１章：重逢', plan=content)])
        raw = '大纲如下：\n```json\n'+json.dumps(proposal,ensure_ascii=False)+'\n```\n以上供参考。'
        self.assertEqual(parse_outline(raw),proposal)

    def test_mixed_width_quotes_keys_trailing_commas_and_literal_newlines(self):
        raw = '''这是整体规划：
        ```json
        ｛＂Ｃｏｎｓｅｎｓｕｓ＂：“保持慢热、平等。”,
          “全书大纲”："雨夜相遇，随后重逢。”，
          章节列表：【
             ｛“章节标题”：＂雨夜”，'章节大纲'：＂核心变化：从陌生到熟悉
他说：“Wait，别走！”，她停下；保留【红伞】与 code（ＡＢＣ）。＂，｝，
          】，
        ｝
        ```'''
        result=parse_outline(raw)
        self.assertEqual(result['consensus'],'保持慢热、平等。')
        self.assertEqual(result['outline'],'雨夜相遇，随后重逢。')
        self.assertEqual(result['chapters'][0]['title'],'雨夜')
        self.assertEqual(result['chapters'][0]['plan'],'核心变化：从陌生到熟悉\n他说：“Wait，别走！”，她停下；保留【红伞】与 code（ＡＢＣ）。')

    def test_comments_single_quotes_semicolons_and_missing_field_comma(self):
        raw = """{ // 本次计划
          consensus: '偏好不变'; outline: '相遇' /* 注释 */
          'chapters': [{'title': '第一章', 'plan': '场景：雨夜；相遇。',},],
        }"""
        self.assertEqual(parse_outline(raw),dict(consensus='偏好不变',outline='相遇',chapters=[dict(title='第一章',plan='场景：雨夜；相遇。')]))

    def test_escaped_emoji_and_quotes_survive_punctuation_repair(self):
        raw = r'''｛"consensus"："\ud83d\ude38","outline":"他说\"hello\"，停步。","chapters":[{"title":"雨夜","plan":"第一幕\n第二幕","min_chars":５０００,"max_chars":"９０００"}]｝'''
        parsed=parse_outline(raw)
        self.assertEqual(parsed['consensus'],'😸')
        self.assertEqual(parsed['outline'],'他说"hello"，停步。')
        self.assertEqual(parsed['chapters'][0]['plan'],'第一幕\n第二幕')
        self.assertEqual(parsed['chapters'][0]['min_chars'],5000)
        self.assertEqual(parsed['chapters'][0]['max_chars'],'9000')

    def test_unescaped_english_dialogue_quotes_are_kept_as_story_content(self):
        raw = '''｛“consensus”：“慢热”，“outline”：“重逢”，“chapters”：[
          {"title":"Plan B", "plan":"他说 "Wait，别走！"，又说“Please”：雨停再走。"}
        ]｝'''
        self.assertEqual(parse_outline(raw)['chapters'][0]['plan'],
                         '他说 "Wait，别走！"，又说“Please”：雨停再走。')
        self.assertEqual(parse_outline(r"{'outline':'It\'s raining；他说 don\'t go。'}")['outline'],
                         "It's raining；他说 don't go。")

    def test_truncation_and_conflicting_fields_are_not_fabricated_or_overwritten(self):
        for raw in ['{"consensus":"共识","outline":"总纲","chapters":[',
                    '｛“consensus”：“没写完',
                    '{"outline":"一","全书大纲":"二"}',
                    '{"chapters":[{"title":"第一章","plan":"完整"}',
                    '这是一段聊天，不是大纲。']:
            with self.subTest(raw=raw),self.assertRaises(ValueError):
                parse_outline(raw)


if __name__ == '__main__':
    unittest.main()
