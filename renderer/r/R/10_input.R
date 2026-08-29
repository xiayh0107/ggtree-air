# Load and validate phylogenetic inputs for ggtree-air.

.as_phylo_checked <- function(tree, repair_tip_labels = FALSE) {
  if (inherits(tree, "multiPhylo")) {
    stop("The input contains multiple trees; select one tree before rendering.", call. = FALSE)
  }
  phy <- if (inherits(tree, "phylo")) tree else {
    tryCatch(ape::as.phylo(tree), error = function(error) {
      stop("Could not convert input tree to `phylo`: ", conditionMessage(error), call. = FALSE)
    })
  }
  if (is.null(phy$edge) || nrow(phy$edge) == 0L) {
    stop("The parsed tree has no edges.", call. = FALSE)
  }
  if (length(phy$tip.label) < 2L) {
    stop("A tree needs at least two tips.", call. = FALSE)
  }
  invalid_labels <- is.na(phy$tip.label) | !nzchar(phy$tip.label)
  duplicated_labels <- duplicated(phy$tip.label) | duplicated(phy$tip.label, fromLast = TRUE)
  if (any(invalid_labels) || any(duplicated_labels)) {
    if (!isTRUE(repair_tip_labels)) {
      if (any(invalid_labels)) {
        stop("Every tree tip must have a non-empty label. Use explicit ",
             "--repair-tip-labels only when source provenance permits normalization.",
             call. = FALSE)
      }
      stop("Tree tip labels must be unique; duplicates: ",
           paste(unique(phy$tip.label[duplicated(phy$tip.label)]), collapse = ", "),
           call. = FALSE)
    }
    labels <- phy$tip.label
    labels[invalid_labels] <- paste0("unlabeled_tip_", which(invalid_labels))
    phy$tip.label <- make.unique(labels, sep = "_duplicate_")
    attr(phy, "ggtree_air_tip_labels_repaired") <- TRUE
    warning("Repaired ", sum(invalid_labels), " empty and ",
            sum(duplicated_labels), " duplicate tip-label occurrence(s).",
            call. = FALSE)
  }
  phy
}

.read_tree_file <- function(path) {
  extension <- tolower(tools::file_ext(path))
  parser <- switch(
    extension,
    nex = ape::read.nexus,
    nexus = ape::read.nexus,
    xml = treeio::read.phyloxml,
    phyloxml = treeio::read.phyloxml,
    treeio::read.tree
  )
  tryCatch(parser(path), error = function(primary_error) {
    if (extension %in% c("xml", "phyloxml", "nex", "nexus")) {
      stop("Failed to parse ", basename(path), ": ", conditionMessage(primary_error),
           call. = FALSE)
    }
    tryCatch(ape::read.tree(path), error = function(fallback_error) {
      stop(
        "Failed to parse tree file with treeio and ape: ",
        conditionMessage(primary_error), "; ", conditionMessage(fallback_error),
        call. = FALSE
      )
    })
  })
}

.read_distance_matrix <- function(path, tolerance = 1e-8) {
  raw <- tryCatch(
    utils::read.table(path, header = TRUE, row.names = 1, check.names = FALSE,
                      stringsAsFactors = FALSE),
    error = function(error) stop("Failed to read distance matrix: ", conditionMessage(error),
                                 call. = FALSE)
  )
  matrix <- as.matrix(raw)
  suppressWarnings(storage.mode(matrix) <- "double")

  if (nrow(matrix) != ncol(matrix)) {
    stop("Distance matrix must be square; got ", nrow(matrix), " x ", ncol(matrix), ".",
         call. = FALSE)
  }
  if (nrow(matrix) < 3L) {
    stop("Neighbor-joining requires at least three entities.", call. = FALSE)
  }
  if (is.null(rownames(matrix)) || is.null(colnames(matrix))) {
    stop("Distance matrix needs row and column labels.", call. = FALSE)
  }
  if (anyDuplicated(rownames(matrix)) || anyDuplicated(colnames(matrix))) {
    stop("Distance matrix labels must be unique.", call. = FALSE)
  }
  if (!setequal(rownames(matrix), colnames(matrix))) {
    stop("Distance matrix row and column labels must contain the same entities.", call. = FALSE)
  }
  matrix <- matrix[rownames(matrix), rownames(matrix), drop = FALSE]
  if (any(!is.finite(matrix))) {
    stop("Distance matrix contains NA, NaN, Inf, or non-numeric values.", call. = FALSE)
  }
  if (any(matrix < -tolerance)) {
    stop("Distance matrix contains negative distances.", call. = FALSE)
  }
  if (max(abs(diag(matrix))) > tolerance) {
    stop("Distance matrix diagonal must be zero.", call. = FALSE)
  }
  asymmetry <- max(abs(matrix - t(matrix)))
  if (asymmetry > tolerance) {
    stop("Distance matrix must be symmetric; maximum asymmetry is ",
         format(asymmetry, scientific = TRUE), ".", call. = FALSE)
  }

  # Remove harmless floating-point noise without hiding malformed input.
  matrix <- (matrix + t(matrix)) / 2
  matrix[matrix < 0 & matrix >= -tolerance] <- 0
  diag(matrix) <- 0
  matrix
}

.read_fasta_sequences <- function(path, sequence_type = "auto") {
  sequence_type <- match.arg(tolower(sequence_type), c("auto", "dna", "rna", "protein"))
  raw <- Biostrings::readBStringSet(path)
  values <- toupper(as.character(raw))
  if (sequence_type == "auto") {
    is_dna <- all(grepl("^[ACGTRYSWKMBDHVN]+$", values))
    is_rna <- all(grepl("^[ACGURYSWKMBDHVN]+$", values)) && any(grepl("U", values))
    sequence_type <- if (is_rna) "rna" else if (is_dna) "dna" else "protein"
  }
  sequences <- switch(sequence_type,
    dna = Biostrings::DNAStringSet(raw),
    rna = Biostrings::RNAStringSet(raw),
    protein = Biostrings::AAStringSet(raw)
  )
  list(sequences = sequences, sequence_type = sequence_type)
}

