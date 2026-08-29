# ==============================================================================
# router.R — ggtree visualization router: layouts · annotation recipes · gallery
#
# Source modules: FigureYa2, FigureYa88, FigureYa80 + ggtree / treedata-book
# (chapters 1, 2, 4-10, 13). This file centralizes the DECISION TABLE for the
# ggtree-phylo skill:
#   1. LAYOUTS   — every ggtree layout + when it is a good fit
#   2. INTENTS   — "I want to see ___" -> which geoms/recipes to use (gallery)
#   3. ANNOTATE  — the annotation geoms grouped by visual kind
# Every structure here is pure data (no side effects); source() it after the
# packages so callers only carry the frames they need.
# ==============================================================================

# ----------------------------------------------------------------------------
# 1. LAYOUTS. Source: ggtree::ggtree() help + treedata-book chapter 4.
#    Phylogram layouts keep branch lengths; cladogram layouts ignore them.
# ----------------------------------------------------------------------------
gtree_layouts <- data.frame(
  layout      = c("rectangular", "roundrect", "ellipse", "slanted",
                  "circular", "fan", "inward_circular", "radial",
                  "equal_angle", "daylight", "dendrogram", "ape"),
  family      = c("phylogram","phylogram","phylogram","phylogram",
                  "phylogram","phylogram","phylogram","phylogram",
                  "unrooted","unrooted","dendrogram","phylogram"),
  branch_len  = c("yes","yes","yes","yes","yes","yes","yes","yes",
                  "no","no","no","yes"),
  best_for    = c(
    "default; cleanest for many tips; standard in papers",
    "rounded corners on rectangular edges; aesthetic only",
    "rounded/smooth elongated branches",
    "diagonal (slanted) edges; compact, readable for mid-size trees",
    "tips wrapped around a circle; good for >100 tips + outer rings",
    "circular with an angular gap; highlight one sector via open.angle",
    "tips point inward (clock-face style)",
    "radial phylogram",
    "unrooted, equal-angle algorithm (classic unrooted look)",
    "unrooted, daylight algorithm (better labels, no overlap)",
    "dendrogram (hclust) / hierarchical clustering visualization",
    "defer layout to ape::plot.phylo internal"),
  open_angle  = c(NA, NA, NA, NA, NA, "0-360", NA, NA, NA, NA, NA, NA),
  stringsAsFactors = FALSE
)

#' Resolve a requested layout (accept synonyms) to a valid ggtree layout.
#' @return lowercase valid layout name, or NA (with a warning) if unknown.
resolve_layout <- function(layout) {
  valid <- gtree_layouts$layout
  aliases <- c(slanted = "slanted", cladogram = "slanted",
               rectangle = "rectangular", roundrect = "roundrect",
               round_rect = "roundrect", ellipse = "ellipse",
               circle = "circular", circular = "circular",
               fan = "fan", radial = "radial",
               inward_circular = "inward_circular",
               unrooted = "daylight", equal_angle = "equal_angle",
               daylight = "daylight", dendrogram = "dendrogram",
               ape = "ape")
  lv <- tolower(as.character(layout))
  out <- if (lv %in% valid) lv else if (lv %in% names(aliases)) aliases[[lv]] else NA
  if (is.na(out)) {
    warning("Unknown ggtree layout '", layout, "'. Valid: ",
            paste(valid, collapse = ", "), " (or synonyms ", 
            paste(names(aliases), collapse = ", "), ").")
  }
  out
}

