# DRY_RUN=1 echoes install/uninstall actions instead of performing them (make -n prints the recipes as well).
PREFIX ?= $(HOME)/.local
SKILLS_DIR ?= $(HOME)/.claude/skills
BIN_LINK := $(PREFIX)/bin/mw
SKILL_LINK := $(SKILLS_DIR)/mindwtr
RUN := $(if $(DRY_RUN),echo would run:,)

.PHONY: build test typecheck install uninstall

node_modules: package.json
	@if [ -f pnpm-lock.yaml ]; then pnpm -C "$(CURDIR)" install --frozen-lockfile; else pnpm -C "$(CURDIR)" install; fi
	@touch node_modules

build: node_modules
	pnpm -C "$(CURDIR)" build

test: node_modules
	pnpm -C "$(CURDIR)" test

typecheck: node_modules
	pnpm -C "$(CURDIR)" typecheck

# Refuses to replace anything that is not already a symlink into this checkout; ln -sfn would otherwise
# overwrite a foreign link or drop the new link inside a directory. The check only reads, so it also runs in DRY_RUN.
define link
	@if [ -e "$(2)" ] || [ -L "$(2)" ]; then \
	  if [ -L "$(2)" ]; then case "$$(readlink "$(2)")" in "$(CURDIR)"/*) ;; *) echo "error: $(2) is a symlink to somewhere else" >&2; exit 1 ;; esac; \
	  else echo "error: $(2) exists and is not a symlink" >&2; exit 1; fi; \
	fi
	$(RUN) mkdir -p "$(dir $(2))"
	$(RUN) ln -sfn "$(1)" "$(2)"
endef

install: $(if $(DRY_RUN),,build)
	$(call link,$(CURDIR)/dist/cli.js,$(BIN_LINK))
	$(call link,$(CURDIR)/skill,$(SKILL_LINK))

# Removes only symlinks that point into this checkout.
uninstall:
	@for l in "$(BIN_LINK)" "$(SKILL_LINK)"; do \
	  if [ -L "$$l" ]; then \
	    case "$$(readlink "$$l")" in \
	      "$(CURDIR)"/*) if [ -n "$(DRY_RUN)" ]; then echo "would remove $$l"; else rm "$$l" && echo "removed $$l"; fi ;; \
	      *) echo "skip $$l: points outside $(CURDIR)" ;; \
	    esac; \
	  elif [ -e "$$l" ]; then echo "skip $$l: not a symlink"; fi; \
	done
