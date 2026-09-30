.PHONY: setup run backend frontend test build seed hooks unhooks hook-test clean

setup:      ## install backend + frontend dependencies
	./scripts/setup.sh

run:        ## start API + UI
	./scripts/run.sh

backend:    ## start only the API on :8000 (from the repo root)
	backend/.venv/bin/uvicorn backend.app.main:app --port 8000

frontend:   ## start only the UI on :5173
	cd frontend && npm run dev

test:       ## backend test-suite (offline, no API key needed)
	cd backend && EMBEDDING_BACKEND=hash .venv/bin/python -m pytest -q

build:      ## type-check + production build of the UI
	cd frontend && npm run build

seed:       ## load the demo notes into the running brain
	python3 scripts/seed_knowledge.py

hooks:      ## install the Claude Code hooks in ~/.claude/settings.json (Cursor: install_hooks.py --cursor)
	backend/.venv/bin/python scripts/install_hooks.py

unhooks:    ## remove them again
	backend/.venv/bin/python scripts/install_hooks.py --uninstall

hook-test:  ## fire a fake Claude Code "Read" hook at the running brain
	echo '{"tool_name":"Read","tool_input":{"file_path":"src/auth.py"},"cwd":"/tmp"}' | python3 backend/hooks/hook_handler.py

clean:      ## wipe the brain (vectors + git-versioned graph)
	rm -rf backend/data