# ----------------------------------------------------------------------------
# 2. INTENTS — gallery by research question. "I want to show ___".
#    Each row gives the recommended ggtree layers to compose (the 'recipe')
#    and which treedata-book chapter / gallery example it maps to.
#    Source: treedata-book ch.4-8,13.
# ----------------------------------------------------------------------------
gtree_gallery <- data.frame(
  intent = c(
    "show a tree with tip labels",
    "visualize branch lengths (evolutionary distance)",
    "show bootstrap / posterior support at internal nodes",
    "color tip points by a group / category",
    "color os ramos (branches) by a group",
    "wrap the tree around a circle for outer data rings",
    "highlight one clade (rectangle shading)",
    "highlight a clade on an unrooted tree (xspline)",
    "mark two descendant clades of an internal node",
    "annotate a clade with a bracket + text label",
    "annotate a side bar (strip) over a range of taxa",
    "connect two related taxa with a curve",
    "show uncertainty as error bars (CI range) on nodes/edges",
    "add a tree-scale / branch-length legend axis",
    "annotate photos / silhouette images at tips",
    "add clickable, collapsible exploration (shrink a clade)",
    "rotate a clade or flip two daughter clades",
    "annotate a heatmap aligned to the tree",
    "annotate an MSA / sequence alignment beside the tree",
    "attach a bar/pie/dot plot panel aligned to tips (composite)",
    "zoom into one subtree to inspect a large tree (inset)",
    "present multi-layer rings of data around a circular tree",
    "explore a large tree by collapsing/zooming clades"
  ),
  goal = c("label","branchlen","support","tipcolor","branchcolor",
           "circular","hilight","hilight_unrooted","balance","cladelabel",
           "strip","taxalink","range","treescale","image","explore",
           "rotate","heatmap","msa","facet","inset","extra","manip"),
  primary_layer = c(
    "geom_tiplab()",
    "layout with branch length kept (phylogram) + geom_treescale()",
    "geom_nodelab(aes(label=bp, subset=!isTip))",
    "geom_tippoint(aes(color=group))",
    "ggtree(tree, aes(color=factor(group)))",
    "layout='circular' (or 'fan')",
    "geom_hilight(node=, fill=, alpha=.2)",
    "geom_highlight(extend=) on unrooted layout",
    "geom_balance(node=)",
    "geom_cladelabel(node=, label=)",
    "geom_strip(taxa1, taxa2, label=)",
    "geom_taxalink(taxa1=, taxa2=)",
    "geom_range(range_col='ci_lo..ci_hi')",
    "geom_treescale()",
    "geom_tiplab() + ggimage/phylopic (tip image)",
    "collapse() / expand() / zoomClade()",
    "rotate() / flip()",
    "gheatmap(df, offset=, width=, colnames=TRUE)",
    "msaplot(p, 'aln.fa')",
    "facet_plot(p, panel=, data=, geom=geom_bar/geom_point)",
    "geom_inset(insets=, x=, y=)",
    "ggtreeExtra::geom_fruit(...) (multi-ring)",
    "zoomClade / collapse / scaleClade / identify"
  ),
  book_ref = c(
    "ch4 §4.2","ch4 §4.3.1","ch13 §13.2 / ch5 §5.2","ch4 §4.3.5","ch4 §4.3.5",
    "ch4 §4.2.2","ch5 §5.2.2 / ch13 §13.3","ch5 §5.2.2","ch5 §5.2.2","ch5 §5.2.1",
    "ch5 §5.2.1","ch5 §5.2.3","ch5 §5.2.4","ch4 §4.3.1","ch8 §8.1-8.2",
    "ch6 §6.1-6.3","ch6 §6.2","ch7 §7.3","ch7 §7.4","ch7 §7.5 / ch8 §8.3",
    "ch8 §8.3 / inset","ch10 (ggtreeExtra)","ch6"
  ),
  stringsAsFactors = FALSE
)

