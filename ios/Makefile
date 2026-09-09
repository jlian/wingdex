.DEFAULT_GOAL := test
.NOTPARALLEL:

TESTS ?=
SCHEME ?= WingDex
DESTINATION ?= generic/platform=iOS Simulator
DERIVED_DATA_PATH ?= build/DerivedData
XCODEBUILD_ARGS ?= CODE_SIGNING_ALLOWED=NO

.PHONY: build test all core accessibility accessibility-deep

build:
	xcodegen generate
	xcodebuild build -project WingDex.xcodeproj -scheme "$(SCHEME)" \
		-destination "$(DESTINATION)" -derivedDataPath "$(DERIVED_DATA_PATH)" \
		-onlyUsePackageVersionsFromResolvedFile -skipPackagePluginValidation $(XCODEBUILD_ARGS)

test all:
	./scripts/test.sh all $(TESTS)

core accessibility accessibility-deep:
	./scripts/test.sh $@ $(TESTS)
