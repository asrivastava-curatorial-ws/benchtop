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


class CertificatesTest(unittest.TestCase):
    def tearDown(self):
        sys.modules.pop("truststore", None)

    def test_downloads_use_the_system_certificates_when_truststore_is_there(self):
        calls = []
        fake = types.ModuleType("truststore")
        fake.inject_into_ssl = lambda: calls.append("injected")
        sys.modules["truststore"] = fake
        self.assertTrue(server.trust_system_certificates())
        self.assertEqual(calls, ["injected"])

    def test_an_older_setup_without_truststore_still_downloads(self):
        sys.modules["truststore"] = None  # makes the import fail
        self.assertFalse(server.trust_system_certificates())


class OtherModelsTest(unittest.TestCase):
    """The many-language models: names, kinds and how each is asked for a language."""

    def test_model_names_are_checked(self):
        self.assertEqual(server.repo_for("m2m100-418m"), "facebook/m2m100_418M")
        self.assertEqual(server.repo_for("hf:Helsinki-NLP/opus-mt-en-ar"), "Helsinki-NLP/opus-mt-en-ar")
        for bad in ("fr-de", "hf:../etc", "hf:a/b/c", "hf:/x", "hf:-a/b", "hf:a/.."):
            with self.assertRaises(ValueError, msg=bad):
                server.repo_for(bad)
        self.assertTrue(server.other_model("nllb-200-600m"))
        self.assertTrue(server.other_model("hf:facebook/mbart-large-50-many-to-many-mmt"))
        self.assertFalse(server.other_model("indictrans2"))
        self.assertFalse(server.other_model("gemma3:12b"))

    def test_bad_model_names_are_refused_before_downloading(self):
        for bad in ("hf:../x", "hf:a/b/c"):
            with self.assertRaises(SystemExit):
                server.main(["--download", bad])

    def test_the_kind_of_model_decides_how_to_ask_it(self):
        kind = lambda t: types.SimpleNamespace(model_type=t)  # noqa: E731
        self.assertEqual(server.family_of("Helsinki-NLP/opus-mt-en-ar", kind("marian")), "marian")
        self.assertEqual(server.family_of("facebook/nllb-200-distilled-600M", kind("m2m_100")), "nllb")
        self.assertEqual(server.family_of("facebook/m2m100_418M", kind("m2m_100")), "m2m")
        self.assertEqual(server.family_of("google/madlad400-3b-mt", kind("t5")), "madlad")
        self.assertEqual(server.family_of("facebook/mbart-large-50-many-to-many-mmt", kind("mbart")), "mbart")
        with self.assertRaises(ValueError):
            server.family_of("someone/llama", kind("llama"))

    def run_family(self, family, lines, src, tgt, codes=()):
        class Batch(dict):
            def to(self, device):
                return self

        class Tokenizer:
            unk_token_id = 0
            src_lang = None
            supported_language_codes = list(codes)
            known = {"arb_Arab": 7, "hin_Deva": 8, "eng_Latn": 9, "ar_AR": 10, "en_XX": 11}

            def __call__(self, batch, **kwargs):
                return Batch(text=list(batch))

            def convert_tokens_to_ids(self, token):
                return self.known.get(token, 0)

            def get_lang_id(self, code):
                if code not in ("en", "ar", "ja"):
                    raise KeyError(code)
                return f"id-{code}"

            def batch_decode(self, tokens, skip_special_tokens=True):
                return tokens

        class Model:
            def generate(self, text, num_beams, max_length, **options):
                return [f"{options.get('forced_bos_token_id', '-')}|{line}" for line in text]

        fake_torch = types.ModuleType("torch")
        fake_torch.inference_mode = lambda: __import__("contextlib").nullcontext()
        saved = sys.modules.get("torch")
        sys.modules["torch"] = fake_torch
        server.loaded["hf:test/model"] = (family, Tokenizer(), Model(), "cpu", "test/model")
        try:
            return server.translate_other("hf:test/model", lines, src, tgt)
        finally:
            del server.loaded["hf:test/model"]
            if saved is None:
                del sys.modules["torch"]
            else:
                sys.modules["torch"] = saved

    def test_each_kind_is_told_the_languages_its_own_way(self):
        self.assertEqual(self.run_family("nllb", ["Hello"], "eng_Latn", "arb_Arab"), ["7|Hello"])
        self.assertEqual(self.run_family("m2m", ["Hello"], "eng_Latn", "jpn_Jpan"), ["id-ja|Hello"])
        self.assertEqual(self.run_family("mbart", ["Hello"], "eng_Latn", "arb_Arab"), ["10|Hello"])
        self.assertEqual(self.run_family("madlad", ["Hello"], "eng_Latn", "rus_Cyrl"), ["-|<2ru> Hello"])
        self.assertEqual(self.run_family("marian", ["Hello"], "eng_Latn", "arb_Arab"), ["-|Hello"])
        self.assertEqual(self.run_family("marian", ["Hello"], "eng_Latn", "arb_Arab", codes=[">>arb<<", ">>fra<<"]), ["-|>>arb<< Hello"])
        self.assertEqual(self.run_family("nllb", ["Same"], "eng_Latn", "eng_Latn"), ["Same"])

    def test_a_language_the_model_does_not_know_is_reported(self):
        with self.assertRaises(ValueError):
            self.run_family("nllb", ["Hello"], "eng_Latn", "xyz_Latn")
        with self.assertRaises(ValueError):
            self.run_family("m2m", ["Hello"], "eng_Latn", "tel_Telu")
        with self.assertRaises(ValueError):
            self.run_family("marian", ["Hello"], "eng_Latn", "hin_Deva", codes=[">>fra<<"])


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
            # A many-language model is chosen by the request's model.
            other = server.translate_other
            server.translate_other = lambda key, lines, src, tgt: [f"{key}>{tgt}:{line}" for line in lines]
            try:
                body = json.dumps({"model": "m2m100-418m", "benchtop": {"lines": ["hi"], "from": "eng_Latn", "to": "jpn_Jpan"}}).encode()
                request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions", data=body, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(request, timeout=10) as response:
                    reply = json.loads(response.read())
                self.assertEqual(json.loads(reply["choices"][0]["message"]["content"]), ["m2m100-418m>jpn_Jpan:hi"])
                self.assertEqual(reply["model"], "m2m100-418m")
            finally:
                server.translate_other = other
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
