#!/usr/bin/env python3
"""Human- and agent-friendly storage plus a localhost bridge for Typora annotations."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from xml.etree import ElementTree


DEFAULT_ROOT = Path.home() / "Documents" / "typora"
DEFAULT_PORT = 17373
MAX_BODY = 2 * 1024 * 1024
LOCK = threading.RLock()


def now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def storage_root() -> Path:
    return Path(os.environ.get("TYPORA_ANNOTATIONS_HOME", DEFAULT_ROOT)).expanduser()


def normalize_document_path(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError("document path must be absolute")
    return Path(os.path.normpath(str(path)))


def annotation_path(document_path: str) -> Path:
    document = normalize_document_path(document_path)
    try:
        relative = document.relative_to(Path.home())
    except ValueError:
        relative = Path("_absolute") / str(document).lstrip("/")
    return storage_root() / "annotations" / Path(str(relative) + ".annotations.json")


def empty_document(document_path: str) -> dict:
    return {
        "version": 1,
        "documentId": str(uuid.uuid4()),
        "documentPath": str(normalize_document_path(document_path)),
        "annotations": [],
        "updatedAt": now(),
    }


def read_json(path: Path, fallback):
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return fallback


def atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name, suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def load_document(document_path: str) -> tuple[dict, Path]:
    normalized = str(normalize_document_path(document_path))
    path = annotation_path(normalized)
    with LOCK:
        data = read_json(path, empty_document(normalized))
    if not isinstance(data, dict) or not isinstance(data.get("annotations"), list):
        raise ValueError(f"invalid annotation file: {path}")
    data["documentPath"] = normalized
    data.setdefault("version", 1)
    data.setdefault("documentId", str(uuid.uuid4()))
    data.setdefault("updatedAt", now())
    return data, path


def update_index(data: dict, path: Path) -> None:
    root = storage_root()
    index_path = root / "index.json"
    index = read_json(index_path, {"version": 1, "documents": {}})
    if not isinstance(index, dict):
        index = {"version": 1, "documents": {}}
    documents = index.setdefault("documents", {})
    if data["annotations"]:
        documents[data["documentPath"]] = {
            "documentId": data["documentId"],
            "annotationFile": str(path.relative_to(root)),
            "annotationCount": len(data["annotations"]),
            "openCount": sum(1 for item in data["annotations"] if item.get("status", "open") != "resolved"),
            "updatedAt": data["updatedAt"],
        }
    else:
        documents.pop(data["documentPath"], None)
    index["updatedAt"] = now()
    atomic_write_json(index_path, index)


def scan_documents() -> dict:
    """Read authoritative annotation files without depending on the index cache."""
    root = storage_root()
    documents = {}
    with LOCK:
        for path in sorted((root / "annotations").rglob("*.annotations.json")):
            try:
                data = read_json(path, None)
                if not isinstance(data, dict) or not isinstance(data.get("annotations"), list):
                    continue
                items = data["annotations"]
                if not items or not isinstance(data.get("documentPath"), str):
                    continue
                documents[data["documentPath"]] = {
                    "documentId": data.get("documentId"),
                    "annotationFile": str(path.relative_to(root)),
                    "annotationCount": len(items),
                    "openCount": sum(1 for item in items if item.get("status", "open") != "resolved"),
                    "updatedAt": data.get("updatedAt"),
                }
            except (OSError, ValueError) as error:
                print(f"Could not list annotations in {path}: {error}", file=sys.stderr)
    return {"version": 1, "documents": documents}


def save_document(payload: dict) -> tuple[dict, Path]:
    if not isinstance(payload, dict):
        raise ValueError("request body must be a JSON object")
    document_path = str(normalize_document_path(str(payload.get("documentPath", ""))))
    annotations = payload.get("annotations")
    if not isinstance(annotations, list):
        raise ValueError("annotations must be an array")
    existing, path = load_document(document_path)
    data = {
        "version": 1,
        "documentId": str(payload.get("documentId") or existing.get("documentId") or uuid.uuid4()),
        "documentPath": document_path,
        "annotations": annotations,
        "updatedAt": now(),
    }
    with LOCK:
        if annotations:
            atomic_write_json(path, data)
        else:
            path.unlink(missing_ok=True)
        try:
            update_index(data, path)
        except (OSError, ValueError) as error:
            # The document is durable. An inaccessible/corrupt index cache must
            # not turn a successful save into an HTTP error for the editor.
            print(f"Annotation saved; index update failed: {error}", file=sys.stderr)
    return data, path


def response_document(data: dict, path: Path) -> dict:
    result = dict(data)
    result["annotationFile"] = str(path)
    result["storageExists"] = path.exists()
    return result


def read_referenced_svg(document_path: str, image_source: str) -> dict:
    """Only expose SVG files explicitly embedded in the requesting Markdown."""
    document = normalize_document_path(document_path)
    text = document.read_text(encoding="utf-8")
    sources = re.findall(r'!\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)', text)
    sources += re.findall(r'<img\b[^>]*\bsrc=[\"\']([^\"\']+)', text, re.I)

    def local_path(source):
        parsed = urlparse(source.strip("<>"))
        if parsed.scheme not in ("", "file") or parsed.netloc not in ("", "localhost"):
            return None
        path = Path(unquote(parsed.path))
        return (document.parent / path).resolve()

    requested = local_path(image_source)
    reference = next((source.strip("<>") for source in sources
                      if requested is not None and local_path(source) == requested), None)
    if reference is None or requested.suffix.lower() != ".svg":
        raise ValueError("SVG must be a local image embedded in this Markdown document")
    with requested.open("rb") as handle:
        content = handle.read(MAX_BODY + 1)
    if len(content) > MAX_BODY:
        raise ValueError("SVG exceeds the 2 MB limit")
    if re.search(br'<!\s*(?:DOCTYPE|ENTITY)\b', content, re.I):
        raise ValueError("SVG document declarations are not supported")
    root = ElementTree.fromstring(content)
    if root.tag != "{http://www.w3.org/2000/svg}svg":
        raise ValueError("not an SVG document")
    return {"imagePath": str(requested), "imageSource": reference,
            "fingerprint": hashlib.sha256(content).hexdigest(), "svg": content.decode("utf-8-sig")}


class AnnotationHandler(BaseHTTPRequestHandler):
    server_version = "TyporaAnnotations/1.0"

    def log_message(self, message, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), message % args))

    def _origin_allowed(self) -> bool:
        return self.headers.get("Origin") in (None, "null", "file://")

    def _headers(self, status: int, content_type: str = "application/json; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "null")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json(self, status: int, data: dict) -> None:
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._headers(status)
        self.wfile.write(encoded)

    def _error(self, status: int, error: Exception | str) -> None:
        self._json(status, {"error": str(error)})

    def do_OPTIONS(self) -> None:
        if not self._origin_allowed():
            return self._error(HTTPStatus.FORBIDDEN, "origin not allowed")
        self._headers(HTTPStatus.NO_CONTENT)

    def do_GET(self) -> None:
        if not self._origin_allowed():
            return self._error(HTTPStatus.FORBIDDEN, "origin not allowed")
        parsed = urlparse(self.path)
        if parsed.path == "/v1/health":
            return self._json(HTTPStatus.OK, {"ok": True, "storageRoot": str(storage_root())})
        if parsed.path == "/v1/svg":
            query = parse_qs(parsed.query)
            try:
                return self._json(HTTPStatus.OK, read_referenced_svg(
                    query.get("documentPath", [""])[0], query.get("src", [""])[0]))
            except (OSError, ValueError, ElementTree.ParseError) as error:
                return self._error(HTTPStatus.BAD_REQUEST, error)
        if parsed.path != "/v1/document":
            return self._error(HTTPStatus.NOT_FOUND, "not found")
        document_path = parse_qs(parsed.query).get("path", [""])[0]
        try:
            data, path = load_document(document_path)
            self._json(HTTPStatus.OK, response_document(data, path))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self._error(HTTPStatus.BAD_REQUEST, error)

    def do_PUT(self) -> None:
        if not self._origin_allowed():
            return self._error(HTTPStatus.FORBIDDEN, "origin not allowed")
        if urlparse(self.path).path != "/v1/document":
            return self._error(HTTPStatus.NOT_FOUND, "not found")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            data, path = save_document(payload)
            self._json(HTTPStatus.OK, response_document(data, path))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self._error(HTTPStatus.BAD_REQUEST, error)


def format_annotations(data: dict, path: Path) -> str:
    lines = [f"Document: {data['documentPath']}", f"Annotations: {path}"]
    annotations = data.get("annotations", [])
    if not annotations:
        lines.append("No annotations.")
    for index, item in enumerate(annotations, 1):
        anchor = item.get("anchor") or {}
        lines.extend([
            "",
            f"[{index}] {item.get('type', 'annotation')} · {item.get('status', 'open')} · {item.get('id', '')}",
            f"Quote: {anchor.get('quote', '')}",
        ])
        if anchor.get("scope") == "svg":
            lines.append(f"SVG: {anchor.get('imagePath') or anchor.get('imageSource', '')}")
            lines.append("SVG target: " + json.dumps({key: anchor[key] for key in (
                "target", "bounds", "viewBox", "svgFingerprint", "imageOccurrence"
            ) if key in anchor}, ensure_ascii=False))
        if item.get("comment"):
            lines.append(f"Comment: {item['comment']}")
    return "\n".join(lines)


def command_list(as_json: bool) -> int:
    index = scan_documents()
    if as_json:
        print(json.dumps(index, ensure_ascii=False, indent=2))
    else:
        documents = index.get("documents", {})
        if not documents:
            print("No annotated documents.")
        for document, metadata in documents.items():
            print(f"{metadata.get('openCount', 0):>3} open  {document}")
    return 0


def command_show(document_path: str, as_json: bool) -> int:
    data, path = load_document(document_path)
    if as_json:
        print(json.dumps(response_document(data, path), ensure_ascii=False, indent=2))
    else:
        print(format_annotations(data, path))
    return 0


def command_resolve(document_path: str, annotation_id: str) -> int:
    data, _ = load_document(document_path)
    matched = False
    for item in data["annotations"]:
        if item.get("id") == annotation_id:
            item["status"] = "resolved"
            item["resolvedAt"] = now()
            matched = True
            break
    if not matched:
        raise ValueError(f"annotation not found: {annotation_id}")
    saved, path = save_document(data)
    print(format_annotations(saved, path))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="typora-annotations")
    subparsers = parser.add_subparsers(dest="command", required=True)
    serve = subparsers.add_parser("serve", help="run the localhost storage bridge")
    serve.add_argument("--port", type=int, default=DEFAULT_PORT)
    listing = subparsers.add_parser("list", help="list annotated documents")
    listing.add_argument("--json", action="store_true")
    show = subparsers.add_parser("show", help="show annotations for a document")
    show.add_argument("document")
    show.add_argument("--json", action="store_true")
    path = subparsers.add_parser("path", help="print the JSON path for a document")
    path.add_argument("document")
    resolve = subparsers.add_parser("resolve", help="mark an annotation resolved")
    resolve.add_argument("document")
    resolve.add_argument("annotation_id")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "serve":
        storage_root().mkdir(parents=True, exist_ok=True)
        server = ThreadingHTTPServer(("127.0.0.1", args.port), AnnotationHandler)
        print(f"Typora annotations helper on http://127.0.0.1:{args.port}", flush=True)
        server.serve_forever()
    if args.command == "list":
        return command_list(args.json)
    if args.command == "show":
        return command_show(args.document, args.json)
    if args.command == "path":
        print(annotation_path(args.document))
        return 0
    if args.command == "resolve":
        return command_resolve(args.document, args.annotation_id)
    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"typora-annotations: {error}", file=sys.stderr)
        raise SystemExit(2)
