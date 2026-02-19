class Zone:
    def __init__(self, name: str, description: str, events: list = None):
        self.name = name
        self.description = description
        self.events = events or []

    def add_event(self, event: str):
        self.events.append(event)

    def __str__(self):
        return f"{self.name}: {self.description}"


class World:
    def __init__(self):
        self.zones = {}
        self._initialize_zones()

    def _initialize_zones(self):
        # Define the zones of NeoCity
        self.add_zone(Zone("Financial Center", "Skyscrapers, tech companies, and high-end businesses."))
        self.add_zone(Zone("Residential District (Rich)", "Luxury villas, gated communities, clean streets."))
        self.add_zone(Zone("Residential District (Poor)", "Crowded apartments, graffiti, higher crime rate."))
        self.add_zone(Zone("Nightlife District", "Clubs, bars, casinos, neon lights."))
        self.add_zone(Zone("Industrial Zone", "Factories, warehouses, smog."))
        self.add_zone(Zone("Port & Beach", "Shipping containers, sandy beaches, seaside cafes."))
        self.add_zone(Zone("Suburbs & Forest", "Quiet neighborhoods, dense forest, winding roads."))
        self.add_zone(Zone("Underground Circuit", "Illegal racing tracks, secret meetings."))
        self.add_zone(Zone("Shopping Mall", "Interactive shops, crowds, consumerism."))

    def add_zone(self, zone: Zone):
        self.zones[zone.name] = zone

    def get_zone(self, name: str):
        return self.zones.get(name)

    def list_zones(self):
        return list(self.zones.keys())
