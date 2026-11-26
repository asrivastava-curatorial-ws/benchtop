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

Other languages: the same server also runs translation models for many
languages, chosen by the request's "model": m2m100-418m (M2M-100, 100
languages, MIT), nllb-200-600m (NLLB-200, 200 languages, CC BY-NC 4.0),
madlad400-3b (MADLAD-400, over 400 languages, Apache 2.0), or any Hugging Face
Marian (Opus-MT), M2M-100, NLLB, mBART-50 or MADLAD model as "hf:owner/name".
Fetch them with --download m2m100-418m,hf:Helsinki-NLP/opus-mt-en-ar.  Code
that comes with a model is never run: only kinds Transformers knows are loaded.

Options: --port N (0 picks a free port), --host ADDRESS, --beams N (default 4),
--cpu, --preload (load the downloaded models before answering), --download
[en-indic,indic-en,...] (fetch the models and exit), --exit-with-stdin (stop when
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

# Models for many languages, fetched by these names; any other Hugging Face model
# is asked for as "hf:owner/name".
EXTRA = {
    "m2m100-418m": "facebook/m2m100_418M",
    "nllb-200-600m": "facebook/nllb-200-distilled-600M",
    "madlad400-3b": "google/madlad400-3b-mt",
}
REPO_RE = std_re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}")


def repo_for(key):
    """The Hugging Face repository for a model name Benchtop uses."""
    if key in MODELS:
        return MODELS[key]
    if key in EXTRA:
        return EXTRA[key]
    if key.startswith("hf:") and REPO_RE.fullmatch(key[3:]) and ".." not in key:
        return key[3:]
    raise ValueError(f"unknown model {key}; use en-indic, indic-en, {', '.join(EXTRA)} or hf:owner/name")


def other_model(key):
    """Whether a request's model is one of the many-language models (rather than IndicTrans2)."""
    return key in EXTRA or (key.startswith("hf:") and REPO_RE.fullmatch(key[3:]) is not None)


