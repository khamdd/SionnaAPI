import logging
import signal

from backend.database import ensure_database_is_current
from backend.services.simulation_worker import (
    run_simulation_worker_forever,
    stop_simulation_worker,
)


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    def stop(signum, frame):
        stop_simulation_worker(timeout=0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    ensure_database_is_current()
    run_simulation_worker_forever()


if __name__ == "__main__":
    main()
