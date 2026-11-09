# Code checks. Locally they run in the compose containers (`docker compose up -d` first);
# CI runs the same targets on the runner by overriding the prefixes below.
BACKEND ?= docker compose exec -T backend uv run
FRONTEND ?= docker compose exec -T frontend pnpm
RUFF ?= uvx ruff@0.17.3
VALE ?= docker run --rm -v "$(CURDIR)":/docs -w /docs jdkato/vale:v3.25.0

.PHONY: check check-python check-frontend docs test format

## done means this passes
check: check-python check-frontend docs

check-python:
	$(RUFF) check .
	$(RUFF) format --check .
	$(BACKEND) pyrefly check

check-frontend:
	$(FRONTEND) exec eslint .
	$(FRONTEND) exec prettier --check .
	$(FRONTEND) exec tsc --noEmit

## prose lint; reports only, never fails the build
docs:
	-$(VALE) $(shell git ls-files '*.md')

test:
	$(BACKEND) pytest --cov --cov-report=term-missing --cov-report=xml

## apply formatters and import sorting
format:
	$(RUFF) check --select I --fix .
	$(RUFF) format .
	$(FRONTEND) exec prettier --write .
