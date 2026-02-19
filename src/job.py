class Job:
    def __init__(self, title: str, job_type: str, salary: int, requirements: dict = None):
        self.title = title
        self.job_type = job_type  # "legal" or "illegal"
        self.salary = salary
        self.requirements = requirements or {}

    def __str__(self):
        return f"{self.title} ({self.job_type}) - Salary: ${self.salary}"

class JobManager:
    def __init__(self):
        self.jobs = []
        self._initialize_jobs()

    def _initialize_jobs(self):
        # Legal Jobs
        self.jobs.append(Job("Police Officer", "legal", 3000, {"force": 40, "intelligence": 30}))
        self.jobs.append(Job("Doctor", "legal", 8000, {"intelligence": 80, "precision": 60}))
        self.jobs.append(Job("AI Developer", "legal", 7000, {"tech_competence": 80, "intelligence": 60}))
        self.jobs.append(Job("Entrepreneur", "legal", 5000, {"charisma": 70, "intelligence": 50})) # Variable salary logic could be added
        self.jobs.append(Job("Influencer", "legal", 4000, {"charisma": 80}))
        self.jobs.append(Job("Taxi Driver", "legal", 2500, {"endurance": 30}))
        self.jobs.append(Job("Delivery Driver", "legal", 2000, {"endurance": 40}))
        self.jobs.append(Job("Real Estate Agent", "legal", 4500, {"charisma": 60}))

        # Illegal Jobs
        self.jobs.append(Job("Dealer", "illegal", 5000, {"charisma": 40, "risk_tolerance": 50})) # Added risk_tolerance as a concept
        self.jobs.append(Job("Hacker", "illegal", 9000, {"tech_competence": 90, "intelligence": 70}))
        self.jobs.append(Job("Bank Robber", "illegal", 15000, {"force": 70, "precision": 60})) # High risk
        self.jobs.append(Job("Gang Leader", "illegal", 20000, {"charisma": 90, "force": 80}))
        self.jobs.append(Job("Smuggler", "illegal", 8000, {"endurance": 50, "charisma": 40}))

    def get_jobs(self, job_type: str = None):
        if job_type:
            return [job for job in self.jobs if job.job_type == job_type]
        return self.jobs

    def get_job_by_title(self, title: str):
        for job in self.jobs:
            if job.title.lower() == title.lower():
                return job
        return None
