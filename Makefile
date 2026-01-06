.PHONY: help build up down restart logs clean test

# Variables
IMAGE_NAME ?= tesla-cloud
IMAGE_TAG ?= latest
COMPOSE_FILE ?= docker-compose.yml

help: ## Show this help message
	@echo "Tesla Cloud - Makefile Commands"
	@echo "================================"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

build: ## Build the Docker image
	@echo "Building Tesla Cloud Docker image..."
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .
	@echo "✓ Build complete: $(IMAGE_NAME):$(IMAGE_TAG)"

up: ## Start the application stack
	@echo "Starting Tesla Cloud application stack..."
	docker-compose -f $(COMPOSE_FILE) up -d
	@echo "✓ Application stack started"
	@echo "Access the application at: http://localhost"

down: ## Stop the application stack
	@echo "Stopping Tesla Cloud application stack..."
	docker-compose -f $(COMPOSE_FILE) down
	@echo "✓ Application stack stopped"

restart: down up ## Restart the application stack

logs: ## Show logs from all services
	docker-compose -f $(COMPOSE_FILE) logs -f

logs-app: ## Show logs from the tesla-cloud service only
	docker-compose -f $(COMPOSE_FILE) logs -f tesla-cloud

logs-db: ## Show logs from the database service only
	docker-compose -f $(COMPOSE_FILE) logs -f db

logs-traefik: ## Show logs from the Traefik service only
	docker-compose -f $(COMPOSE_FILE) logs -f traefik

clean: ## Remove all containers, volumes, and images
	@echo "Cleaning up Tesla Cloud Docker resources..."
	docker-compose -f $(COMPOSE_FILE) down -v
	docker rmi $(IMAGE_NAME):$(IMAGE_TAG) 2>/dev/null || true
	@echo "✓ Cleanup complete"

rebuild: clean build ## Clean and rebuild the image

test: ## Run tests on the application
	@echo "Running Tesla Cloud tests..."
	@echo "Note: Start the development server first with 'make dev'"
	cd test && DOTENV_PATH="$$(pwd)/../php/dotenv.php" bash dotenv.sh
	cd test && bash restdb.sh
	@echo "✓ Tests complete"

dev: ## Start local development server (PHP built-in)
	@echo "Starting development server on http://localhost:8000"
	@echo "Press Ctrl+C to stop"
	php -S localhost:8000

shell: ## Open a shell in the running tesla-cloud container
	docker-compose -f $(COMPOSE_FILE) exec tesla-cloud /bin/bash

db-shell: ## Open a MySQL shell in the database container
	docker-compose -f $(COMPOSE_FILE) exec db mysql -u teslacloud -p teslacloud

status: ## Show status of all services
	docker-compose -f $(COMPOSE_FILE) ps

pull: ## Pull the latest base images
	docker-compose -f $(COMPOSE_FILE) pull

push: ## Push the built image to registry
	docker push $(IMAGE_NAME):$(IMAGE_TAG)
