.PHONY: setup run backend frontend test build clean

setup:      ## install backend + frontend dependencies
	./scripts/setup.sh

run:        ## start API + UI
	./scripts/run.sh

backend:    ## start only the API on :8000
	cd backend && . .venv/bin/activate && uvicorn main:app --reload --port 8000

frontend:   ## start only the UI on :5173
	cd frontend && npm run dev

test:       ## backend test-suite (offline, no API key needed)
	cd backend && . .venv/bin/activate && EMBEDDING_BACKEND=hash python -m pytest -q

build:      ## production build of the UI
	cd frontend && npm run build

clean:      ## wipe stored knowledge (vector DB + graph)
	rm -rf backend/storage
