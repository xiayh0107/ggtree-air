# Export reproducible tree artifacts and run metadata.

#' Export tree objects, Newick, matrices, and run metadata.
export_all <- function(result, output_dir = "results") {
  dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
  output_dir <- normalizePath(output_dir, mustWork = TRUE)
  written <- character()

  tree_rds <- file.path(output_dir, "tree.rds")
  saveRDS(result$tree_used, tree_rds)
  written <- c(written, tree_rds)

  phy <- result$tree_phylo
  if (is.null(phy)) {
    phy <- if (inherits(result$tree, "phylo")) result$tree else ape::as.phylo(result$tree)
  }
  newick <- file.path(output_dir, "newick.tree.txt")
  ape::write.tree(phy, file = newick)
  written <- c(written, newick)

  if (!is.null(result$dist_matrix)) {
    distance_file <- file.path(output_dir, "distance_matrix.tsv")
    utils::write.table(
      result$dist_matrix, distance_file, sep = "\t", quote = FALSE, col.names = NA
    )
    written <- c(written, distance_file)
  }
  if (!is.null(result$alignment)) {
    alignment_file <- file.path(output_dir, "alignment.rds")
    saveRDS(result$alignment, alignment_file)
    written <- c(written, alignment_file)
  }

  package_version <- function(package) {
    tryCatch(as.character(utils::packageVersion(package)), error = function(error) NA_character_)
  }
  created <- if (exists("ggtree_air_iso_time", mode = "function")) {
    ggtree_air_iso_time()
  } else {
    format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
  }
  run_metadata <- list(
    schema_version = "1.0.0",
    created = created,
    runtime = list(
      r = R.version.string,
      packages = list(
        ape = package_version("ape"),
        ggtree = package_version("ggtree"),
        treeio = package_version("treeio"),
        ggplot2 = package_version("ggplot2")
      )
    ),
    input = list(
      route = result$route,
      path = result$meta$input_path,
      md5 = result$meta$input_md5,
      sequence_type = result$meta$sequence_type,
      tips = result$meta$n_tips,
      internal_nodes = result$meta$n_nodes
    ),
    scientific_context = list(
      rooted = isTRUE(result$rooted),
      outgroup = result$outgroup,
      warnings = as.list(result$warnings)
    ),
    parameters = result$parameters,
    intent_status = result$intent_status
  )

  metadata_file <- file.path(output_dir, "run_metadata.json")
  if (exists("ggtree_air_write_json", mode = "function")) {
    ggtree_air_write_json(run_metadata, metadata_file)
  } else {
    if (!requireNamespace("jsonlite", quietly = TRUE)) {
      stop("Package `jsonlite` is required to export run metadata.", call. = FALSE)
    }
    writeLines(jsonlite::toJSON(run_metadata, auto_unbox = TRUE, null = "null",
                                na = "null", dataframe = "rows", pretty = TRUE),
               metadata_file)
  }
  written <- c(written, metadata_file)

  log_file <- file.path(output_dir, "run_log.txt")
  log_lines <- c(
    "ggtree-air run log",
    "==================",
    paste0("Created (UTC):   ", created),
    paste0("R version:       ", R.version.string),
    paste0("ape version:     ", package_version("ape")),
    paste0("ggtree version:  ", package_version("ggtree")),
    paste0("treeio version:  ", package_version("treeio")),
    paste0("Input route:     ", result$route),
    paste0("Input path:      ", result$meta$input_path),
    paste0("Input md5:       ", result$meta$input_md5),
    paste0("Tips:            ", result$meta$n_tips),
    paste0("Internal nodes:  ", result$meta$n_nodes),
    paste0("Rooted:          ", if (isTRUE(result$rooted)) "yes" else "no"),
    paste0("Layouts:         ", paste(result$layout, collapse = ", ")),
    paste0("Intents:         ", paste(result$parameters$intents, collapse = ", "))
  )
  if (length(result$clade_nodes) > 0L) {
    log_lines <- c(log_lines, paste0("Clade nodes:     ", paste(result$clade_nodes, collapse = ",")))
  }
  if (length(result$warnings) > 0L) {
    log_lines <- c(log_lines, "", "Scientific warnings:", paste0("- ", result$warnings))
  }
  writeLines(log_lines, log_file)
  written <- c(written, log_file)

  cat("=== Export Complete ===\n")
  cat("  Wrote", length(written), "file(s) to", output_dir, "\n")
  invisible(written)
}
