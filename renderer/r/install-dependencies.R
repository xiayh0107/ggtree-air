#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = TRUE)
with_msa <- "--with-msa" %in% args
with_recipes <- "--with-recipes" %in% args || "--all" %in% args
repos <- getOption("repos")
if (is.null(repos) || identical(unname(repos[["CRAN"]]), "@CRAN@")) {
  repos["CRAN"] <- "https://cloud.r-project.org"
}
options(repos = repos)

install_cran <- function(packages) {
  missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
  if (length(missing)) install.packages(missing, dependencies = NA)
}

install_cran(c("ape", "ggplot2", "jsonlite", "svglite"))
if (!requireNamespace("BiocManager", quietly = TRUE)) install.packages("BiocManager")
bioc <- c("ggtree", "treeio")
if (with_msa) {
  install_cran("seqinr")
  bioc <- c(bioc, "Biostrings", "msa")
}
if (with_recipes) {
  install_cran(c("ggnewscale", "reshape2"))
  bioc <- c(bioc, "ggtreeExtra", "ggstar")
}
missing_bioc <- bioc[!vapply(bioc, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing_bioc)) BiocManager::install(missing_bioc, ask = FALSE, update = FALSE)

core <- c("ape", "ggtree", "treeio", "ggplot2", "jsonlite")
missing <- core[!vapply(core, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing)) stop("Installation incomplete; missing: ", paste(missing, collapse = ", "))
cat("ggtree-air R runtime is ready\n")
if (!with_msa) cat("Tip: rerun with --with-msa for FASTA realignment support\n")
