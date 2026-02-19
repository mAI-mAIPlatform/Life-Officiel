import sys
import os

# Add the parent directory to sys.path to allow imports from src
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.character import Character
from src.world import World
from src.job import JobManager

def create_character():
    print("Welcome to LIFE - The Next Gen RPG")
    name = input("Enter your character's name: ")
    background = input("Enter your background (e.g., street kid, corporate heir): ")

    # Simplified appearance for now
    appearance = {
        "hair": "default",
        "eyes": "default"
    }

    return Character(name, appearance, background)

def main_menu(character, world, job_manager):
    while True:
        print("\n--- Main Menu ---")
        print("1. View Character Stats")
        print("2. Explore NeoCity Zones")
        print("3. Find a Job")
        print("4. Quit")

        choice = input("Select an option: ")

        if choice == "1":
            print("\n--- Character Stats ---")
            print(character)

        elif choice == "2":
            print("\n--- NeoCity Zones ---")
            zones = world.list_zones()
            for i, zone_name in enumerate(zones):
                print(f"{i + 1}. {zone_name}")

            zone_choice = input("Select a zone to visit (or 0 to go back): ")
            try:
                idx = int(zone_choice) - 1
                if 0 <= idx < len(zones):
                    zone = world.get_zone(zones[idx])
                    print(f"\nYou are now in: {zone.name}")
                    print(f"Description: {zone.description}")
                    # Future: trigger random events here
                elif idx == -1:
                    continue
                else:
                    print("Invalid zone selection.")
            except ValueError:
                print("Invalid input.")

        elif choice == "3":
            print("\n--- Job Market ---")
            jobs = job_manager.get_jobs()
            for i, job in enumerate(jobs):
                print(f"{i + 1}. {job.title} ({job.job_type}) - ${job.salary}")

            job_choice = input("Select a job to apply for (or 0 to go back): ")
            try:
                idx = int(job_choice) - 1
                if 0 <= idx < len(jobs):
                    selected_job = jobs[idx]
                    # Simple check: does the character have stats? (Currently, all stats are 10, some jobs require more)
                    # For prototype, we'll just assign it
                    character.set_job(selected_job.title)
                    print(f"Congratulations! You are now a {selected_job.title}.")
                elif idx == -1:
                    continue
                else:
                    print("Invalid job selection.")
            except ValueError:
                print("Invalid input.")

        elif choice == "4":
            print("Exiting game. Goodbye!")
            break

        else:
            print("Invalid option, please try again.")

if __name__ == "__main__":
    character = create_character()
    world = World()
    job_manager = JobManager()

    main_menu(character, world, job_manager)