# FLORES-200 codes -> the two-letter codes M2M-100, mBART-50 and MADLAD use.
ISO_639_1 = {
    "eng_Latn": "en", "hin_Deva": "hi", "kan_Knda": "kn", "tam_Taml": "ta", "tel_Telu": "te",
    "mal_Mlym": "ml", "ben_Beng": "bn", "mar_Deva": "mr", "guj_Gujr": "gu", "pan_Guru": "pa",
    "ory_Orya": "or", "asm_Beng": "as", "urd_Arab": "ur", "npi_Deva": "ne", "san_Deva": "sa",
    "snd_Arab": "sd", "fra_Latn": "fr", "deu_Latn": "de", "spa_Latn": "es", "jpn_Jpan": "ja",
    "zho_Hans": "zh", "zho_Hant": "zh", "arb_Arab": "ar", "rus_Cyrl": "ru", "kor_Hang": "ko",
    "por_Latn": "pt", "ita_Latn": "it", "tur_Latn": "tr", "pes_Arab": "fa", "tha_Thai": "th",
    "vie_Latn": "vi", "ind_Latn": "id", "zsm_Latn": "ms", "heb_Hebr": "he", "swh_Latn": "sw",
    "ukr_Cyrl": "uk", "pol_Latn": "pl", "nld_Latn": "nl", "ell_Grek": "el", "sin_Sinh": "si",
    "mya_Mymr": "my", "khm_Khmr": "km", "bod_Tibt": "bo",
}
# Two-letter codes -> mBART-50's language codes.
MBART = {
    "en": "en_XX", "ar": "ar_AR", "zh": "zh_CN", "ja": "ja_XX", "ru": "ru_RU", "fr": "fr_XX",
    "de": "de_DE", "es": "es_XX", "hi": "hi_IN", "bn": "bn_IN", "gu": "gu_IN", "ml": "ml_IN",
    "mr": "mr_IN", "ta": "ta_IN", "te": "te_IN", "ur": "ur_PK", "ne": "ne_NP", "si": "si_LK",
    "my": "my_MM", "km": "km_KH", "ko": "ko_KR", "pt": "pt_XX", "it": "it_IT", "tr": "tr_TR",
    "fa": "fa_IR", "th": "th_TH", "vi": "vi_VN", "id": "id_ID", "he": "he_IL", "sw": "sw_KE",
    "uk": "uk_UA", "pl": "pl_PL", "nl": "nl_XX",
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

        snapshot_download(repo_for(direction), local_files_only=True)
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


def family_of(name, config):
    """How to ask a model for a language, from the kind of model it is."""
    kind = getattr(config, "model_type", "") or ""
    if kind == "marian":
        return "marian"
    if kind in ("t5", "mt5"):
        return "madlad"
    if kind == "mbart":
        return "mbart"
    if kind == "m2m_100":
        return "nllb" if "nllb" in name.lower() else "m2m"
    raise ValueError(f"{name} is a {kind or 'model of an unknown kind'}: Benchtop translates with Marian (Opus-MT), M2M-100, NLLB, mBART-50 and MADLAD models.")


def load_other(key):
    with load_lock:
        if key not in loaded:
            import torch
            from transformers import AutoConfig, AutoModelForSeq2SeqLM, AutoTokenizer

            name = repo_for(key)
            device = "cuda" if torch.cuda.is_available() and not settings.cpu else "cpu"
            # One many-language model in memory at a time (they are large); IndicTrans2 stays.
            for other in [k for k in loaded if other_model(k)]:
                say(f"Unloading {repo_for(other)}")
                del loaded[other]
            say(f"Loading {name} on {device}...")
            # Code that comes with a model is never run: only kinds Transformers knows.
            config = AutoConfig.from_pretrained(name, trust_remote_code=False)
            family = family_of(name, config)
            tokenizer = AutoTokenizer.from_pretrained(name, trust_remote_code=False)
            model = AutoModelForSeq2SeqLM.from_pretrained(name, trust_remote_code=False).to(device).eval()
            loaded[key] = (family, tokenizer, model, device, name)
        return loaded[key]


def two_letter(code, name):
    found = ISO_639_1.get(code)
    if not found:
        raise ValueError(f"{name} has no code for the language {code}")
    return found


def language_token(tokenizer, code, name):
    token = tokenizer.convert_tokens_to_ids(code)
    if token is None or token == tokenizer.unk_token_id:
        raise ValueError(f"{name} does not know the language {code}")
    return token


def translate_other(key, lines, src, tgt):
    """Translates with one of the many-language models (or a Marian pair model)."""
    if not lines or src == tgt:
        return list(lines)
    import torch

    family, tokenizer, model, device, name = load_other(key)
    out = []
    with translate_lock:
        for start in range(0, len(lines), 8):
            batch = list(lines[start:start + 8])
            options = {}
            if family == "nllb":
                language_token(tokenizer, src, name)
                tokenizer.src_lang = src
                options["forced_bos_token_id"] = language_token(tokenizer, tgt, name)
            elif family == "mbart":
                pair = MBART.get(two_letter(src, name)), MBART.get(two_letter(tgt, name))
                if None in pair:
                    raise ValueError(f"mBART-50 does not know {src if pair[0] is None else tgt}")
                tokenizer.src_lang = pair[0]
                options["forced_bos_token_id"] = language_token(tokenizer, pair[1], name)
            elif family == "m2m":
                try:
                    tokenizer.src_lang = two_letter(src, name)
                    options["forced_bos_token_id"] = tokenizer.get_lang_id(two_letter(tgt, name))
                except KeyError:
                    raise ValueError(f"M2M-100 does not know {src} or {tgt}") from None
            elif family == "madlad":
                batch = [f"<2{two_letter(tgt, name)}> {line}" for line in batch]
            elif family == "marian":
                codes = list(getattr(tokenizer, "supported_language_codes", None) or [])
                if codes:
                    wanted = [f">>{tgt.split('_')[0]}<<", f">>{ISO_639_1.get(tgt, '')}<<", f">>{tgt}<<"]
                    tag = next((c for c in wanted if c in codes), None)
                    if not tag:
                        raise ValueError(f"{name} cannot write {tgt}")
                    batch = [f"{tag} {line}" for line in batch]
            inputs = tokenizer(batch, return_tensors="pt", padding=True, truncation=True, max_length=512).to(device)
            with torch.inference_mode():
                tokens = model.generate(**inputs, num_beams=settings.beams, max_length=512, **options)
            out.extend(tokenizer.batch_decode(tokens, skip_special_tokens=True))
    return out


def installed_models():
    """Every model on this computer, by the name a request uses."""
    names = ["indictrans2"] if any(available(d) for d in MODELS) else []
    names += [key for key in EXTRA if available(key)]
    try:
        from huggingface_hub import scan_cache_dir

        known = set(MODELS.values()) | set(EXTRA.values())
        names += sorted(f"hf:{repo.repo_id}" for repo in scan_cache_dir().repos if repo.repo_type == "model" and repo.repo_id not in known)
    except Exception:
        pass
    return names


def download(directions):
    """Fetches the models (weights once, not in two formats).  Exit code 3: a model needs a token."""
    from huggingface_hub import HfApi, snapshot_download

    api = HfApi()
    plans = []
    for direction in directions:
        name = repo_for(direction)
        files = [(s.rfilename, s.size or 0) for s in api.model_info(name, files_metadata=True).siblings]
        safetensors = any(f.endswith(".safetensors") for f, _ in files)
        # Only the PyTorch weights, once: not the TensorFlow, Flax, Rust, ONNX or GGUF copies.
        ignore = ["*.md", "*.png", "*.jpg", ".gitattributes", "*.h5", "*.msgpack", "*.ot", "*.gguf", "*.onnx", "onnx/*", "*.tflite"] + (["*.bin"] if safetensors else [])
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
            if type(error).__name__ == "RepositoryNotFoundError" and direction.startswith("hf:"):
                gated = True
                say(f"@@gated {direction} {name} is not on Hugging Face (check the name), or it is private and needs a token.")
            elif type(error).__name__ in ("GatedRepoError", "RepositoryNotFoundError") or "401" in str(error) or "403" in str(error):
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
            self.reply(200, {"object": "list", "data": [{"id": name, "object": "model"} for name in installed_models()]})
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
            asked = str(body.get("model") or "")
            texts = [str(line) for line in lines]
            result = translate_other(asked, texts, src, tgt) if other_model(asked) else translate(texts, src, tgt)
            content = json.dumps(result, ensure_ascii=False)
            self.reply(200, {
                "object": "chat.completion",
                "model": asked if other_model(asked) else "indictrans2",
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
        for direction in directions:
            try:
                repo_for(direction)
            except ValueError as error:
                parser.error(str(error))
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
