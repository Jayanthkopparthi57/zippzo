class SShapeRouter:
    @staticmethod
    def optimize_task_sequence(tasks):
        """
        Sorts pick tasks into an S-Shape / Serpentine picking path through the warehouse.
        Odd aisles are traversed ascending (Rack 1 -> 50); Even aisles descending (Rack 50 -> 1).
        """
        if not tasks:
            return []

        def sort_key(task):
            loc = task.source_location
            try:
                aisle_num = int(''.join(filter(str.isdigit, loc.aisle))) if any(c.isdigit() for c in loc.aisle) else 1
            except ValueError:
                aisle_num = 1

            try:
                rack_num = int(''.join(filter(str.isdigit, loc.rack_number))) if any(c.isdigit() for c in loc.rack_number) else 1
            except ValueError:
                rack_num = 1

            # Invert rack number for even aisles to form serpentine curve
            effective_rack = rack_num if (aisle_num % 2 != 0) else -rack_num
            return (loc.zone_id, aisle_num, effective_rack, loc.shelf_level)

        sorted_tasks = sorted(tasks, key=sort_key)
        for idx, task in enumerate(sorted_tasks, start=1):
            task.sequence_route_order = idx
            task.save(update_fields=['sequence_route_order'])

        return sorted_tasks