#' Load a phylogenetic tree, FASTA file, or distance matrix.
#'
#' Exactly one input route must be supplied. The returned `tree` is suitable
#' for ggtree, while `tree_phylo` is the validated ape representation used for
#' topology checks and deterministic export.
load_tree <- function(tree_path = NULL, fasta_path = NULL, dist_path = NULL,
                      outgroup = NULL, sequence_type = "auto",
                      repair_tip_labels = FALSE) {
  if (!requireNamespace("ape", quietly = TRUE)) {
    stop("Package `ape` is required. Run the dependency check first.", call. = FALSE)
  }

  provided <- c(
    tree = !is.null(tree_path),
    fasta = !is.null(fasta_path),
    dist = !is.null(dist_path)
  )
  if (sum(provided) != 1L) {
    stop("Provide exactly one of tree_path, fasta_path, or dist_path; got ",
         sum(provided), ".", call. = FALSE)
  }

  warnings_log <- character()
  alignment <- NULL
  dist_matrix <- NULL

  if (provided[["tree"]]) {
    if (!file.exists(tree_path)) stop("Tree file not found: ", tree_path, call. = FALSE)
    if (!requireNamespace("treeio", quietly = TRUE)) {
      stop("Package `treeio` is required for tree-file input.", call. = FALSE)
    }
    tree <- .read_tree_file(tree_path)
    route <- "tree"
    input_path <- tree_path
    cat("✓ Parsed tree from", basename(tree_path), "\n")
  } else if (provided[["dist"]]) {
    if (!file.exists(dist_path)) stop("Distance file not found: ", dist_path, call. = FALSE)
    dist_matrix <- .read_distance_matrix(dist_path)
    tree <- ape::nj(stats::as.dist(dist_matrix))
    route <- "dist"
    input_path <- dist_path
    warnings_log <- c(
      warnings_log,
      "Neighbor-joining produces an unrooted tree; do not make directional claims without an explicit root."
    )
    cat("✓ Built NJ tree from validated distance matrix\n")
  } else {
    if (!file.exists(fasta_path)) stop("FASTA file not found: ", fasta_path, call. = FALSE)
    optional <- c("msa", "seqinr", "Biostrings")
    missing <- optional[!vapply(optional, requireNamespace, logical(1), quietly = TRUE)]
    if (length(missing) > 0L) {
      stop(
        "FASTA input needs optional package(s): ", paste(missing, collapse = ", "),
        ". Install them or precompute a distance matrix and use --dist.",
        call. = FALSE
      )
    }
    sequence_input <- .read_fasta_sequences(fasta_path, sequence_type = sequence_type)
    sequences <- sequence_input$sequences
    sequence_type <- sequence_input$sequence_type
    if (length(sequences) < 3L) stop("FASTA route needs at least three sequences.", call. = FALSE)
    alignment <- msa::msa(sequences)
    seqinr_alignment <- msa::msaConvert(alignment, type = "seqinr::alignment")
    distance <- seqinr::dist.alignment(seqinr_alignment, "identity")
    dist_matrix <- as.matrix(distance)
    tree <- ape::nj(distance)
    route <- "fasta"
    input_path <- fasta_path
    warnings_log <- c(
      warnings_log,
      "The NJ branch lengths encode MSA identity dissimilarity, not evolutionary time.",
      "Inspect and trim the alignment before interpreting the topology."
    )
    cat("✓ Computed", sequence_type, "MSA and built NJ tree from",
        length(sequences), "sequences\n")
  }

  phy <- .as_phylo_checked(tree, repair_tip_labels = repair_tip_labels)
  if (isTRUE(attr(phy, "ggtree_air_tip_labels_repaired"))) {
    tree <- phy
    warnings_log <- c(warnings_log,
      "Source tree contained missing/duplicate tip labels; explicit deterministic labels were assigned.")
  }

  if (!is.null(outgroup)) {
    outgroup <- unique(trimws(as.character(outgroup)))
    unknown <- setdiff(outgroup, phy$tip.label)
    if (length(unknown) > 0L) {
      stop("Outgroup tip(s) not found in tree: ", paste(unknown, collapse = ", "),
           call. = FALSE)
    }
    phy <- ape::root(phy, outgroup = outgroup, resolve.root = TRUE)
    tree <- phy
    cat("✓ Rooted tree with outgroup:", paste(outgroup, collapse = ", "), "\n")
  }

  input_path <- normalizePath(input_path, mustWork = TRUE)
  rooted <- isTRUE(ape::is.rooted(phy))
  cat("✓ Tree loaded and validated successfully\n")
  cat("  Route:", route, "| Tips:", length(phy$tip.label),
      "| Rooted:", if (rooted) "yes" else "no", "\n")

  list(
    tree = tree,
    tree_phylo = phy,
    route = route,
    dist_matrix = dist_matrix,
    alignment = alignment,
    sequence_type = if (route == "fasta") sequence_type else NULL,
    n_tips = length(phy$tip.label),
    n_nodes = unname(phy$Nnode),
    tip_labels = phy$tip.label,
    rooted = rooted,
    outgroup = outgroup,
    input_path = input_path,
    input_md5 = unname(as.character(tools::md5sum(input_path))),
    warnings = warnings_log
  )
}
