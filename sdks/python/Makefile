.PHONY: test type-check format lint clean

test:
	pytest tests/ -v --tb=short

type-check:
	mypy axonio/ --ignore-missing-imports --strict

format:
	ruff format axonio/ tests/

lint:
	ruff check axonio/ tests/ --fix

clean:
	rm -rf dist/ build/ *.egg-info