#' Suggest ggtree layers for a free-text intent (fuzzy keyword match).
#' @param ...     Optional free-text phrases to match (split into words).
#' @param intent  Additional phrase to match (alternative to ...).
#' @return a data.frame row (or the matching subset) of gtree_gallery.
route_intent <- function(..., intent = NULL) {
  terms <- tolower(c(...))
  if (!is.null(intent)) terms <- c(terms, tolower(intent))
  if (length(terms) == 0) return(gtree_gallery)
  # split multi-word phrases into tokens, keep exact matches too
  tokens <- unlist(lapply(terms, function(t) strsplit(t, "[^a-z0-9_]+")[[1]]),
                   use.names = FALSE)
  keys <- c(stats::setNames(gtree_gallery$goal, gtree_gallery$goal),
            "heatmap" = "heatmap", "msa" = "msa", "alignment" = "msa",
            "sequence" = "msa", "barcode" = "branchlen", "support" = "support",
            "bootstrap" = "support", "posterior" = "support",
            "highlight" = "hilight", "hilight" = "hilight", "clade" = "cladelabel",
            "strip" = "strip", "taxalink" = "taxalink", "link" = "taxalink",
            "connect" = "taxalink", "range" = "range", "ci" = "range",
            "confidence" = "range", "scale" = "treescale", "image" = "image",
            "photo" = "image", "phylopic" = "image", "silhouette" = "image",
            "point" = "tipcolor", "color" = "tipcolor", "circular" = "circular",
            "circle" = "circular", "fan" = "circular", "rotate" = "rotate",
            "flip" = "rotate", "zoom" = "manip", "collapse" = "manip",
            "explore" = "manip", "inset" = "inset", "extra" = "extra",
            "ring" = "extra", "fruit" = "extra", "facet" = "facet",
            "panel" = "facet", "bar" = "facet", "pie" = "facet",
            "label" = "cladelabel", "tip" = "label", "unrooted" = "hilight_unrooted",
            "balance" = "balance", "tree" = "label")
  seen <- unique(vapply(tokens, function(t) {
    if (t %in% names(keys)) keys[[t]] else NA_character_
  }, character(1)))
  seen <- seen[!is.na(seen)]
  if (length(seen) == 0) {
    cat("[router] no intent keywords matched:", paste(tokens, collapse=", "), "\n")
    return(gtree_gallery[0, , drop = FALSE])
  }
  gtree_gallery[gtree_gallery$goal %in% seen, ]
}

# ----------------------------------------------------------------------------
# 3. ANNOTATION KINDS — the ggtree annotation geoms grouped by visual kind.
#    Source: ggtree vignette 'Tree Visualization and Annotation' layers table
#    + installed ggtree (verified present at build time).
# ----------------------------------------------------------------------------
gtree_annotation_kinds <- data.frame(
  kind = c("structure", "label", "tips/nodes", "clades", "taxa-clades",
           "association", "uncertainty", "data-panels", "manipulation"),
  description = c(
    "the tree skeleton itself + root/tree options",
    "tip / internal-node labels (text or image)",
    "symbolic points at tips and internal nodes",
    "shading / brackets that mark a single clade or balance",
    "colored strips and bracket labels over ranges of taxa",
    "curves linking related taxa",
    "error bars / confidence ranges from evolutionary inference",
    "heatmap, MSA, or ggplot2 panels aligned to the tree",
    "visual tree editing (collapse/zoom/rotate/flip)"
  ),
  layers = c(
    "geom_tree(), geom_rootpoint(), geom_treescale()",
    "geom_tiplab(), geom_tiplab2() (circular), geom_nodelab(), geom_text2(), geom_label2()",
    "geom_tippoint(), geom_nodepoint(), geom_point2()",
    "geom_hilight(), geom_highlight() (unrooted), geom_balance(), geom_cladelabel()",
    "geom_strip(), geom_cladelabel2() (unrooted), geom_taxalink()",
    "geom_taxalink()",
    "geom_range(), geom_balance() uncertainty bars",
    "gheatmap(), msaplot(), facet_plot(), geom_facet(), ggtreeExtra::geom_fruit()",
    "collapse(), expand(), zoomClade(), scaleClade(), rotate(), flip(), open_tree(), identify()"
  ),
  source = c("ch4","ch4 §4.3.3","ch4 §4.3.2 / ch13 §13.2","ch5 §5.2.2","ch5 §5.2.1",
             "ch5 §5.2.3","ch5 §5.2.4","ch7 / ch8 / ch10","ch6"),
  stringsAsFactors = FALSE
)

# ----------------------------------------------------------------------------
# 4. One-line helpers built on the tables: print a compact cheat-sheet.
# ----------------------------------------------------------------------------
route_cheatsheet <- function(section = c("all","layout","intent","annotate","gallery")) {
  section <- match.arg(section)
  if (section %in% c("all","layout")) {
    cat("== ggtree LAYOUTS ==\n")
    print(gtree_layouts[, c("layout","family","best_for")], row.names = FALSE)
  }
  if (section %in% c("all","intent","gallery")) {
    cat("\n== VISUALIZATION GALLERY (intent -> layers) ==\n")
    print(gtree_gallery[, c("intent","primary_layer")], row.names = FALSE)
  }
  if (section %in% c("all","annotate")) {
    cat("\n== ANNOTATION KINDS ==\n")
    print(gtree_annotation_kinds[, c("kind","layers")], row.names = FALSE)
  }
  invisible(NULL)
}
