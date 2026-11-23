#!/usr/bin/env python3
"""IndicTrans2 translation server for Benchtop's Video Dubbing tool.

Runs AI4Bharat's IndicTrans2 (the distilled 200M models) on this computer and
answers the same requests as Ollama or LM Studio, so the Video Dubbing tool's
"Local AI server" setting works with it.  English to and from the 22 scheduled
languages of India; between two Indian languages it goes through English.

Benchtop can set all of this up by itself: Video Dubbing -> IndicTrans2 on this
computer -> Set up IndicTrans2.  To run it by hand instead:

    pip install "torch>=2.5" "transformers>=4.51,<5" sentencepiece sacremoses indic-nlp-library-itt
    python3 indictrans2-server.py                 # serves http://127.0.0.1:8800

In Benchtop: Video Dubbing -> Local AI server, address
http://127.0.0.1:8800/v1/chat/completions (any model name).  The models are
downloaded from Hugging Face the first time (about 1 GB per direction; run with
--download to fetch them up front) and later runs work offline.  The
Indian-to-English model asks you to accept its terms on its Hugging Face page
first; then run `huggingface-cli login` once, or set HF_TOKEN while downloading.

Options: --port N (0 picks a free port), --host ADDRESS, --beams N (default 4),
--cpu, --preload (load the downloaded models before answering), --download
[en-indic,indic-en] (fetch the models and exit), --exit-with-stdin (stop when
the program that started this one closes its end of standard input).

Lines starting with "@@" on standard error are for Benchtop: @@total BYTES,
@@model DIRECTION NAME, @@ok DIRECTION, @@gated DIRECTION MESSAGE,
@@listening PORT, @@missing DIRECTION, @@ready.

The text processing is a pure-Python copy of IndicTransToolkit's IndicProcessor
(MIT licence, Copyright (c) Varun Gumma), so nothing needs compiling on any system.

SPDX-License-Identifier: MIT
"""

import argparse
import json
import os
import re as std_re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from queue import Queue

MODELS = {
    "en-indic": "ai4bharat/indictrans2-en-indic-dist-200M",
    "indic-en": "ai4bharat/indictrans2-indic-en-dist-200M",
}

# Language names Benchtop uses -> FLORES-200 codes.
NAMES = {
    "english": "eng_Latn", "hindi": "hin_Deva", "kannada": "kan_Knda", "tamil": "tam_Taml",
    "telugu": "tel_Telu", "malayalam": "mal_Mlym", "bengali": "ben_Beng", "marathi": "mar_Deva",
    "gujarati": "guj_Gujr", "punjabi": "pan_Guru", "odia": "ory_Orya", "assamese": "asm_Beng",
    "urdu": "urd_Arab", "nepali": "npi_Deva", "sanskrit": "san_Deva", "konkani": "gom_Deva",
    "maithili": "mai_Deva", "manipuri": "mni_Beng", "bodo": "brx_Deva", "dogri": "doi_Deva",
    "kashmiri": "kas_Arab", "santali": "sat_Olck", "sindhi": "snd_Arab",
}


