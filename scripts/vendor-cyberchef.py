#!/usr/bin/env python3
"""Copies the CyberChef operations that Benchtop's Recipe tool runs as they are
(the rarer ones: GOST, SM2, Ascon, Typex, Bombe, Lorenz, YARA, disassemblers…)
with the CyberChef modules they import, from the CyberChef repository on GitHub
(Apache-2.0).  Operation.mjs is replaced by Benchtop's own small base class.

Usage: python3 scripts/vendor-cyberchef.py [commit-or-branch]
"""
import os, re, sys, urllib.request

REF = sys.argv[1] if len(sys.argv) > 1 else 'master'
BASE = f'https://raw.githubusercontent.com/gchq/CyberChef/{REF}/src/core/'
ROOT = os.path.join(os.path.dirname(__file__), '..', 'src', 'recipe', 'vendor', 'cyberchef')
OPS = '''AsconDecrypt AsconEncrypt AsconHash AsconMAC BSONDeserialise BSONSerialise Bombe Bzip2Compress CTPH Colossus
CompareCTPHHashes CompareSSDEEPHashes DisassembleARM DisassembleX86 ExtractAudioMetadata GOSTDecrypt GOSTEncrypt GOSTHash
GOSTKeyUnwrap GOSTKeyWrap GOSTSign GOSTVerify HAS160 JA4Fingerprint JA4ServerFingerprint JavaScriptParser Jsonata
LS47Decrypt LS47Encrypt LZMACompress LZMADecompress Lorenz MD2 MD6 MicrosoftScriptDecoder MultipleBombe Numberwang
PLISTViewer PRESENTDecrypt PRESENTEncrypt ParseX509CRL RC2Decrypt RC2Encrypt RC6Decrypt RC6Encrypt ROR13
SIGABA SM2Decrypt SM2Encrypt SM4Decrypt SM4Encrypt SSDEEP Snefru Streebog SyntaxHighlighter TwofishDecrypt TwofishEncrypt
Typex XKCDRandomNumber XPRESSDecompress XPRESSHuffmanDecompress AMFDecode AMFEncode
YARARules ConvertCoordinateFormat'''.split()
# Protobuf Encode needs protobufjs code generation, which the app's security policy forbids;
# Benchtop has its own encoder instead.
# Provided by Benchtop instead of fetched.
OWN = {'Operation.mjs'}

seen, external = set(), set()

def fetch(path):
    path = os.path.normpath(path).replace(os.sep, '/')
    if path in seen or os.path.basename(path) in OWN:
        return
    seen.add(path)
    with urllib.request.urlopen(BASE + path) as response:
        text = response.read().decode('utf-8')
    target = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'w', encoding='utf-8') as out:
        out.write(text)
    for spec in re.findall(r'''(?:^|\n)\s*import\s[^;]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']''', text):
        name = spec[0] or spec[1]
        if name.startswith('.'):
            fetch(os.path.join(os.path.dirname(path), name))
        else:
            external.add(name)

for op in OPS:
    fetch(f'operations/{op}.mjs')

# Browser fixes: the GOST code imports Node's crypto module only for its Web Crypto object.
for name in ('gostRandom.mjs', 'gostCipher.mjs', 'gostDigest.mjs'):
    path = os.path.join(ROOT, 'vendor', 'gost', name)
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            text = f.read()
        text = re.sub(r"import crypto from ['\"]crypto['\"];?", 'const crypto = globalThis.crypto;', text)
        # They also reassign an imported binding, which ES modules forbid.
        text = re.sub(r"import GostRandom from (['\"]\./gostRandom\.mjs['\"]);?", r"import GostRandomModule from \1;\nlet GostRandom = GostRandomModule;", text)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)

# YARA: libyara-wasm (ISC; YARA itself is BSD-3-Clause) is an Emscripten build whose
# glue creates functions with `new Function`, which the app's security policy
# forbids.  Copy it from node_modules as an ES module with those two helpers
# rewritten as closures (the same behaviour Emscripten emits when built with
# DYNAMIC_EXECUTION=0), and point CyberChef's YARA operation at the copy.
NODE_MODULES = os.path.join(os.path.dirname(__file__), '..', 'node_modules')
with open(os.path.join(NODE_MODULES, 'libyara-wasm', 'dist', 'libyara-wasm.js'), encoding='utf-8') as f:
    glue = f.read()

