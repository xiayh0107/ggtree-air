.PHONY: help check fixture rich-fixture hmp-fixture hpv-fixture serve serve-rich serve-hmp serve-hpv test clean

NODE ?= node
CLI := $(NODE) backend/bin/ggtree-air.mjs
OUT ?= results/fixture

help:
	@printf '%s\n' \
	  'ggtree-air targets:' \
	  '  make check        verify Node orchestrator and isolated R renderer' \
	  '  make fixture      build a small renderer test workspace' \
	  '  make rich-fixture fetch and build the treedata-book Candida fixture' \
	  '  make hmp-fixture  build the 334-tip HMP renderer fixture' \
	  '  make hpv-fixture  build the 90-genome HPV58 renderer fixture' \
	  '  make serve        open the annotation → rerender backend loop' \
	  '  make test         run Node backend and R renderer tests' \
	  '  make clean        remove generated results'

check:
	$(CLI) check

fixture:
	$(CLI) run \
	  --dist renderer/r/fixtures/easy_input.dist.tsv \
	  --groups renderer/r/fixtures/group_table.tsv \
	  --layout rectangular,circular \
	  --intent treescale,tipcolor \
	  --format png \
	  --dpi 120 \
	  --title 'ggtree-air renderer fixture' \
	  --out $(OUT) \
	  --force

rich-fixture:
	$(NODE) examples/treedata-book/fetch.mjs candida-auris
	$(CLI) run \
	  --tree examples/treedata-book/data/candida-auris-tree.nwk \
	  --metadata examples/treedata-book/data/candida-auris-metadata.csv \
	  --tip-column ID --group-column CLADE \
	  --heatmap-columns FCZ,AMB,MCF,ERG11,FKS1 \
	  --layout fan,rectangular \
	  --intent tipcolor,heatmap,treescale \
	  --tip-labels hide --format png --width 12 --height 10 --dpi 120 \
	  --title 'Candida auris · resistance and target mutations' \
	  --subtitle 'treedata-book chapter 10 · 305 tips / 304 metadata rows' \
	  --out results/candida-auris --force

hmp-fixture:
	$(NODE) examples/treedata-book/fetch.mjs hmp-microbiome
	$(NODE) examples/treedata-book/prepare-hmp.mjs
	$(CLI) run \
	  --tree examples/treedata-book/data/hmp-tree.nwk --repair-tip-labels \
	  --metadata examples/treedata-book/data/hmp-metadata-wide.csv \
	  --tip-column ID --group-column Phylum \
	  --size-column Size --shape-column Type \
	  --heatmap-columns Stool,Cheek,Plaque,Tongue,Nose,Vagina,Skin \
	  --layout fan,rectangular --intent tipcolor,heatmap,treescale \
	  --tip-labels hide --format png --width 12 --height 10 --dpi 120 \
	  --title 'Human microbiome · body-site prevalence' \
	  --subtitle 'treedata-book chapter 10 · 334 tips / 7 body-site tracks' \
	  --out results/hmp-microbiome --force

hpv-fixture:
	$(NODE) examples/treedata-book/fetch.mjs hpv58
	$(NODE) examples/treedata-book/prepare-hpv58.mjs
	$(CLI) run \
	  --tree examples/treedata-book/data/hpv58-tree.nwk \
	  --metadata examples/treedata-book/data/hpv58-distance-metadata.csv \
	  --tip-column ID --heatmap-columns MeanDistance,MaxDistance \
	  --clade-nodes 92,94,108,156,159,163,173,176 \
	  --clade-labels A3,A1,A2,B1,B2,C,D1,D2 \
	  --layout rectangular,circular \
	  --intent branchcolor,cladelabel,heatmap,treescale \
	  --tip-labels hide --format png --width 12 --height 10 --dpi 120 \
	  --title 'HPV58 · lineage and sequence distance' \
	  --subtitle 'treedata-book chapter 13 · 90 complete genomes' \
	  --out results/hpv58 --force

serve:
	$(CLI) open --workspace $(OUT)

serve-rich:
	$(CLI) open --workspace results/candida-auris

serve-hmp:
	$(CLI) open --workspace results/hmp-microbiome

serve-hpv:
	$(CLI) open --workspace results/hpv58

test:
	npm test

clean:
	rm -rf results
