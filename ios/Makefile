.DEFAULT_GOAL := test
.NOTPARALLEL:

TESTS ?=
SCHEME ?= WingDex
DESTINATION ?=
DERIVED_DATA_PATH ?=
XCODEBUILD_ARGS ?= CODE_SIGNING_ALLOWED=NO

export SCHEME DESTINATION DERIVED_DATA_PATH XCODEBUILD_ARGS \
	IOS_TEST_DEVICE_TYPE IOS_TEST_DEVICE_NAME

BUILD_DESTINATION := $(if $(strip $(DESTINATION)),$(DESTINATION),generic/platform=iOS Simulator)
BUILD_DERIVED_DATA_PATH := $(if $(strip $(DERIVED_DATA_PATH)),$(DERIVED_DATA_PATH),build/DerivedData)

.PHONY: build test all core accessibility accessibility-deep

build:
	WINGDEX_SKIP_APP_ICON=0 xcodegen generate
	xcodebuild build -project WingDex.xcodeproj -scheme "$(SCHEME)" \
		-destination "$(BUILD_DESTINATION)" -derivedDataPath "$(BUILD_DERIVED_DATA_PATH)" \
		-onlyUsePackageVersionsFromResolvedFile -skipPackagePluginValidation $(XCODEBUILD_ARGS)

test all:
	./scripts/test.sh all $(TESTS)

core accessibility accessibility-deep:
	./scripts/test.sh $@ $(TESTS)
