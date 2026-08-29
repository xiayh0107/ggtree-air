#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = TRUE)
data_dir <- if (length(args) >= 1L) args[1] else "examples/treedata-book/data"
output <- if (length(args) >= 2L) args[2] else "hmp-body-sites.png"

required <- c("ape", "ggtree", "ggtreeExtra", "ggplot2", "ggnewscale", "ggstar", "tidytree")
missing <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing)) stop("Missing packages: ", paste(missing, collapse = ", "))

suppressPackageStartupMessages({
  library(ape)
  library(ggtree)
  library(ggtreeExtra)
  library(ggplot2)
  library(ggnewscale)
  library(ggstar)
  library(tidytree)
})

tree <- ape::read.tree(file.path(data_dir, "hmp-tree.nwk"))
dat1 <- read.csv(file.path(data_dir, "hmp-tip-points.csv"), check.names = FALSE)
dat2 <- read.csv(file.path(data_dir, "hmp-ring-heatmap.csv"), check.names = FALSE)
dat3 <- read.csv(file.path(data_dir, "hmp-bars.csv"), check.names = FALSE)

site_levels <- c(
  "Stool (prevalence)", "Cheek (prevalence)", "Plaque (prevalence)",
  "Tongue (prevalence)", "Nose (prevalence)", "Vagina (prevalence)",
  "Skin (prevalence)"
)
dat2$Sites <- factor(dat2$Sites, levels = site_levels)
dat3$Sites <- factor(dat3$Sites, levels = site_levels)

clade_labels <- tree$node.label[nchar(tree$node.label) > 4]
node_ids <- tidytree::nodeid(tree, clade_labels)
node_df <- data.frame(node = node_ids)
label_df <- data.frame(
  node = node_ids,
  clade_label = gsub("[\\.0-9]", "", clade_labels),
  pos = c(
    1.6, 1.4, 1.6, 0.8, 0.1, 0.25, 1.6, 1.6, 1.2, 0.4,
    1.2, 1.8, 0.3, 0.8, 0.4, 0.3, 0.4, 0.4, 0.4, 0.6,
    0.3, 0.4, 0.3
  )
)

p <- ggtree(tree, layout = "fan", linewidth = 0.15, open.angle = 5) +
  geom_hilight(
    data = node_df, mapping = aes(node = node), extendto = 6.8,
    alpha = 0.3, fill = "grey88", color = "grey60", linewidth = 0.05
  ) +
  geom_cladelab(
    data = label_df,
    mapping = aes(node = node, label = clade_label, offset.text = pos),
    hjust = 0.5, angle = "auto", barsize = NA, horizontal = FALSE,
    fontsize = 1.4, fontface = "italic"
  )

p <- p %<+% dat1 +
  geom_star(
    aes(fill = Phylum, starshape = Type, size = Size),
    position = "identity", starstroke = 0.1
  ) +
  scale_fill_manual(
    values = c(
      "#FFC125", "#87CEFA", "#7B68EE", "#808080", "#800080",
      "#9ACD32", "#D15FEE", "#FFC0CB", "#EE6A50", "#8DEEEE",
      "#006400", "#800000", "#B0171F", "#191970"
    ),
    guide = guide_legend(
      keywidth = 0.5, keyheight = 0.5, order = 1,
      override.aes = list(starshape = 15)
    ),
    na.translate = FALSE
  ) +
  scale_starshape_manual(
    values = c(15, 1),
    guide = guide_legend(keywidth = 0.5, keyheight = 0.5, order = 2),
    na.translate = FALSE
  ) +
  scale_size_continuous(
    range = c(1, 2.5),
    guide = guide_legend(
      keywidth = 0.5, keyheight = 0.5, order = 3,
      override.aes = list(starshape = 15)
    )
  )

p <- p + ggnewscale::new_scale_fill() +
  geom_fruit(
    data = dat2, geom = geom_tile,
    aes(y = ID, x = Sites, alpha = Abundance, fill = Sites),
    color = "grey70", offset = 0.04, linewidth = 0.02
  ) +
  scale_alpha_continuous(
    range = c(0, 1),
    guide = guide_legend(keywidth = 0.3, keyheight = 0.3, order = 5)
  ) +
  geom_fruit(
    data = dat3, geom = geom_bar,
    aes(y = ID, x = HigherAbundance, fill = Sites),
    pwidth = 0.38, orientation = "y", stat = "identity"
  ) +
  scale_fill_manual(
    values = c("#0000FF", "#FFA500", "#FF0000", "#800000", "#006400", "#800080", "#696969"),
    guide = guide_legend(keywidth = 0.3, keyheight = 0.3, order = 4)
  ) +
  geom_treescale(fontsize = 2, linesize = 0.3, x = 4.9, y = 0.1) +
  theme(
    legend.position = c(0.93, 0.5),
    legend.background = element_rect(fill = NA, color = NA),
    legend.title = element_text(size = 6.5),
    legend.text = element_text(size = 4.5),
    legend.spacing.y = grid::unit(0.02, "cm"),
    plot.margin = margin(8, 8, 8, 8)
  )

dir.create(dirname(output), recursive = TRUE, showWarnings = FALSE)
ggsave(output, p, width = 14, height = 14, dpi = 300, bg = "white", limitsize = FALSE)
cat(normalizePath(output), "\n")