def say(line):
    """A line for Benchtop (and for whoever reads the log)."""
    print(line, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# Text processing: a pure-Python version of IndicTransToolkit's IndicProcessor
# (processor.pyx, version 1.1.1), MIT licence, Copyright (c) Varun Gumma.
# --------------------------------------------------------------------------

FLORES_TO_ISO = {
    "asm_Beng": "as", "awa_Deva": "hi", "ben_Beng": "bn", "bho_Deva": "hi", "brx_Deva": "hi",
    "doi_Deva": "hi", "eng_Latn": "en", "gom_Deva": "kK", "gon_Deva": "hi", "guj_Gujr": "gu",
    "hin_Deva": "hi", "hne_Deva": "hi", "kan_Knda": "kn", "kas_Arab": "ur", "kas_Deva": "hi",
    "kha_Latn": "en", "lus_Latn": "en", "mag_Deva": "hi", "mai_Deva": "hi", "mal_Mlym": "ml",
    "mar_Deva": "mr", "mni_Beng": "bn", "mni_Mtei": "hi", "npi_Deva": "ne", "ory_Orya": "or",
    "pan_Guru": "pa", "san_Deva": "hi", "sat_Olck": "or", "snd_Arab": "ur", "snd_Deva": "hi",
    "tam_Taml": "ta", "tel_Telu": "te", "urd_Arab": "ur", "unr_Deva": "hi",
}

# Digits to ASCII, exactly as processor.pyx maps them: zero to nine in Bengali, Gujarati,
# Kannada, Devanagari, Meetei Mayek, Odia, Gurmukhi, Ol Chiki and Extended Arabic-Indic,
# plus the Arabic-Indic zero and the Telugu one to nine.
_DIGIT_BLOCKS = [0x09E6, 0x0AE6, 0x0CE6, 0x0966, 0xABF0, 0x0B66, 0x0A66, 0x1C50, 0x06F0]
DIGITS = {start + n: str(n) for start in _DIGIT_BLOCKS for n in range(10)}
DIGITS[0x0660] = "0"
DIGITS.update({0x0C66 + n: str(n) for n in range(1, 10)})

INDIC_FAILURE_CASES = [
    "آی ڈی ", "ꯑꯥꯏꯗꯤ", "आईडी", "आई . डी . ", "आई . डी .", "आई. डी. ", "आई. डी.", "आय. डी. ",
    "आय. डी.", "आय . डी . ",
    # As in processor.pyx, where a missing comma joins these two.
    "आय . डी ." "आइ . डी . ",
    "आइ . डी .", "आइ. डी. ", "आइ. डी.", "ऐटि", "آئی ڈی ", "ᱟᱭᱰᱤ ᱾", "आयडी", "ऐडि", "आइडि", "ᱟᱭᱰᱤ",
]


class PurePythonProcessor:
    """preprocess_batch and postprocess_batch, as in IndicTransToolkit."""

    def __init__(self, inference=True):
        try:
            import regex as re
        except ImportError:  # the standard module handles these patterns too
            re = std_re
        from indicnlp.normalize.indic_normalize import IndicNormalizerFactory
        from indicnlp.tokenize import indic_detokenize, indic_tokenize
        from indicnlp.transliterate.unicode_transliterate import UnicodeIndicTransliterator
        from sacremoses import MosesDetokenizer, MosesPunctNormalizer, MosesTokenizer

        self.re = re
        self.inference = inference
        self._maps = Queue()
        self._normalizers = IndicNormalizerFactory()
        self._indic_tokenize = indic_tokenize
        self._indic_detokenize = indic_detokenize
        self._en_tok = MosesTokenizer(lang="en")
        self._en_normalizer = MosesPunctNormalizer()
        self._en_detok = MosesDetokenizer(lang="en")
        self._xliterator = UnicodeIndicTransliterator()

        self._multispace = re.compile(r"[ ]{2,}")
        self._digit_space_percent = re.compile(r"(\d) %")
        self._double_quot_punc = re.compile(r"\"([,\.]+)")
        self._digit_nbsp_digit = re.compile(r"(\d) (\d)")
        self._end_bracket_space_punc = re.compile(r"\) ([\.!:?;,])")
        self._url = re.compile(r"\b(?<![\w/.])(?:(?:https?|ftp)://)?(?:(?:[\w-]+\.)+(?!\.))(?:[\w/\-?#&=%.]+)+(?!\.\w+)\b")
        self._numeral = re.compile(
            r"(~?\d+\.?\d*\s?%?\s?-?\s?~?\d+\.?\d*\s?%|~?\d+%|\d+[-\/.,:']\d+[-\/.,:'+]\d+(?:\.\d+)?|\d+[-\/.:'+]\d+(?:\.\d+)?)"
        )
        self._email = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}")
        self._other = re.compile(r"[A-Za-z0-9]*[#|@]\w+")
        self._punc_replacements = [
            (re.compile(r"\r"), ""),
            (re.compile(r"\(\s*"), "("),
            (re.compile(r"\s*\)"), ")"),
            (re.compile(r"\s:\s?"), ":"),
            (re.compile(r"\s;\s?"), ";"),
            (re.compile(r"[`´‘‚’]"), "'"),
            (re.compile(r"[„“”«»]"), '"'),
            (re.compile(r"[–—]"), "-"),
            (re.compile(r"\.\.\."), "..."),
            (re.compile(r" %"), "%"),
            (re.compile(r"nº "), "nº "),
            (re.compile(r" ºC"), " ºC"),
            (re.compile(r" [?!;]"), lambda m: m.group(0).strip()),
            (re.compile(r", "), ", "),
        ]

    def _punc_norm(self, text):
        for pattern, replacement in self._punc_replacements:
            text = pattern.sub(replacement, text)
        text = self._multispace.sub(" ", text)
        text = self._end_bracket_space_punc.sub(r")\1", text)
        text = self._digit_space_percent.sub(r"\1%", text)
        text = self._double_quot_punc.sub(r'\1"', text)
        text = self._digit_nbsp_digit.sub(r"\1.\2", text)
        return text.strip()

    def _wrap_with_placeholders(self, text):
        serial = 1
        entities = {}
        for pattern in (self._email, self._url, self._numeral, self._other):
            for match in set(pattern.findall(text)):
                if pattern is self._url and len(match.replace(".", "")) < 4:
                    continue
                if pattern is self._numeral and len(match.replace(" ", "").replace(".", "").replace(":", "")) < 4:
                    continue
                for tag in ("ID", "id"):
                    for form in ("<{t}{n}>", "< {t}{n} >", "[{t}{n}]", "[ {t}{n} ]", "[{t} {n}]", "<{t}{n}]", "< {t}{n}]", "<{t}{n} ]"):
                        entities[form.format(t=tag, n=serial)] = match
                for case in INDIC_FAILURE_CASES:
                    for form in ("<{c}{n}>", "< {c}{n} >", "< {c} {n} >", "<{c} {n}]", "< {c} {n} ]", "[{c}{n}]", "[{c} {n}]", "[ {c}{n} ]", "[ {c} {n} ]", "{c} {n}", "{c}{n}"):
                        entities[form.format(c=case, n=serial)] = match
                text = text.replace(match, f"<ID{serial}>")
                serial += 1
        text = self.re.sub(r"\s+", " ", text).replace(">/", ">").replace("]/", "]")
        self._maps.put(entities)
        return text

    def _normalize(self, text):
        text = text.translate(DIGITS)
        if self.inference:
            text = self._wrap_with_placeholders(text)
        return text

    def _preprocess(self, sentence, src_lang, tgt_lang, normalizer, is_target):
        iso = FLORES_TO_ISO.get(src_lang, "hi")
        script = src_lang.split("_")[1]
        sentence = self._normalize(self._punc_norm(sentence))
        if iso == "en":
            tokens = self._en_tok.tokenize(self._en_normalizer.normalize(sentence.strip()), escape=False)
            processed = " ".join(tokens)
        else:
            tokens = self._indic_tokenize.trivial_tokenize(normalizer.normalize(sentence.strip()), iso)
            processed = " ".join(tokens)
            if script not in ("Arab", "Aran", "Olck", "Mtei", "Latn"):
                processed = self._xliterator.transliterate(processed, iso, "hi").replace(" ् ", "्")
        processed = processed.strip()
        return processed if is_target else f"{src_lang} {tgt_lang} {processed}"

    def preprocess_batch(self, batch, src_lang, tgt_lang=None, is_target=False, visualize=False):
        normalizer = None if src_lang == "eng_Latn" else self._normalizers.get_normalizer(FLORES_TO_ISO.get(src_lang, "hi"))
        return [self._preprocess(sentence, src_lang, tgt_lang, normalizer, is_target) for sentence in batch]

    def _postprocess(self, sentence, lang, entities):
        if isinstance(sentence, (tuple, list)):
            sentence = sentence[0]
        lang_code, script = lang.split("_", 1)
        iso = FLORES_TO_ISO.get(lang, "hi")
        if script in ("Arab", "Aran"):
            sentence = sentence.replace(" ؟", "؟").replace(" ۔", "۔").replace(" ،", "،").replace("ٮ۪", "ؠ")
        if lang_code == "ory":
            sentence = sentence.replace("ଯ଼", "ୟ")
        for placeholder, original in entities.items():
            sentence = sentence.replace(placeholder, original)
        if lang == "eng_Latn":
            return self._en_detok.detokenize(sentence.split(" "))
        return self._indic_detokenize.trivial_detokenize(self._xliterator.transliterate(sentence, "hi", iso), iso)

    def postprocess_batch(self, sentences, lang="hin_Deva", visualize=False, num_return_sequences=1):
        maps = [self._maps.get() for _ in range(len(sentences) // num_return_sequences)]
        results = [self._postprocess(sentence, lang, maps[i // num_return_sequences]) for i, sentence in enumerate(sentences)]
        self._maps.queue.clear()
        return results


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------

loaded = {}
load_lock = threading.Lock()
translate_lock = threading.Lock()
settings = argparse.Namespace(beams=4, cpu=False, use_cache=True)


def available(direction):
    """Whether the model for a direction is already on this computer."""
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(MODELS[direction], local_files_only=True)
        return True
    except Exception:
        return False


def load(direction):
    with load_lock:
        if direction not in loaded:
            import torch
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

            device = "cuda" if torch.cuda.is_available() and not settings.cpu else "cpu"
            name = MODELS[direction]
            say(f"Loading {name} on {device}...")
            tokenizer = AutoTokenizer.from_pretrained(name, trust_remote_code=True)
            model = AutoModelForSeq2SeqLM.from_pretrained(name, trust_remote_code=True).to(device).eval()
            loaded[direction] = (tokenizer, model, PurePythonProcessor(inference=True), device)
        return loaded[direction]


def generate(model, inputs):
    import torch

    with torch.inference_mode():
        if settings.use_cache:
            try:
                return model.generate(**inputs, num_beams=settings.beams, num_return_sequences=1, max_length=256)
            except Exception as error:  # some transformers releases break the models' cached decoding
                say(f"Decoding with the cache failed ({type(error).__name__}: {error}); continuing without it.")
                settings.use_cache = False
        return model.generate(**inputs, num_beams=settings.beams, num_return_sequences=1, max_length=256, use_cache=False)


def translate(lines, src, tgt):
    if not lines or src == tgt:
        return list(lines)
    if src != "eng_Latn" and tgt != "eng_Latn":
        return translate(translate(lines, src, "eng_Latn"), "eng_Latn", tgt)
    tokenizer, model, processor, device = load("en-indic" if src == "eng_Latn" else "indic-en")
    out = []
    with translate_lock:
        for start in range(0, len(lines), 16):
            batch = processor.preprocess_batch(list(lines[start:start + 16]), src_lang=src, tgt_lang=tgt)
            inputs = tokenizer(batch, truncation=True, padding="longest", max_length=256, return_tensors="pt", return_attention_mask=True).to(device)
            decoded = tokenizer.batch_decode(generate(model, inputs), skip_special_tokens=True, clean_up_tokenization_spaces=True)
            out.extend(processor.postprocess_batch(decoded, lang=tgt))
    return out


def download(directions):
    """Fetches the models (weights once, not in two formats).  Exit code 3: a model needs a token."""
    from huggingface_hub import HfApi, snapshot_download

    api = HfApi()
    plans = []
    for direction in directions:
        name = MODELS[direction]
        files = [(s.rfilename, s.size or 0) for s in api.model_info(name, files_metadata=True).siblings]
        safetensors = any(f.endswith(".safetensors") for f, _ in files)
        ignore = ["*.md", "*.png", "*.jpg", ".gitattributes"] + (["*.bin"] if safetensors else [])
        wanted = [(f, size) for f, size in files if not any(std_re.fullmatch(p.replace(".", r"\.").replace("*", ".*"), f) for p in ignore)]
        plans.append((direction, name, ignore, sum(size for _, size in wanted)))
    say(f"@@total {sum(size for *_, size in plans)}")
    gated = False
    for direction, name, ignore, _ in plans:
        say(f"@@model {direction} {name}")
        try:
            snapshot_download(name, ignore_patterns=ignore)
            say(f"@@ok {direction}")
        except Exception as error:
            if type(error).__name__ in ("GatedRepoError", "RepositoryNotFoundError") or "401" in str(error) or "403" in str(error):
                gated = True
                say(f"@@gated {direction} {name} needs a Hugging Face token from an account that accepted its terms.")
            else:
                raise
    return 3 if gated else 0


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

def code_for(text, fallback):
    if not text:
        return fallback
    text = text.strip()
    if std_re.fullmatch(r"[a-z]{3}_[A-Z][a-z]{3}", text):
        return text
    return NAMES.get(text.lower(), fallback)


def request_lines(body):
    """The lines and languages of a request from Benchtop (or any chat client using its wording)."""
    extra = body.get("benchtop") or {}
    if extra.get("lines") is not None:
        return list(extra["lines"]), code_for(extra.get("from"), "eng_Latn"), code_for(extra.get("to"), "hin_Deva")
    messages = body.get("messages") or []
    system = " ".join(m.get("content", "") for m in messages if m.get("role") == "system")
    user = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
    found = std_re.search(r"from (\w+) into (\w+)", system)
    src = code_for(found.group(1), "eng_Latn") if found else "eng_Latn"
    tgt = code_for(found.group(2), "hin_Deva") if found else "hin_Deva"
    array = std_re.search(r"\[[\s\S]*\]", user)
    lines = json.loads(array.group(0)) if array else [user]
    return lines, src, tgt


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.rstrip("/")
        if path in ("/v1/models", "/api/tags"):
            self.reply(200, {"object": "list", "data": [{"id": "indictrans2", "object": "model"}]})
        elif path == "/health":
            self.reply(200, {"status": "ok", "loaded": sorted(loaded)})
        else:
            self.reply(200, {"status": "IndicTrans2 server for Benchtop. POST /v1/chat/completions"})

    def do_POST(self):
        if self.path.rstrip("/") not in ("/v1/chat/completions", "/api/chat"):
            self.reply(404, {"error": {"message": "Use /v1/chat/completions"}})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            lines, src, tgt = request_lines(body)
            result = translate([str(line) for line in lines], src, tgt)
            content = json.dumps(result, ensure_ascii=False)
            self.reply(200, {
                "object": "chat.completion",
                "model": "indictrans2",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
                "message": {"role": "assistant", "content": content},
            })
        except Exception as error:  # report every failure to the client
            self.reply(500, {"error": {"message": f"{type(error).__name__}: {error}"}})

    def log_message(self, fmt, *args):
        say(f"{self.address_string()} {fmt % args}")


def exit_with_stdin():
    """Stops the server when the program that started it goes away (its end of the pipe closes)."""
    def watch():
        try:
            while sys.stdin.buffer.read(1024):
                pass
        except Exception:
            pass
        os._exit(0)

    threading.Thread(target=watch, daemon=True).start()


def main(argv=None):
    parser = argparse.ArgumentParser(description="IndicTrans2 translation server for Benchtop")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8800)
    parser.add_argument("--beams", type=int, default=4)
    parser.add_argument("--cpu", action="store_true", help="do not use a GPU")
    parser.add_argument("--preload", action="store_true", help="load the downloaded models before answering")
    parser.add_argument("--download", nargs="?", const="en-indic,indic-en", help="fetch the models and exit")
    parser.add_argument("--exit-with-stdin", action="store_true", help="stop when standard input closes")
    args = parser.parse_args(argv)
    settings.beams = max(1, args.beams)
    settings.cpu = args.cpu
    if args.download:
        directions = [d.strip() for d in args.download.split(",") if d.strip()]
        unknown = [d for d in directions if d not in MODELS]
        if unknown:
            parser.error(f"unknown direction {', '.join(unknown)}; use en-indic and/or indic-en")
        return download(directions)
    if args.exit_with_stdin:
        exit_with_stdin()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    port = server.server_address[1]
    say(f"IndicTrans2 server on http://{args.host}:{port}/v1/chat/completions")
    say(f"@@listening {port}")
    if args.preload:
        for direction in MODELS:
            if available(direction):
                load(direction)
            else:
                say(f"@@missing {direction}")
    say("@@ready")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
