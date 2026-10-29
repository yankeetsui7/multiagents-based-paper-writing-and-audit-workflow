"""Single project-specific experiment entry point. Replace run() with real work."""

import argparse
from pathlib import Path

from gate import check


def run(experiment_id: str) -> None:
    # Connect the project's actual experiment implementation here.
    print(f"Experiment {experiment_id} authorized. No experiment implementation is configured.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    allowed, reason = check(root, args.experiment)
    if not allowed:
        parser.exit(2, reason + "\n")
    run(args.experiment)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

