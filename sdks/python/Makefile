.PHONY: test type-check format lint clean

test:
	pytest tests/ -v --tb=short

type-check:
	mypy clawdb/ --ignore-missing-imports --strict

format:
	ruff format clawdb/ tests/

lint:
	ruff check clawdb/ tests/ --fix

clean:
	rm -rf dist/ build/ *.egg-info
