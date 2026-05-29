#!/usr/bin/env python3
"""
chat-oshc KB Build Script
Extract text from PDS PDFs + FAQ JSON, chunk, embed via DashScope, output ndjson for Vectorize.

Usage:
  pip install pymupdf dashscope
  export DASHSCOPE_API_KEY=...
  python scripts/build_kb.py --dry-run      # extract + chunk only
  python scripts/build_kb.py                 # full: extract → chunk → embed → ndjson
  python scripts/build_kb.py --embed-only     # embed existing chunks.json
"""

import argparse
import json
import os
import sys
import time

NDJSON_PATH = "chunks.ndjson"
CHUNKS_JSON = "chunks.json"

# Paths relative to chat-oshc repo root
PDS_DIR = "../../cowork/state/chat-oshc-kb-raw/pds"
FAQ_PATH = "../../cowork/state/chat-oshc-kb-raw/faq/oshc-faq-30.json"

DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
EMBEDDING_MODEL = "text-embedding-v3"
BATCH_SIZE = 25
RATE_LIMIT_DELAY = 0.5


def extract_pdf_text(pdf_path: str) -> str:
    """Extract text from a PDF using pymupdf, falling back to pdftotext."""
    try:
        import fitz  # pymupdf
    except ImportError:
        import subprocess
        print(f"  [WARN] pymupdf missing; trying pdftotext fallback", file=sys.stderr)
        result = subprocess.run(
            ["pdftotext", "-layout", pdf_path, "-"],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(f"  [ERROR] pdftotext failed: {result.stderr}", file=sys.stderr)
            return ""
        return result.stdout

    doc = fitz.open(pdf_path)
    parts: list[str] = []
    for page in doc:
        parts.append(str(page.get_text()))
    doc.close()
    return "\n".join(parts)


def chunk_text(text: str, chunk_size: int = 400, overlap: int = 50) -> list[str]:
    """Split text into overlapping segments of ~chunk_size chars."""
    if not text.strip():
        return []
    chunks: list[str] = []
    start = 0
    text_len = len(text)
    while start < text_len:
        end = min(start + chunk_size, text_len)
        # Try to break at a natural boundary
        if end < text_len:
            for sep in [".\n", ". ", "\n\n", "\n", "。", "；", " "]:
                idx = text.rfind(sep, start, end)
                if idx > start + chunk_size // 2:
                    end = idx + len(sep)
                    break
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end - overlap if end < text_len else text_len
    return chunks


def detect_provider(filename: str) -> str:
    """Detect provider name from PDF filename."""
    fname = filename.lower()
    for p in ["nib", "allianz", "ahm", "bupa", "medibank"]:
        if p in fname:
            return p.capitalize() if p != "ahm" else "AHM"
    return "generic"


def detect_doc_type(filename: str) -> str:
    """Detect document type from PDF filename."""
    fname = filename.lower()
    if "faq" in fname:
        return "faq"
    if "fund-rules" in fname or "fund_rules" in fname:
        return "fund_rules"
    if "simple-guide" in fname or "simple_guide" in fname:
        return "guide"
    if "cover-summary" in fname or "cover_summary" in fname:
        return "cover_summary"
    if "essentials" in fname:
        return "pds_essentials"
    if "standard" in fname:
        return "pds_standard"
    if "fact-sheet" in fname or "fact_sheet" in fname:
        return "fact_sheet"
    return "pds"


def build_chunks() -> list[dict]:
    """Extract text from all sources and build chunk list."""
    all_chunks: list[dict] = []

    # ── PDS PDFs ──
    if os.path.isdir(PDS_DIR):
        pdf_files = sorted([f for f in os.listdir(PDS_DIR) if f.endswith(".pdf")])
        print(f"[chunk] Found {len(pdf_files)} PDF(s) in {PDS_DIR}")
        for pdf_file in pdf_files:
            pdf_path = os.path.join(PDS_DIR, pdf_file)
            print(f"  Extracting: {pdf_file} ...", end=" ", flush=True)
            text = extract_pdf_text(pdf_path)
            if not text:
                print("(empty — skipped)")
                continue

            provider = detect_provider(pdf_file)
            doc_type = detect_doc_type(pdf_file)

            sub_chunks = chunk_text(text)
            for i, c in enumerate(sub_chunks):
                all_chunks.append({
                    "id": f"{pdf_file.replace('.pdf', '')}-{i:03d}",
                    "text": c,
                    "metadata": {
                        "provider": provider,
                        "doc_type": doc_type,
                        "source": pdf_file,
                        "year": "2026",
                        "lang": "en",
                    },
                })
            print(f"{len(sub_chunks)} chunks")
    else:
        print(f"[chunk] PDS dir not found: {PDS_DIR}")

    # ── FAQ JSON ──
    if os.path.isfile(FAQ_PATH):
        with open(FAQ_PATH, "r") as f:
            faqs = json.load(f)
        print(f"[chunk] Found {len(faqs)} FAQ(s) in {FAQ_PATH}")
        for i, faq in enumerate(faqs):
            text = f"Q: {faq['q']}\nA: {faq['a']}"
            all_chunks.append({
                "id": f"faq-{i:03d}",
                "text": text,
                "metadata": {
                    "provider": "generic",
                    "doc_type": "faq",
                    "source": faq.get("source", "unknown"),
                    "year": "2026",
                    "lang": faq.get("lang", "zh-CN"),
                },
            })
        print(f"    → {len(faqs)} FAQ chunks")
    else:
        print(f"[chunk] FAQ file not found: {FAQ_PATH}")

    return all_chunks


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Call DashScope text-embedding-v3 for a batch of texts."""
    if not DASHSCOPE_API_KEY:
        raise RuntimeError("DASHSCOPE_API_KEY not set")

    import urllib.request
    import urllib.error

    url = "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings"
    payload = json.dumps({"model": EMBEDDING_MODEL, "input": texts}).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
    })

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
            return [item["embedding"] for item in data.get("data", [])]
        except urllib.error.HTTPError as e:
            err_body = e.read().decode()[:500]
            print(f"\n  [ERROR] DashScope HTTP {e.code}: {err_body}", file=sys.stderr)
            if attempt < 2:
                wait = (attempt + 1) * 3
                print(f"  Retrying in {wait}s...", file=sys.stderr)
                time.sleep(wait)
            else:
                raise
        except Exception as e:
            print(f"\n  [ERROR] {e}", file=sys.stderr)
            if attempt < 2:
                wait = (attempt + 1) * 3
                print(f"  Retrying in {wait}s...", file=sys.stderr)
                time.sleep(wait)
            else:
                raise
    return []


def main() -> None:
    parser = argparse.ArgumentParser(description="Build OSHC KB chunks + embeddings")
    parser.add_argument("--dry-run", action="store_true", help="Extract+chunk only")
    parser.add_argument("--embed-only", action="store_true", help="Embed existing chunks.json")
    args = parser.parse_args()

    if args.embed_only:
        if not os.path.isfile(CHUNKS_JSON):
            print(f"ERROR: {CHUNKS_JSON} not found.", file=sys.stderr)
            sys.exit(1)
        with open(CHUNKS_JSON, "r") as f:
            chunks = json.load(f)
        print(f"[embed] Loaded {len(chunks)} chunks from {CHUNKS_JSON}")
    else:
        chunks = build_chunks()
        with open(CHUNKS_JSON, "w") as f:
            json.dump(chunks, f, ensure_ascii=False, indent=2)
        print(f"[chunk] Saved {len(chunks)} chunks to {CHUNKS_JSON}")

    print(f"[info] Total chunks: {len(chunks)}")

    if args.dry_run:
        print("[dry-run] Skipping embedding.")
        for c in chunks[:5]:
            print(f"  [{c['id']}] {c['metadata']['provider']}/{c['metadata']['doc_type']}: {c['text'][:80]}...")
        return

    if not DASHSCOPE_API_KEY:
        print("ERROR: DASHSCOPE_API_KEY not set.", file=sys.stderr)
        sys.exit(1)

    total_batches = (len(chunks) + BATCH_SIZE - 1) // BATCH_SIZE
    print(f"[embed] Embedding {len(chunks)} chunks via {EMBEDDING_MODEL} (batch={BATCH_SIZE})...")

    ndjson_lines: list[str] = []
    for i in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[i:i + BATCH_SIZE]
        texts = [c["text"] for c in batch]
        batch_num = (i // BATCH_SIZE) + 1
        print(f"  Batch {batch_num}/{total_batches}: {len(texts)} texts ...", end=" ", flush=True)
        try:
            embeddings = embed_batch(texts)
            print("OK")
        except Exception as e:
            print(f"FAILED: {e}")
            sys.exit(1)

        for j, emb in enumerate(embeddings):
            c = batch[j]
            ndjson_lines.append(json.dumps({
                "id": c["id"],
                "values": emb,
                "metadata": c["metadata"],
            }, ensure_ascii=False))

        if i + BATCH_SIZE < len(chunks):
            time.sleep(RATE_LIMIT_DELAY)

    with open(NDJSON_PATH, "w") as f:
        f.write("\n".join(ndjson_lines) + "\n")
    print(f"[embed] Done. {len(ndjson_lines)} vectors → {NDJSON_PATH}")
    print(f"[next] Run: npx wrangler vectorize insert kb-oshc --file {NDJSON_PATH}")


if __name__ == "__main__":
    main()
