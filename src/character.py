class Character:
    def __init__(self, name: str, appearance: dict, background: str):
        self.name = name
        self.appearance = appearance
        self.background = background

        # Stats: value between 0 and 100
        self.stats = {
            "force": 10,
            "intelligence": 10,
            "precision": 10,
            "endurance": 10,
            "charisma": 10,
            "tech_competence": 10
        }

        self.jobs = []
        self.current_job = None
        self.inventory = []
        self.money = 1000  # Starting money

    def update_stat(self, stat_name: str, amount: int):
        if stat_name in self.stats:
            self.stats[stat_name] = max(0, min(100, self.stats[stat_name] + amount))
        else:
            raise ValueError(f"Stat '{stat_name}' does not exist.")

    def set_job(self, job_name: str):
        self.current_job = job_name

    def __str__(self):
        stats_str = ", ".join([f"{k.capitalize()}: {v}" for k, v in self.stats.items()])
        return (f"Name: {self.name}\n"
                f"Background: {self.background}\n"
                f"Job: {self.current_job}\n"
                f"Stats: {stats_str}")
