.DEFAULT_GOAL := test
.NOTPARALLEL:

TESTS ?=

.PHONY: test all core accessibility accessibility-deep

test all:
	./scripts/test.sh all $(TESTS)

core accessibility accessibility-deep:
	./scripts/test.sh $@ $(TESTS)
