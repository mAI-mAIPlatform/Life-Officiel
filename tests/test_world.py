import unittest
from src.world import World, Zone

class TestWorld(unittest.TestCase):
    def setUp(self):
        self.world = World()

    def test_zone_creation(self):
        zone = Zone("Test Zone", "A test description")
        self.assertEqual(zone.name, "Test Zone")
        self.assertEqual(zone.description, "A test description")

    def test_world_initialization(self):
        self.assertGreater(len(self.world.zones), 0)
        self.assertTrue("Financial Center" in self.world.list_zones())

    def test_get_zone(self):
        zone = self.world.get_zone("Financial Center")
        self.assertIsNotNone(zone)
        self.assertEqual(zone.name, "Financial Center")

if __name__ == '__main__':
    unittest.main()
