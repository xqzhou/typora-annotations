import json
import os
import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