def patch(text, pattern, replacement, flags=0):
    patched, count = re.subn(pattern, lambda _: replacement, text, flags=flags)
    if count != 1:
        raise SystemExit(f'libyara-wasm: expected one match for {pattern[:60]!r}, found {count}')
    return patched

# createNamedFunction: a named function without eval.
glue = patch(glue, r'function Sa\(a,b\)\{a=Ra\(a\);return\(new Function\(.*?\)\)\(b\)\}',
             'function Sa(a,b){a=Ra(a);var o={[a]:function(){"use strict";return b.apply(this,arguments)}};return o[a]}', re.S)
# craftInvokerFunction: the generated invoker, as a closure.
glue = patch(glue, r'function Ab\(a,b,c,d,f\)\{.*?return zb\(n\)\.apply\(null,d\)\}',
             'function Ab(a,b,c,d,f){var g=b.length;2>g&&Q("argTypes array size mismatch! Must at least get return value and \'this\' types!");'
             'var l=null!==b[1]&&null!==c,k=!1;for(var i=1;i<b.length;++i)if(null!==b[i]&&void 0===b[i].ab){k=!0;break}var m="void"!==b[0].name;'
             'return function(){arguments.length!==g-2&&Q("function "+a+" called with "+arguments.length+" arguments, expected "+(g-2)+" args!");'
             'var h=k?[]:null,w=[],tw;l&&(tw=b[1].toWireType(h,this),w.push(tw));for(var j=0;j<g-2;++j)w.push(b[j+2].toWireType(h,arguments[j]));'
             'var rv=d.apply(null,[f].concat(w));if(k)Oa(h);else for(var c2=l?1:2;c2<b.length;++c2){var x=1===c2?tw:w[l?c2-1:c2-2];null!==b[c2].ab&&b[c2].ab(x)}'
             'if(m)return b[0].fromWireType(rv)}}', re.S)
# Never take the Node.js branch (it would require "fs" and "path").
glue = patch(glue, r'fa="object"==typeof process&&"object"==typeof process\.versions&&"string"==typeof process\.versions\.node', 'fa=!1')
glue = patch(glue, r"if \(typeof exports === 'object' && typeof module === 'object'\)\s*module\.exports = Module;.*$", 'export default Module;\n', re.S)
if 'new Function' in glue or 'eval(' in glue:
    raise SystemExit('libyara-wasm: dynamic code is still present')
target = os.path.join(ROOT, '..', 'libyara-wasm')
os.makedirs(target, exist_ok=True)
with open(os.path.join(target, 'libyara-wasm.mjs'), 'w', encoding='utf-8') as f:
    f.write('// libyara-wasm 1.2.1 (ISC, Matt Coomber; YARA is BSD-3-Clause), patched by scripts/vendor-cyberchef.py.\n' + glue)
yara = os.path.join(ROOT, 'operations', 'YARARules.mjs')
with open(yara, encoding='utf-8') as f:
    text = f.read()
text = patch(text, r'import Yara from "libyara-wasm";', 'import Yara from "../../libyara-wasm/libyara-wasm.mjs";')
with open(yara, 'w', encoding='utf-8') as f:
    f.write(text)
external.discard('libyara-wasm')

# Benchtop's source check rejects invisible characters (Trojan Source); CyberChef's
# comments and tables hold a few, so write them as escapes, which mean the same in JS.
INVISIBLE = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\xa0\xad\u061c\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff\ufff9-\ufffd]')
for directory, _, files in os.walk(os.path.join(ROOT, '..')):
    for name in files:
        if not name.endswith('.mjs'):
            continue
        path = os.path.join(directory, name)
        with open(path, encoding='utf-8') as f:
            text = f.read()
        escaped = INVISIBLE.sub(lambda m: '\\u%04X' % ord(m.group()), text)
        if escaped != text:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(escaped)

external.discard('crypto')
print(len(seen), 'files')
print('external:', ' '.join(sorted(external)))
