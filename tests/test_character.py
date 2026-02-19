import unittest
from src.character import Character

class TestCharacter(unittest.TestCase):
    def setUp(self):
        self.character = Character("John Doe", {"hair": "brown"}, "Street Kid")

    def test_initialization(self):
        self.assertEqual(self.character.name, "John Doe")
        self.assertEqual(self.character.background, "Street Kid")
        self.assertEqual(self.character.stats["force"], 10)

    def test_update_stat(self):
        self.character.update_stat("force", 10)
        self.assertEqual(self.character.stats["force"], 20)

        self.character.update_stat("force", 100) # Should cap at 100
        self.assertEqual(self.character.stats["force"], 100)

        self.character.update_stat("force", -200) # Should floor at 0
        self.assertEqual(self.character.stats["force"], 0)

    def test_invalid_stat(self):
        with self.assertRaises(ValueError):
            self.character.update_stat("magic", 10)

if __name__ == '__main__':
    unittest.main()
