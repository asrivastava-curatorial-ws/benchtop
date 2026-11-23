"""Tests for scripts/indictrans2-server.py that need neither PyTorch nor the models.

The text libraries (sacremoses, indic-nlp-library) are replaced by small stand-ins
that record how they are called, so the processor's own logic is what is tested.
Run: python3 -I -m unittest discover -s tests/python
"""

import importlib.util
import json
import pathlib
import subprocess
import sys
import threading
import types
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "indictrans2-server.py"
spec = importlib.util.spec_from_file_location("indictrans2_server", SCRIPT)
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

CALLS = []


def install_stand_ins():
    moses = types.ModuleType("sacremoses")

    class MosesTokenizer:
        def __init__(self, lang):
            pass

        def tokenize(self, text, escape=True):
            return text.split()

    class MosesPunctNormalizer:
        def normalize(self, text):
            return text

    class MosesDetokenizer:
        def __init__(self, lang):
            pass

        def detokenize(self, tokens):
            return " ".join(tokens)

    moses.MosesTokenizer, moses.MosesPunctNormalizer, moses.MosesDetokenizer = MosesTokenizer, MosesPunctNormalizer, MosesDetokenizer

    class Factory:
        def get_normalizer(self, iso):
            CALLS.append(("normalizer", iso))
            return types.SimpleNamespace(normalize=lambda text: text)

    class Transliterator:
        def transliterate(self, text, source, target):
            CALLS.append(("transliterate", source, target))
            return text

    modules = {
        "sacremoses": moses,
        "indicnlp": types.ModuleType("indicnlp"),
        "indicnlp.normalize": types.ModuleType("indicnlp.normalize"),
        "indicnlp.normalize.indic_normalize": types.SimpleNamespace(IndicNormalizerFactory=Factory),
        "indicnlp.tokenize": types.SimpleNamespace(
            indic_tokenize=types.SimpleNamespace(trivial_tokenize=lambda text, iso: text.split()),
            indic_detokenize=types.SimpleNamespace(trivial_detokenize=lambda text, iso: text),
        ),
        "indicnlp.transliterate": types.ModuleType("indicnlp.transliterate"),
        "indicnlp.transliterate.unicode_transliterate": types.SimpleNamespace(UnicodeIndicTransliterator=Transliterator),
    }
    sys.modules.update(modules)


class ProcessorTest(unittest.TestCase):
    def setUp(self):
        install_stand_ins()
        CALLS.clear()
        self.p = server.PurePythonProcessor(inference=True)

    def test_english_input_is_tagged_and_entities_are_protected(self):
        [line] = self.p.preprocess_batch(["Send an SMS to 9876543210 and email newemail123@xyz.com by 15/10/2023."], "eng_Latn", "hin_Deva")
        self.assertTrue(line.startswith("eng_Latn hin_Deva "))
        self.assertNotIn("newemail123@xyz.com", line)
        self.assertNotIn("15/10/2023", line)
        self.assertIn("<ID1>", line)
        # The model writes its own words around the placeholders; they come back intact.
        model_output = line.split(" ", 2)[2]
        [restored] = self.p.postprocess_batch([model_output], lang="eng_Latn")
        self.assertIn("newemail123@xyz.com", restored)
        self.assertIn("15/10/2023", restored)

    def test_indian_digits_and_punctuation_are_normalised(self):
        [line] = self.p.preprocess_batch(["दाम ₹ ५०  है । “ठीक”"], "hin_Deva", "eng_Latn")
        self.assertEqual(line, 'hin_Deva eng_Latn दाम ₹ 50 है । "ठीक"')

    def test_scripts_are_unified_to_devanagari_except_perso_arabic(self):
        self.p.preprocess_batch(["ಕನ್ನಡ"], "kan_Knda", "eng_Latn")
        self.assertIn(("transliterate", "kn", "hi"), CALLS)
        CALLS.clear()
        self.p.preprocess_batch(["اردو"], "urd_Arab", "eng_Latn")
        self.assertFalse([c for c in CALLS if c[0] == "transliterate"])
        self.p.preprocess_batch(["Hello"], "eng_Latn", "tam_Taml")
        CALLS.clear()
        self.p.postprocess_batch(["नमस्ते"], lang="tam_Taml")
        self.assertIn(("transliterate", "hi", "ta"), CALLS)

    def test_each_line_keeps_its_own_placeholders(self):
        batch = self.p.preprocess_batch(["Call 98765 43210 now", "Mail a@b.org"], "eng_Latn", "hin_Deva")
        outputs = [b.split(" ", 2)[2] for b in batch]
        restored = self.p.postprocess_batch(outputs, lang="eng_Latn")
        self.assertIn("a@b.org", restored[1])
        self.assertNotIn("a@b.org", restored[0])

    def test_digit_table_matches_the_toolkit(self):
        self.assertEqual("०१९".translate(server.DIGITS), "019")
        self.assertEqual("٠".translate(server.DIGITS), "0")
        self.assertEqual("٣".translate(server.DIGITS), "٣")  # only the Arabic-Indic zero is mapped
        self.assertEqual("౦౧".translate(server.DIGITS), "౦1")  # Telugu zero is left alone


class RequestTest(unittest.TestCase):
    def test_benchtop_requests_name_their_lines_and_languages(self):
        lines, src, tgt = server.request_lines({"benchtop": {"lines": ["a", "b"], "from": "Kannada", "to": "hin_Deva"}})
        self.assertEqual((lines, src, tgt), (["a", "b"], "kan_Knda", "hin_Deva"))

    def test_plain_chat_requests_are_understood(self):
        body = {"messages": [{"role": "system", "content": "Translate from English into Tamil."}, {"role": "user", "content": 'Lines: ["Hello", "Thank you"]'}]}
        self.assertEqual(server.request_lines(body), (["Hello", "Thank you"], "eng_Latn", "tam_Taml"))

    def test_unknown_download_direction_is_refused(self):
        with self.assertRaises(SystemExit):
            server.main(["--download", "fr-de"])


class HttpTest(unittest.TestCase):
    def test_chat_endpoint_answers_in_the_openai_shape(self):
        original = server.translate
        server.translate = lambda lines, src, tgt: [f"{tgt}:{line.upper()}" for line in lines]
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            port = httpd.server_address[1]
            body = json.dumps({"model": "indictrans2", "benchtop": {"lines": ["hi there"], "from": "eng_Latn", "to": "hin_Deva"}}).encode()
            request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions", data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=10) as response:
                reply = json.loads(response.read())
            self.assertEqual(json.loads(reply["choices"][0]["message"]["content"]), ["hin_Deva:HI THERE"])
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=10) as response:
                self.assertEqual(json.loads(response.read())["status"], "ok")
        finally:
            httpd.shutdown()
            httpd.server_close()
            server.translate = original


class LifetimeTest(unittest.TestCase):
    def test_server_stops_when_its_parent_closes_standard_input(self):
        proc = subprocess.Popen([sys.executable, "-I", str(SCRIPT), "--port", "0", "--exit-with-stdin"], stdin=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            seen = []
            for line in proc.stderr:
                seen.append(line.strip())
                if line.strip() == "@@ready":
                    break
            self.assertTrue(any(l.startswith("@@listening ") and int(l.split()[1]) > 0 for l in seen), seen)
            proc.stdin.close()
            self.assertEqual(proc.wait(timeout=10), 0)
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            proc.stderr.close()


if __name__ == "__main__":
    unittest.main()
