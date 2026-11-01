import json
import io
import os
import tempfile
import threading
import unittest
from contextlib import redirect_stdout, redirect_stderr
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from urllib.request import Request, urlopen

import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "tools"))
import typora_annotations as annotations


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = os.environ.get("TYPORA_ANNOTATIONS_HOME")
        os.environ["TYPORA_ANNOTATIONS_HOME"] = self.temp.name

    def tearDown(self):
        if self.previous is None:
            os.environ.pop("TYPORA_ANNOTATIONS_HOME", None)
        else:
            os.environ["TYPORA_ANNOTATIONS_HOME"] = self.previous
        self.temp.cleanup()

    def test_round_trip_and_index(self):
        document = str(Path.home() / "Workspace" / "project" / "notes.md")
        saved, path = annotations.save_document({
            "documentPath": document,
            "annotations": [{"id": "a1", "type": "comment", "status": "open", "comment": "fix"}],
        })
        self.assertEqual(path.relative_to(Path(self.temp.name)), Path("annotations/Workspace/project/notes.md.annotations.json"))
        self.assertEqual(saved["annotations"][0]["comment"], "fix")
        loaded, _ = annotations.load_document(document)
        self.assertEqual(loaded["documentId"], saved["documentId"])
        index = json.loads((Path(self.temp.name) / "index.json").read_text())
        self.assertEqual(index["documents"][document]["openCount"], 1)

        empty, empty_path = annotations.save_document({
            "documentPath": document,
            "documentId": saved["documentId"],
            "annotations": [],
        })
        self.assertEqual(empty["annotations"], [])
        self.assertFalse(empty_path.exists())
        index = json.loads((Path(self.temp.name) / "index.json").read_text())
        self.assertNotIn(document, index["documents"])

    def test_http_save_succeeds_when_macos_denies_index_access(self):
        document = str(Path.home() / "Workspace" / "notes.md")
        item = {"id": "a1", "type": "comment", "comment": "fix",
                "anchor": {"quote": "target", "prefix": "before", "suffix": "after"}}
        read_json = annotations.read_json

        def deny_index(path, fallback):
            if path == Path(self.temp.name) / "index.json":
                raise PermissionError(1, "Operation not permitted", str(path))
            return read_json(path, fallback)

        server = ThreadingHTTPServer(("127.0.0.1", 0), annotations.AnnotationHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with mock.patch.object(annotations, "read_json", side_effect=deny_index), redirect_stderr(io.StringIO()):
                request = Request(
                    f"http://127.0.0.1:{server.server_port}/v1/document",
                    data=json.dumps({"documentPath": document, "annotations": [item]}).encode(),
                    headers={"Content-Type": "application/json", "Origin": "null"}, method="PUT")
                with urlopen(request) as response:
                    self.assertEqual(response.status, 200)
                    saved = json.load(response)
                self.assertTrue(saved["storageExists"])
                self.assertEqual(saved["annotations"], [item])
                loaded, path = annotations.load_document(document)
                self.assertEqual(loaded["annotations"], [item])
                before = path.read_bytes()
                output = io.StringIO()
                with redirect_stdout(output):
                    annotations.command_list(True)
                listing = json.loads(output.getvalue())
                self.assertEqual(listing["documents"][document]["openCount"], 1)
                self.assertEqual(path.read_bytes(), before, "listing must not rewrite annotations")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_list_discovers_documents_missing_from_stale_index(self):
        document = str(Path.home() / "Workspace" / "notes.md")
        annotations.save_document({
            "documentPath": document,
            "annotations": [{"id": "a1", "status": "resolved"}, {"id": "a2"}],
        })
        index_path = Path(self.temp.name) / "index.json"
        stale = b'{"version": 1, "documents": {"/missing.md": {}}}'
        index_path.write_bytes(stale)
        listing = annotations.scan_documents()["documents"]
        self.assertEqual(list(listing), [document])
        self.assertEqual(listing[document]["annotationCount"], 2)
        self.assertEqual(listing[document]["openCount"], 1)
        self.assertEqual(index_path.read_bytes(), stale, "listing must not rewrite the index")

    def test_corrupt_index_does_not_fail_document_save(self):
        index_path = Path(self.temp.name) / "index.json"
        index_path.write_text("invalid JSON")
        document = str(Path.home() / "Workspace" / "notes.md")
        with redirect_stderr(io.StringIO()):
            saved, path = annotations.save_document({
                "documentPath": document, "annotations": [{"id": "a1"}],
            })
        self.assertEqual(json.loads(path.read_text()), saved)
        self.assertEqual(index_path.read_text(), "invalid JSON")

    def test_svg_source_is_limited_to_local_embedded_images(self):
        root = Path(self.temp.name)
        image = root / "diagram with spaces.svg"
        original = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="5" y="20">Target</text></svg>'
        image.write_bytes(original)
        document = root / "notes.md"
        document.write_text('![Diagram](<diagram with spaces.svg>)')
        data = annotations.read_referenced_svg(str(document), image.as_uri())
        self.assertEqual(data["imagePath"], str(image.resolve()))
        self.assertEqual(data["imageSource"], image.name)
        self.assertEqual(data["svg"].encode(), original)
        self.assertEqual(len(data["fingerprint"]), 64)
        for source in (str(root / "not-embedded.svg"), "https://example.org/remote.svg", str(document)):
            with self.assertRaises(ValueError):
                annotations.read_referenced_svg(str(document), source)
        self.assertEqual(image.read_bytes(), original, "reading must preserve the source image")
        image.write_text('<!DOCTYPE svg [<!ENTITY x "bad">]><svg xmlns="http://www.w3.org/2000/svg"/>')
        with self.assertRaises(ValueError):
            annotations.read_referenced_svg(str(document), str(image))

    def test_svg_annotation_round_trip_and_agent_context(self):
        document = str(Path(self.temp.name) / "notes.md")
        anchor = {"scope": "svg", "quote": "Production", "prefix": "", "suffix": "",
                  "imageSource": "img/diagram.svg", "imagePath": "/tmp/img/diagram.svg",
                  "svgFingerprint": "source-hash", "imageOccurrence": 0,
                  "target": {"tag": "text", "id": "prod", "text": "Production", "path": "2"},
                  "bounds": {"x": 10, "y": 20, "width": 100, "height": 30}}
        item = {"id": "svg-comment", "type": "comment", "comment": "Please explain", "anchor": anchor}
        saved, path = annotations.save_document({"documentPath": document, "annotations": [item]})
        loaded, _ = annotations.load_document(document)
        self.assertEqual(loaded["annotations"], [item])
        output = annotations.format_annotations(saved, path)
        self.assertIn("SVG: /tmp/img/diagram.svg", output)
        self.assertIn('"id": "prod"', output)
        self.assertIn("Please explain", output)


if __name__ == "__main__":
    unittest.main()
