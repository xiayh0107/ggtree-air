renderer_dependency_status <- function() {
  packages <- data.frame(
    package = c("ape", "ggtree", "treeio", "ggplot2", "jsonlite",
                "msa", "seqinr", "Biostrings"),
    required = c(rep(TRUE, 5L), rep(FALSE, 3L)),
    feature = c("tree/NJ", "tree graphics", "annotated trees", "graphics grammar",
                "worker protocol", "MSA", "identity distance", "FASTA input"),
    stringsAsFactors = FALSE
  )
  packages$installed <- vapply(packages$package, requireNamespace, logical(1), quietly = TRUE)
  packages$version <- vapply(packages$package, function(package) {
    if (!requireNamespace(package, quietly = TRUE)) return(NA_character_)
    as.character(utils::packageVersion(package))
  }, character(1))
  packages
}

renderer_assert_core_dependencies <- function() {
  status <- renderer_dependency_status()
  missing <- status$package[status$required & !status$installed]
  if (length(missing) > 0L) {
    stop("Missing required R renderer package(s): ", paste(missing, collapse = ", "),
         call. = FALSE)
  }
  invisible(status)
}
