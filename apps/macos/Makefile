SHELL := /bin/bash

.PHONY: build build-universal check format lint restart start stop test

start:
	bash ./Scripts/dev.sh

restart: stop start

stop:
	pkill -x TokenCue 2>/dev/null || true

build:
	swift build --product TokenCue
	swift build --product tokencue

build-universal:
	bash ./Scripts/build_universal.sh

check:
	bash ./Scripts/check_tokencue.sh
	bash ./Scripts/lint.sh lint

lint:
	bash ./Scripts/lint.sh lint

format:
	./Scripts/lint.sh format

test:
	bash ./Scripts/test_tokencue.sh
