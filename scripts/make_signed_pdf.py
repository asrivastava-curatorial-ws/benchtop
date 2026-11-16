"""Build small signed PDFs for the pdf-signature unit tests with OpenSSL CMS signatures.

Usage: python3 -I make_signed_pdf.py <work dir> <fixtures dir>
Writes signed-rsa.pdf, signed-ec.pdf, tampered.pdf and appended.pdf to the fixtures dir.
"""
import subprocess
import sys
from pathlib import Path

PLACEHOLDER = 8192  # hex digits reserved for the CMS blob


def run(*args):
    subprocess.run(args, check=True, capture_output=True)


def make_key(work: Path, kind: str):
    key = work / f"{kind}-key.pem"
    cert = work / f"{kind}-cert.pem"
    subject = f"/CN=Benchtop Test Signer ({kind.upper()})/O=Benchtop/C=IN"
    if kind == "rsa":
        run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-subj", subject, "-days", "3650", "-sha256", "-out", str(cert))
    else:
        run("openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(key))
        run("openssl", "req", "-x509", "-key", str(key), "-subj", subject, "-days", "3650", "-sha256", "-out", str(cert))
    return key, cert


def build_pdf(name: str) -> bytes:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] /SigFlags 3 >> >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >>",
        b"<< /Type /Annot /Subtype /Widget /FT /Sig /Rect [0 0 0 0] /F 132 /T (Signature1) /P 3 0 R /V 5 0 R >>",
        (
            b"<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (" + name.encode() + b")"
            b" /Reason (Unit test) /Location (Bengaluru) /M (D:20261116093000+05'30')"
            b" /ByteRange [0000000000 0000000000 0000000000 0000000000] /Contents <" + b"0" * PLACEHOLDER + b"> >>"
        ),
    ]
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def sign(work: Path, kind: str, key: Path, cert: Path) -> bytes:
    pdf = bytearray(build_pdf(f"Benchtop Test Signer ({kind.upper()})"))
    start = pdf.index(b"/Contents <") + len(b"/Contents ")
    end = start + PLACEHOLDER + 2  # includes < and >
    ranges = [0, start, end, len(pdf) - end]
    marker = b"[0000000000 0000000000 0000000000 0000000000]"
    filled = ("[" + " ".join(f"{value:010d}" for value in ranges) + "]").encode()
    position = pdf.index(marker)
    pdf[position : position + len(marker)] = filled
    signed = bytes(pdf[0:start]) + bytes(pdf[end:])
    data = work / f"{kind}-data.bin"
    data.write_bytes(signed)
    blob = work / f"{kind}.p7s"
    run(
        "openssl", "cms", "-sign", "-binary", "-in", str(data), "-signer", str(cert), "-inkey", str(key),
        "-md", "sha256", "-outform", "DER", "-out", str(blob), "-nosmimecap",
    )
    contents = blob.read_bytes().hex().encode()
    assert len(contents) <= PLACEHOLDER, len(contents)
    pdf[start + 1 : start + 1 + len(contents)] = contents
    return bytes(pdf)


def main():
    work = Path(sys.argv[1])
    fixtures = Path(sys.argv[2])
    work.mkdir(parents=True, exist_ok=True)
    fixtures.mkdir(parents=True, exist_ok=True)
    rsa = sign(work, "rsa", *make_key(work, "rsa"))
    ec = sign(work, "ec", *make_key(work, "ec"))
    (fixtures / "signed-rsa.pdf").write_bytes(rsa)
    (fixtures / "signed-ec.pdf").write_bytes(ec)
    tampered = bytearray(rsa)
    spot = tampered.index(b"(Unit test)") + 1
    tampered[spot] = ord("u")  # "unit test": a change inside the signed bytes
    (fixtures / "tampered.pdf").write_bytes(bytes(tampered))
    appended = rsa + b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n%%EOF\n"
    (fixtures / "appended.pdf").write_bytes(appended)
    for name in ("signed-rsa.pdf", "signed-ec.pdf", "tampered.pdf", "appended.pdf"):
        print(name, (fixtures / name).stat().st_size)


if __name__ == "__main__":
    main()
